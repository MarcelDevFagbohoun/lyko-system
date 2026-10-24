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

const seed = require('../../db/seedGeneralLedger');
const { PROFILE_OPTIONS, detectProfile } = require('../../constants/glProfiles');

const SETTINGS_COLUMNS = [
  'gl_depreciation_prorata_temporis', 'gl_irf_enabled', 'gl_irf_rate', 'gl_irf_base', 'gl_profile',
  'gl_vat_enabled', 'gl_vat_rate', 'gl_closing_mode', 'gl_utility_account_mode', 'gl_payroll_level',
  'gl_cnss_employee_rate', 'gl_cnss_employer_rate', 'gl_its_brackets', 'gl_asset_sale_proceeds',
].join(', ');

function parseBrackets(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function toPublicSettings(t) {
  const options = {
    vatEnabled: !!t.gl_vat_enabled,
    closingMode: t.gl_closing_mode,
    utilityAccountMode: t.gl_utility_account_mode,
    payrollLevel: t.gl_payroll_level,
    irfBase: t.gl_irf_base,
    assetSaleProceeds: !!t.gl_asset_sale_proceeds,
  };
  return {
    depreciationProrataTemporis: !!t.gl_depreciation_prorata_temporis,
    irfEnabled: !!t.gl_irf_enabled,
    irfRate: Number(t.gl_irf_rate),
    ...options,
    profile: detectProfile(options),
    vatRate: Number(t.gl_vat_rate),
    cnssEmployeeRate: Number(t.gl_cnss_employee_rate),
    cnssEmployerRate: Number(t.gl_cnss_employer_rate),
    itsBrackets: parseBrackets(t.gl_its_brackets),
  };
}

// clé API -> [colonne, conversion]
const FIELD_MAP = {
  depreciationProrataTemporis: ['gl_depreciation_prorata_temporis', (v) => (v ? 1 : 0)],
  irfEnabled: ['gl_irf_enabled', (v) => (v ? 1 : 0)],
  irfRate: ['gl_irf_rate', (v) => v],
  irfBase: ['gl_irf_base', (v) => v],
  vatEnabled: ['gl_vat_enabled', (v) => (v ? 1 : 0)],
  vatRate: ['gl_vat_rate', (v) => v],
  closingMode: ['gl_closing_mode', (v) => v],
  utilityAccountMode: ['gl_utility_account_mode', (v) => v],
  payrollLevel: ['gl_payroll_level', (v) => v],
  cnssEmployeeRate: ['gl_cnss_employee_rate', (v) => v],
  cnssEmployerRate: ['gl_cnss_employer_rate', (v) => v],
  itsBrackets: ['gl_its_brackets', (v) => (v == null ? null : JSON.stringify(v))],
  assetSaleProceeds: ['gl_asset_sale_proceeds', (v) => (v ? 1 : 0)],
};

async function loadSettings(tenantId) {
  const [rows] = await pool.query(`SELECT ${SETTINGS_COLUMNS} FROM tenants WHERE id = :id LIMIT 1`, { id: tenantId });
  if (!rows[0]) throw new ApiError(404, 'Entreprise introuvable');
  return rows[0];
}

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    res.json(toPublicSettings(await loadSettings(req.user.tenantId)));
  } catch (err) {
    next(err);
  }
});

/** Journal des changements de réglages (50 derniers). */
router.get('/log', canAdvanced, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.id, l.setting_key, l.old_value, l.new_value, l.created_at, u.name AS user_name
         FROM gl_settings_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.tenant_id = :t ORDER BY l.id DESC LIMIT 50`,
      { t: req.user.tenantId },
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id, key: r.setting_key, oldValue: r.old_value, newValue: r.new_value,
        createdAt: r.created_at, userName: r.user_name ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/', canAdvanced, async (req, res, next) => {
  const parsed = updateGlSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = { ...parsed.data };

  try {
    // Un profil = un préréglage de plusieurs options (les options explicitement envoyées priment).
    if (data.profile) {
      const preset = PROFILE_OPTIONS[data.profile];
      for (const [k, v] of Object.entries(preset)) if (data[k] === undefined) data[k] = v;
    }
    delete data.profile;

    const before = await loadSettings(req.user.tenantId);
    const beforePublic = toPublicSettings(before);

    // Cohérence : barème ITS requis pour la paie "complète".
    const nextLevel = data.payrollLevel ?? beforePublic.payrollLevel;
    const nextBrackets = data.itsBrackets !== undefined ? data.itsBrackets : beforePublic.itsBrackets;
    if (nextLevel === 'complet' && (!nextBrackets || nextBrackets.length === 0)) {
      throw new ApiError(400, "Pour la paie complète (CNSS + ITS), saisissez d'abord le barème de l'ITS fourni par votre comptable ou l'administration fiscale.");
    }
    if (data.itsBrackets && data.itsBrackets.length > 0) {
      const last = data.itsBrackets[data.itsBrackets.length - 1];
      let prev = -1;
      for (const b of data.itsBrackets) {
        if (b.upTo !== null) {
          if (b.upTo <= prev) throw new ApiError(400, 'Les tranches du barème ITS doivent être croissantes.');
          prev = b.upTo;
        }
      }
      if (last.upTo !== null) throw new ApiError(400, "La dernière tranche du barème ITS doit être « au-delà » (sans plafond).");
    }

    const fields = [];
    const params = { id: req.user.tenantId };
    const changes = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || !FIELD_MAP[key]) continue;
      const [col, conv] = FIELD_MAP[key];
      const nv = conv(value);
      fields.push(`${col} = :${key}`);
      params[key] = nv;
      const oldV = beforePublic[key];
      changes.push({ key, oldValue: oldV == null ? null : JSON.stringify(oldV), newValue: value == null ? null : JSON.stringify(value) });
    }
    const real = changes.filter((c) => c.oldValue !== c.newValue);
    if (fields.length > 0) {
      await pool.query(`UPDATE tenants SET ${fields.join(', ')}, gl_profile = :profileCol WHERE id = :id`, {
        ...params,
        profileCol: 'personnalise', // recalculé ci-dessous
      });
      const after = toPublicSettings(await loadSettings(req.user.tenantId));
      await pool.query('UPDATE tenants SET gl_profile = :p WHERE id = :id', { p: after.profile, id: req.user.tenantId });
      for (const c of real) {
        await pool.query(
          'INSERT INTO gl_settings_log (tenant_id, user_id, setting_key, old_value, new_value) VALUES (:t, :u, :k, :o, :n)',
          { t: req.user.tenantId, u: req.user.id, k: c.key, o: c.oldValue, n: c.newValue },
        );
      }
      // Plan comptable déjà initialisé : ajoute les comptes/règles que les nouvelles options exigent.
      const [[acc]] = await pool.query('SELECT COUNT(*) AS n FROM gl_accounts WHERE tenant_id = :t', { t: req.user.tenantId });
      if (Number(acc.n) > 0) {
        await seed.syncMissingAccounts(req.user.tenantId);
        await seed.syncMissingPostingRules(req.user.tenantId);
      }
      logger.info('Réglages comptabilité avancée modifiés', { tenantId: req.user.tenantId, fields: Object.keys(data), by: req.user.id });
    }
    res.json(toPublicSettings(await loadSettings(req.user.tenantId)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
