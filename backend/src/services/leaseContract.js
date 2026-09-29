'use strict';

/**
 * Contrat de bail (étape 46, demande directe de l'utilisateur : « attestation loyer doit être changé
 * en contrat de loyer ») — remplace l'ancienne attestation (lettre unilatérale à texte libre). Un vrai
 * document bilatéral structuré par articles, calculés à partir des données RÉELLES du bail (jamais
 * saisis à la main) : parties, objet, durée, loyer, caution(s) — y compris les cautions supplémentaires
 * SBEE/SONEB/peinture (étape 43) —, obligations, conditions particulières (seule partie personnalisable,
 * par bail). Signé par les DEUX parties (locataire + agent), même cycle brouillon → finalisation que les
 * états des lieux : en brouillon, les articles reflètent toujours les données LIVE du bail (aperçu à
 * jour) ; une fois finalisé, un `snapshot` figé fait foi pour toujours, même si le bail change ensuite.
 */

const { pool } = require('../config/db');
const { listLeaseDeposits } = require('./leaseDeposits');
const { RENT_TIMINGS } = require('../constants/rentTiming');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { toActor } = require('../utils/actor');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));
const RENT_TIMING_LABELS = Object.fromEntries(RENT_TIMINGS.map((t) => [t.key, t.label]));

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Toutes les données nécessaires pour remplir les articles du contrat, lues LIVE depuis le bail — pour
 * l'aperçu en brouillon. À la finalisation, exactement cet objet est figé tel quel dans
 * `lease_contracts.snapshot` (voir `finalizeContract` ci-dessous) : les deux chemins (aperçu live,
 * relecture d'un contrat signé) partagent donc la même forme de données et le même rendu PDF.
 */
async function buildContractData(tenantId, leaseId, { particularConditions = null } = {}) {
  const [[row]] = await pool.query(
    `SELECT l.*, r.first_name AS renter_first_name, r.last_name AS renter_last_name, r.phone AS renter_phone,
            u.code AS unit_code, u.designation, u.designation_custom, u.furnished,
            u.soneb_meter_number, u.sbee_meter_number,
            p.code AS property_code, p.address AS property_address, p.property_type AS property_type,
            o.name AS owner_name, o.phone AS owner_phone, o.address AS owner_address
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN owners o ON o.id = p.owner_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!row) throw new Error(`Bail introuvable (id ${leaseId})`);

  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId);

  return {
    renter: { firstName: row.renter_first_name, lastName: row.renter_last_name, phone: row.renter_phone },
    owner: { name: row.owner_name, phone: row.owner_phone, address: row.owner_address },
    property: {
      code: row.property_code,
      address: row.property_address,
      typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
    },
    unit: {
      code: row.unit_code,
      designationLabel: unitDesignationLabel(row),
      furnished: !!row.furnished,
      sonebMeterNumber: row.soneb_meter_number,
      sbeeMeterNumber: row.sbee_meter_number,
    },
    lease: {
      startDate: isoDate(row.start_date),
      monthlyRent: Number(row.monthly_rent),
      rentDueDay: row.rent_due_day,
      rentTiming: row.rent_timing,
      rentTimingLabel: RENT_TIMING_LABELS[row.rent_timing] ?? row.rent_timing,
      depositAmount: Number(row.deposit_amount),
      entryFeeAmount: Number(row.entry_fee_amount ?? 0),
    },
    additionalDeposits: additionalDeposits.map((d) => ({ type: d.type, typeLabel: d.typeLabel, amount: d.amount })),
    particularConditions,
  };
}

function toPublicContract(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    particularConditions: row.particular_conditions,
    tenantSignatureUrl: row.tenant_signature_path ? `/uploads/${row.tenant_signature_path}` : null,
    agentSignatureUrl: row.agent_signature_path ? `/uploads/${row.agent_signature_path}` : null,
    finalizedAt: row.finalized_at,
    finalizedBy: toActor(row.finalizer_first_name, row.finalizer_last_name, row.finalizer_role),
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
  };
}

async function loadContractRow(tenantId, leaseId, db = pool) {
  const [rows] = await db.query(
    `SELECT lc.*, cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
            fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role
     FROM lease_contracts lc
     LEFT JOIN users cu ON cu.id = lc.created_by
     LEFT JOIN users fu ON fu.id = lc.finalized_by
     WHERE lc.tenant_id = :tenantId AND lc.lease_id = :leaseId LIMIT 1`,
    { tenantId, leaseId },
  );
  return rows[0] ?? null;
}

module.exports = {
  buildContractData,
  loadContractRow,
  toPublicContract,
};
