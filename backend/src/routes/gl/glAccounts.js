'use strict';

/**
 * Plan comptable (espace Comptabilité avancée) — lecture du référentiel
 * préchargé par `seedGeneralLedger`, plus ajout de sous-comptes personnalisés.
 * Jamais de suppression ni de modification d'un compte système (`is_system`)
 * depuis cette route : le plan SYSCOHADA de base reste identique pour tous
 * les tenants, seule l'extension est permise.
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { createAccountSchema, renameAccountSchema } = require('../../validators/gl/referentiels');
const { RENAMEABLE_SYSTEM_KEYS } = require('../../constants/glRenameableAccounts');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

function toPublicAccount(row) {
  return {
    id: row.id,
    code: row.code,
    systemKey: row.system_key,
    label: row.label,
    class: row.class,
    accountType: row.account_type,
    isControlAccount: !!row.is_control_account,
    parentAccountId: row.parent_account_id,
    isSystem: !!row.is_system,
    isActive: !!row.is_active,
  };
}

// GET /api/gl/accounts — plan comptable complet du tenant, trié par numéro.
router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM gl_accounts WHERE tenant_id = :tenantId ORDER BY code ASC',
      { tenantId: req.user.tenantId },
    );
    res.json({ accounts: rows.map(toPublicAccount) });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/accounts — créer un sous-compte personnalisé.
router.post('/', canAdvanced, async (req, res, next) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const [existing] = await pool.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
      tenantId: req.user.tenantId,
      code: data.code,
    });
    if (existing[0]) throw new ApiError(409, 'Ce numéro de compte existe déjà');

    if (data.parentAccountId) {
      const [parentRows] = await pool.query('SELECT id FROM gl_accounts WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: data.parentAccountId,
        tenantId: req.user.tenantId,
      });
      if (!parentRows[0]) throw new ApiError(404, 'Compte parent introuvable');
    }

    const [result] = await pool.query(
      `INSERT INTO gl_accounts (tenant_id, code, label, class, account_type, is_control_account, parent_account_id, is_system, created_by)
       VALUES (:tenantId, :code, :label, :class, :accountType, :isControlAccount, :parentAccountId, 0, :by)`,
      {
        tenantId: req.user.tenantId,
        code: data.code,
        label: data.label,
        class: data.class,
        accountType: data.accountType,
        isControlAccount: data.isControlAccount ? 1 : 0,
        parentAccountId: data.parentAccountId ?? null,
        by: req.user.id,
      },
    );
    logger.info('Compte comptable personnalisé créé', { tenantId: req.user.tenantId, accountId: result.insertId, by: req.user.id });
    res.status(201).json({ accountId: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gl/accounts/renameable/:key — renomme UN NUMÉRO de compte
// système dont le choix reste une hypothèse comptable ouverte (voir
// constants/glRenameableAccounts.js) — jamais son libellé/type, jamais un
// compte système ordinaire. Ouvert à `comptabilite_avancee` (DG ou
// comptable autorisé — décision explicite de l'utilisateur : « le comptable
// ou l'admin peut régler les paramètres de la comptabilité avancée »),
// contrairement à l'activation/désactivation du module ou la clôture d'un
// exercice, restées DG uniquement (actions bien plus lourdes de conséquence,
// l'une déclenchant un rattrapage rétroactif de tout l'historique). Le reste
// du moteur résout ce compte par `system_key` (jamais par son code littéral),
// donc ce renommage n'affecte que l'affichage — sans risque pour les
// écritures déjà générées.
router.patch('/renameable/:key', canAdvanced, async (req, res, next) => {
  const { key } = req.params;
  if (!RENAMEABLE_SYSTEM_KEYS.includes(key)) return next(new ApiError(404, 'Compte introuvable'));

  const parsed = renameAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { code } = parsed.data;

  try {
    const [existing] = await pool.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND system_key = :key LIMIT 1', {
      tenantId: req.user.tenantId,
      key,
    });
    if (!existing[0]) {
      throw new ApiError(404, "Compte introuvable — le plan comptable a-t-il été initialisé (comptabilité avancée activée) ?");
    }

    const [conflict] = await pool.query(
      'SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code AND id != :id LIMIT 1',
      { tenantId: req.user.tenantId, code, id: existing[0].id },
    );
    if (conflict[0]) throw new ApiError(409, 'Ce numéro de compte est déjà utilisé par un autre compte.');

    await pool.query('UPDATE gl_accounts SET code = :code WHERE id = :id', { code, id: existing[0].id });
    logger.info('Compte système renommé', { tenantId: req.user.tenantId, key, code, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
