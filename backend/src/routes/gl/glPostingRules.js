'use strict';

/**
 * Règles comptables (moteur d'écritures) — l'espace Comptabilité avancée
 * doit pouvoir voir CE que fait chaque type d'opération (comptes/journal) et
 * signaler qu'un comptable l'a revue (`is_validated_by_accountant`, coché à 0
 * par défaut pour toutes les règles du seed — voir livrable 3). Jamais de
 * modification des comptes/montants depuis cette route : trop sensible pour
 * un simple formulaire, réservé à une intervention technique directe en base
 * après revue de l'expert-comptable.
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { updatePostingRuleSchema } = require('../../validators/gl/referentiels');
const { GL_CORE_HOOKED_OPERATION_TYPES } = require('../../constants/glOperationTypes');
const { syncMissingPostingRules, syncAccountSystemKeys } = require('../../db/seedGeneralLedger');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

// GET /api/gl/posting-rules — chaque règle + ses lignes débit/crédit.
router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const [rules] = await pool.query(
      `SELECT pr.*, j.code AS journal_code, j.label AS journal_label
       FROM gl_posting_rules pr JOIN gl_journals j ON j.id = pr.journal_id
       WHERE pr.tenant_id = :tenantId ORDER BY pr.operation_type ASC`,
      { tenantId: req.user.tenantId },
    );
    if (rules.length === 0) return res.json({ rules: [] });

    const [lines] = await pool.query(
      `SELECT prl.*, a.code AS account_code, a.label AS account_label
       FROM gl_posting_rule_lines prl
       LEFT JOIN gl_accounts a ON a.id = prl.account_id
       WHERE prl.rule_id IN (:ruleIds) ORDER BY prl.rule_id ASC, prl.line_order ASC`,
      { ruleIds: rules.map((r) => r.id) },
    );
    const linesByRule = new Map();
    for (const l of lines) {
      if (!linesByRule.has(l.rule_id)) linesByRule.set(l.rule_id, []);
      linesByRule.get(l.rule_id).push({
        side: l.side,
        accountCode: l.account_code,
        accountLabel: l.account_label,
        accountRole: l.account_role,
        amountFormula: l.amount_formula,
        formulaParam: l.formula_param,
        fixedAmount: l.fixed_amount != null ? Number(l.fixed_amount) : null,
      });
    }

    res.json({
      rules: rules.map((r) => ({
        id: r.id,
        operationType: r.operation_type,
        label: r.label,
        journal: { code: r.journal_code, label: r.journal_label },
        narrationTemplate: r.narration_template,
        isActive: !!r.is_active,
        isValidatedByAccountant: !!r.is_validated_by_accountant,
        lines: linesByRule.get(r.id) ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gl/posting-rules/:id — activer/désactiver, ajuster le libellé,
// ou marquer comme validée par un comptable après revue.
router.patch('/:id', canAdvanced, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updatePostingRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const [existing] = await pool.query(
      'SELECT id, operation_type FROM gl_posting_rules WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!existing[0]) throw new ApiError(404, 'Règle comptable introuvable');

    // Désactiver une règle réellement appelée par une route métier (loyer,
    // dépense, versement...) ferait échouer l'OPÉRATION elle-même, pas
    // seulement son écriture comptable (même transaction SQL) — refusé ici
    // plutôt que de laisser un comptable bloquer silencieusement les
    // paiements de toute l'entreprise en un clic.
    if (data.isActive === false && GL_CORE_HOOKED_OPERATION_TYPES.includes(existing[0].operation_type)) {
      throw new ApiError(
        409,
        "Cette règle est utilisée par une opération métier active (paiement, dépense, versement...) — la désactiver bloquerait ces opérations. Contactez le support technique si elle doit vraiment être désactivée.",
      );
    }

    const fields = [];
    const params = { id };
    if (data.label !== undefined) { fields.push('label = :label'); params.label = data.label; }
    if (data.narrationTemplate !== undefined) { fields.push('narration_template = :narrationTemplate'); params.narrationTemplate = data.narrationTemplate; }
    if (data.isActive !== undefined) { fields.push('is_active = :isActive'); params.isActive = data.isActive ? 1 : 0; }
    if (data.isValidatedByAccountant !== undefined) {
      fields.push('is_validated_by_accountant = :isValidated', 'validated_by = :validatedBy', 'validated_at = :validatedAt');
      params.isValidated = data.isValidatedByAccountant ? 1 : 0;
      params.validatedBy = data.isValidatedByAccountant ? req.user.id : null;
      params.validatedAt = data.isValidatedByAccountant ? new Date() : null;
    }

    if (fields.length > 0) {
      await pool.query(`UPDATE gl_posting_rules SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    logger.info('Règle comptable modifiée', { tenantId: req.user.tenantId, ruleId: id, by: req.user.id, changes: data });
    res.json({ ruleId: id });
  } catch (err) {
    next(err);
  }
});

// POST /api/gl/posting-rules/resync — ajoute les règles des types
// d'opération apparus depuis l'activation (ou depuis la dernière
// resynchronisation), sans jamais toucher une règle déjà présente — voir
// `db/seedGeneralLedger.js` `syncMissingPostingRules` pour la garantie
// exacte. Rattrape AUSSI les `system_key` de comptes déjà existants restés
// NULL (`syncAccountSystemKeys`, même défaut de fond : un tenant actif avant
// l'introduction d'un system_key sur un compte du catalogue ne le reçoit
// jamais tout seul). Nécessaire pour une entreprise dont le module reste
// actif en continu (la réactivation après suspension ne resynchronise pas
// non plus).
router.post('/resync', canAdvanced, async (req, res, next) => {
  try {
    const { added } = await syncMissingPostingRules(req.user.tenantId);
    const { updated } = await syncAccountSystemKeys(req.user.tenantId);
    logger.info('Règles/comptes comptables resynchronisés', {
      tenantId: req.user.tenantId,
      added,
      updatedSystemKeys: updated,
      by: req.user.id,
    });
    res.json({ added, updatedSystemKeys: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
