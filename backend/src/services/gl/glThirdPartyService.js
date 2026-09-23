'use strict';

const { ApiError } = require('../../middleware/error');

/**
 * Comptes auxiliaires (tiers) — créés PARESSEUSEMENT à la première opération
 * qui concerne un locataire/propriétaire donné, jamais en masse à l'avance.
 * Ne duplique aucune donnée de `renters`/`owners` (modules existants,
 * inchangés) au-delà d'un nom d'affichage dénormalisé pour rester lisible
 * même si la fiche source est supprimée plus tard.
 */

/**
 * Compte collectif associé à un type de tiers — voir plan comptable du seed.
 * `owner` résout par `system_key` (jamais par un code littéral) : c'est un
 * des comptes RENOMMABLES par le DG (migration 050) — 411/401/421 ne le
 * sont pas, leur code SYSCOHADA ne fait pas débat.
 */
const CONTROL_ACCOUNT_LOOKUP_BY_PARTY_TYPE = {
  renter: { code: '411' },
  owner: { systemKey: 'owner_control_account' },
  supplier: { code: '401' },
  employee: { code: '421' },
};

/**
 * `controlAccountId` (optionnel) : force le compte collectif au lieu de
 * celui par défaut du type de tiers — cas de la caution (165), où le même
 * locataire a besoin d'un sous-compte SÉPARÉ de son compte habituel (411) :
 * ce n'est pas la même dette. Un même tiers réel (même `sourceTable`/
 * `sourceId`) peut donc avoir PLUSIEURS lignes `gl_third_parties`, une par
 * compte collectif concerné — voir la clé unique de la migration 046.
 */
async function getOrCreateThirdParty(conn, { tenantId, partyType, sourceTable, sourceId, displayName, controlAccountId: forcedControlAccountId }) {
  const lookup = CONTROL_ACCOUNT_LOOKUP_BY_PARTY_TYPE[partyType];
  if (!lookup) throw new Error(`Type de tiers inconnu : ${partyType}`);

  // Toujours résolu par une requête (jamais un code brut supposé) : l'auxiliaire
  // doit refléter le compte RÉELLEMENT utilisé, même quand `controlAccountId`
  // force un compte différent de celui par défaut du type de tiers (cas de la
  // caution, 165, plutôt que le 411 habituel du locataire).
  const [accountRows] = forcedControlAccountId
    ? await conn.query('SELECT id, code FROM gl_accounts WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: forcedControlAccountId,
        tenantId,
      })
    : lookup.systemKey
      ? await conn.query('SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId AND system_key = :systemKey LIMIT 1', {
          tenantId,
          systemKey: lookup.systemKey,
        })
      : await conn.query('SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1', {
          tenantId,
          code: lookup.code,
        });
  if (!accountRows[0]) {
    throw new ApiError(
      404,
      `Compte collectif introuvable pour cette entreprise — le plan comptable a-t-il été initialisé (seedGeneralLedger) ?`,
    );
  }
  const controlAccountId = accountRows[0].id;
  const controlCode = accountRows[0].code;

  const [existing] = await conn.query(
    `SELECT * FROM gl_third_parties
     WHERE tenant_id = :tenantId AND party_type = :partyType AND source_table = :sourceTable AND source_id = :sourceId
       AND control_account_id = :controlAccountId
     LIMIT 1`,
    { tenantId, partyType, sourceTable, sourceId, controlAccountId },
  );
  if (existing[0]) return existing[0];

  // Code auxiliaire lisible, ex. "411-000042" — jamais réutilisé (basé sur
  // l'id auto-incrémenté de gl_third_parties lui-même, unique par nature).
  const [result] = await conn.query(
    `INSERT INTO gl_third_parties (tenant_id, control_account_id, party_type, source_table, source_id, auxiliary_code, display_name)
     VALUES (:tenantId, :controlAccountId, :partyType, :sourceTable, :sourceId, '', :displayName)`,
    { tenantId, controlAccountId, partyType, sourceTable, sourceId, displayName },
  );
  const auxiliaryCode = `${controlCode}-${String(result.insertId).padStart(6, '0')}`;
  await conn.query('UPDATE gl_third_parties SET auxiliary_code = :code WHERE id = :id', {
    code: auxiliaryCode,
    id: result.insertId,
  });

  return {
    id: result.insertId,
    tenant_id: tenantId,
    control_account_id: controlAccountId,
    party_type: partyType,
    source_table: sourceTable,
    source_id: sourceId,
    auxiliary_code: auxiliaryCode,
    display_name: displayName,
    is_active: 1,
  };
}

module.exports = { getOrCreateThirdParty, CONTROL_ACCOUNT_LOOKUP_BY_PARTY_TYPE };
