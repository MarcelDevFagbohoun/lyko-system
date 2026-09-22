'use strict';

/**
 * Réglages de la comptabilité avancée qui restent des hypothèses de jugement
 * comptable (voir les notes "À VALIDER" du seed) — configurables par
 * entreprise plutôt que devinés une fois pour toutes. Ouvert au DG ET au
 * comptable autorisé (`comptabilite_avancee`) — décision explicite de
 * l'utilisateur : « le comptable ou l'admin peut régler les paramètres de la
 * comptabilité avancée », comme pour les comptes renommables
 * (routes/gl/glAccounts.js `PATCH /renameable/:key`).
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { updateGlSettingsSchema } = require('../../validators/gl/settings');
const logger = require('../../utils/logger');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

const SETTINGS_COLUMNS =
  'gl_depreciation_prorata_temporis, gl_utility_passthrough_percent, gl_commission_timing, gl_irf_enabled, gl_irf_rate';

function toPublicSettings(tenant) {
  return {
    depreciationProrataTemporis: !!tenant.gl_depreciation_prorata_temporis,
    utilityPassThroughPercent: Number(tenant.gl_utility_passthrough_percent),
    commissionTiming: tenant.gl_commission_timing,
    irfEnabled: !!tenant.gl_irf_enabled,
    irfRate: Number(tenant.gl_irf_rate),
  };
}

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT ${SETTINGS_COLUMNS} FROM tenants WHERE id = :id LIMIT 1`, {
      id: req.user.tenantId,
    });
    if (!rows[0]) throw new ApiError(404, 'Entreprise introuvable');
    res.json(toPublicSettings(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.patch('/', canAdvanced, async (req, res, next) => {
  const parsed = updateGlSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const fields = [];
  const params = { id: req.user.tenantId };
  if (data.depreciationProrataTemporis !== undefined) {
    fields.push('gl_depreciation_prorata_temporis = :depreciationProrataTemporis');
    params.depreciationProrataTemporis = data.depreciationProrataTemporis ? 1 : 0;
  }
  if (data.utilityPassThroughPercent !== undefined) {
    fields.push('gl_utility_passthrough_percent = :utilityPassThroughPercent');
    params.utilityPassThroughPercent = data.utilityPassThroughPercent;
  }
  if (data.commissionTiming !== undefined) {
    fields.push('gl_commission_timing = :commissionTiming');
    params.commissionTiming = data.commissionTiming;
  }
  if (data.irfEnabled !== undefined) {
    fields.push('gl_irf_enabled = :irfEnabled');
    params.irfEnabled = data.irfEnabled ? 1 : 0;
  }
  if (data.irfRate !== undefined) {
    fields.push('gl_irf_rate = :irfRate');
    params.irfRate = data.irfRate;
  }

  try {
    if (fields.length > 0) {
      await pool.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = :id`, params);
      logger.info('Réglages comptabilité avancée modifiés', { tenantId: req.user.tenantId, fields: Object.keys(data), by: req.user.id });
    }
    const [rows] = await pool.query(`SELECT ${SETTINGS_COLUMNS} FROM tenants WHERE id = :id LIMIT 1`, {
      id: req.user.tenantId,
    });
    res.json(toPublicSettings(rows[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
