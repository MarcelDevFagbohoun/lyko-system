'use strict';

/**
 * Reversement des cautions au propriétaire.
 *
 * Une caution reçue d'un locataire reste une DETTE du cabinet envers lui. Le cabinet peut néanmoins en remettre une
 * partie au propriétaire (à sa demande, ou pour tout motif justifié) : l'argent sort de la caisse mais la dette
 * demeure — elle devient une créance sur le propriétaire, à récupérer au plus tard à la sortie du locataire.
 *
 *   détenu par le cabinet  = caution encore détenue − net déjà reversé au propriétaire (par bail et par type)
 *   détenu par le propriétaire = Σ reversé − Σ récupéré (tant qu'il n'est pas rendu)
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { assertPeriodOpenLocked } = require('./accountingPeriods');
const { claimIdempotencyKey } = require('./paymentGuards');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { ADDITIONAL_DEPOSIT_LABELS } = require('../constants/leaseDeposits');

const TYPE_LABELS = { loyer: 'Caution de loyer', ...ADDITIONAL_DEPOSIT_LABELS };
const key = (leaseId, type) => `${leaseId}:${type}`;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/** Cautions encore détenues (reçues, non restituées) des Biens d'un propriétaire : une ligne par bail et par type. */
async function loadHeldDeposits(tenantId, ownerId, db = pool) {
  const [loyer] = await db.query(
    `SELECT l.id AS lease_id, l.deposit_amount AS amount, r.first_name, r.last_name, u.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND p.owner_id = :ownerId AND l.deposit_amount > 0
       AND l.deposit_received_at IS NOT NULL AND l.deposit_status = 'held'`,
    { tenantId, ownerId },
  );
  const [extra] = await db.query(
    `SELECT l.id AS lease_id, ld.type, ld.amount, r.first_name, r.last_name, u.code AS unit_code, p.code AS property_code
     FROM lease_deposits ld
     JOIN leases l ON l.id = ld.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE ld.tenant_id = :tenantId AND p.owner_id = :ownerId AND ld.status = 'held'`,
    { tenantId, ownerId },
  );
  return [
    ...loyer.map((r) => ({ ...r, type: 'loyer' })),
    ...extra,
  ].map((r) => ({
    leaseId: r.lease_id,
    type: r.type,
    typeLabel: TYPE_LABELS[r.type] ?? r.type,
    amount: Number(r.amount),
    renterName: `${r.first_name} ${r.last_name}`,
    unitCode: r.unit_code,
    propertyCode: r.property_code,
  }));
}

/** Net reversé au propriétaire (to_owner − from_owner), par bail et par type. */
async function loadNetTransfers(tenantId, ownerId, db = pool) {
  const [rows] = await db.query(
    `SELECT lease_id, deposit_type,
            SUM(CASE WHEN direction = 'to_owner' THEN amount ELSE -amount END) AS net
     FROM owner_deposit_transfers WHERE tenant_id = :tenantId AND owner_id = :ownerId
     GROUP BY lease_id, deposit_type`,
    { tenantId, ownerId },
  );
  return new Map(rows.map((r) => [key(r.lease_id, r.deposit_type), Number(r.net)]));
}

/** Cautions détenues par le cabinet (après reversements) + part détenue par le propriétaire, par type. */
async function getDepositPositions(tenantId, ownerId, db = pool) {
  const [held, net] = await Promise.all([loadHeldDeposits(tenantId, ownerId, db), loadNetTransfers(tenantId, ownerId, db)]);
  const items = held.map((h) => {
    const withOwner = Math.max(0, Math.min(h.amount, net.get(key(h.leaseId, h.type)) ?? 0));
    return { ...h, withOwner, atCabinet: h.amount - withOwner };
  });
  const withOwnerTotal = [...net.values()].reduce((s, v) => s + Math.max(0, v), 0);
  return { items, withOwnerTotal };
}

const createTransfer = async (conn, { tenantId, ownerId, owner, data, recordedBy }) => {
  await assertPeriodOpenLocked(conn, tenantId, data.paidAt);
  await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', { id: ownerId, tenantId });
  // Clé d'idempotence (audit du 2026-10-23, manquait contrairement à la route sœur
  // `/charge-remittances`) : un envoi en double n'enregistre rien de plus.
  if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'deposit_transfer', data.idempotencyKey);
  const { items } = await getDepositPositions(tenantId, ownerId, conn);
  const net = await loadNetTransfers(tenantId, ownerId, conn);
  const netKey = key(data.leaseId, data.depositType);
  const item = items.find((i) => i.leaseId === data.leaseId && i.type === data.depositType);
  const outstanding = net.get(netKey) ?? 0;

  if (data.direction === 'to_owner') {
    if (!item) throw new ApiError(400, 'Cette caution n’est pas détenue par le cabinet (déjà restituée, ou non reçue).');
    if (data.amount > item.atCabinet) {
      throw new ApiError(400, `Montant trop élevé : le cabinet ne détient plus que ${item.atCabinet} FCFA de cette caution.`);
    }
  } else if (data.amount > outstanding) {
    throw new ApiError(400, `Le propriétaire ne détient que ${Math.max(0, outstanding)} FCFA de cette caution.`);
  }

  const [res] = await conn.query(
    `INSERT INTO owner_deposit_transfers
       (tenant_id, owner_id, lease_id, deposit_type, direction, amount, paid_at, payment_method, motive, requested_by_owner, recorded_by)
     VALUES (:tenantId, :ownerId, :leaseId, :depositType, :direction, :amount, :paidAt, :paymentMethod, :motive, :requestedByOwner, :recordedBy)`,
    {
      tenantId, ownerId, leaseId: data.leaseId, depositType: data.depositType, direction: data.direction, amount: data.amount,
      paidAt: data.paidAt, paymentMethod: data.paymentMethod, motive: data.motive, requestedByOwner: data.requestedByOwner ? 1 : 0, recordedBy,
    },
  );

  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId,
      operationType: data.direction === 'to_owner' ? 'caution_reversee_proprietaire' : 'caution_recuperee_proprietaire',
      entryDate: data.paidAt,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      narrationVars: { proprietaire: owner.name, type: TYPE_LABELS[data.depositType] ?? data.depositType },
      sourceTable: 'owner_deposit_transfers',
      sourceId: res.insertId,
      createdBy: recordedBy,
      context: { ownerId },
    });
  }
  return res.insertId;
};

async function listTransfers(tenantId, ownerId, { limit = 100, month = null } = {}, db = pool) {
  const [rows] = await db.query(
    `SELECT t.*, r.first_name, r.last_name, u.code AS unit_code, us.first_name AS by_first, us.last_name AS by_last
     FROM owner_deposit_transfers t
     JOIN leases l ON l.id = t.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     LEFT JOIN users us ON us.id = t.recorded_by
     WHERE t.tenant_id = :tenantId AND t.owner_id = :ownerId ${month ? "AND DATE_FORMAT(t.paid_at, '%Y-%m') = :month" : ''}
     ORDER BY t.paid_at DESC, t.id DESC LIMIT ${Number(limit) || 100}`,
    { tenantId, ownerId, month },
  );
  return rows.map((t) => ({
    id: t.id,
    leaseId: t.lease_id,
    renterName: `${t.first_name} ${t.last_name}`,
    unitCode: t.unit_code,
    depositType: t.deposit_type,
    typeLabel: TYPE_LABELS[t.deposit_type] ?? t.deposit_type,
    direction: t.direction,
    amount: Number(t.amount),
    paidAt: iso(t.paid_at),
    paymentMethod: t.payment_method,
    motive: t.motive,
    requestedByOwner: !!t.requested_by_owner,
    recordedByName: t.by_first ? `${t.by_first} ${t.by_last}` : null,
  }));
}

module.exports = { TYPE_LABELS, getDepositPositions, loadNetTransfers, createTransfer, listTransfers };
