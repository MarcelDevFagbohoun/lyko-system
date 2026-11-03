'use strict';

/**
 * Verrou PLATEFORME au-dessus de l'activation par tenant de SYSCOHADA (`tenants.gl_module_enabled`)
 * et de FedaPay (`tenants.fedapay_enabled` / `fedapay_collect_enabled`) — demande utilisateur,
 * 2026-11-03 : « on ajoute un menu paramètre dans l'admin qui va nous permettre d'activer le
 * syscohada et fedapay lorsque sera prêt, lorsque sera activé il pourra l'utiliser ».
 *
 * Ligne unique (platform_settings.id = 1). Volontairement SANS cache : lu uniquement au moment où
 * une entreprise tente une activation (rare), jamais sur un chemin chaud.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');

function q(conn) {
  return conn || pool;
}

/** { syscohadaEnabled, fedapayEnabled, updatedAt, updatedBy } — jamais null : la ligne est seedée par la migration 141. */
async function getPlatformFeatureGates(conn) {
  const [[row]] = await q(conn).query('SELECT syscohada_enabled, fedapay_enabled, updated_at, updated_by FROM platform_settings WHERE id = 1');
  if (!row) return { syscohadaEnabled: false, fedapayEnabled: false, updatedAt: null, updatedBy: null };
  return {
    syscohadaEnabled: !!row.syscohada_enabled,
    fedapayEnabled: !!row.fedapay_enabled,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

async function setPlatformFeatureGates({ syscohadaEnabled, fedapayEnabled }, { adminId }) {
  if (typeof syscohadaEnabled !== 'boolean' || typeof fedapayEnabled !== 'boolean') {
    throw new ApiError(400, 'Valeurs invalides.');
  }
  await pool.query(
    'UPDATE platform_settings SET syscohada_enabled = :s, fedapay_enabled = :f, updated_by = :by WHERE id = 1',
    { s: syscohadaEnabled ? 1 : 0, f: fedapayEnabled ? 1 : 0, by: adminId ?? null },
  );
  return getPlatformFeatureGates();
}

/**
 * À appeler au moment où UN TENANT tente de passer de « éteint » à « allumé » sur l'un des deux
 * modules (jamais au moment d'une simple lecture ou d'une suspension) : `alreadyOn` doit être l'état
 * ACTUEL du tenant AVANT cette requête. Un tenant déjà actif peut toujours se réactiver — on ne bloque
 * jamais une transition qui ne change rien pour lui, seulement une toute première activation tant que
 * la plateforme n'est pas prête.
 */
async function assertCanActivate(feature, alreadyOn, conn) {
  if (alreadyOn) return;
  const gates = await getPlatformFeatureGates(conn);
  const label = feature === 'syscohada' ? 'La comptabilité avancée SYSCOHADA' : 'FedaPay';
  const on = feature === 'syscohada' ? gates.syscohadaEnabled : gates.fedapayEnabled;
  if (!on) {
    throw new ApiError(403, `${label} n'est pas encore ouvert aux entreprises sur la plateforme.`, { code: 'PLATFORM_FEATURE_LOCKED', feature });
  }
}

module.exports = { getPlatformFeatureGates, setPlatformFeatureGates, assertCanActivate };
