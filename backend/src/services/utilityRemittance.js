'use strict';

/**
 * Étape 31 — Reversement au propriétaire des charges SONEB/SBEE encaissées.
 *
 * Le propriétaire règle la facture mère ; le cabinet encaisse chez les
 * locataires puis lui reverse (le cabinet ne garde rien sur les charges).
 *
 *   encaissé  = Σ règlements reçus sur les factures de charges de SES Biens
 *               (factures supprimées logiquement exclues, comme partout)
 *   reversé   = Σ reversements non annulés (`owner_charge_remittances`)
 *   à reverser = encaissé − reversé
 *
 * Volontairement SÉPARÉ du solde séquestre des loyers (`getEscrowBalances`) :
 * ni commission ni IRF ne s'appliquent à un remboursement de charges.
 *
 * Toutes les fonctions acceptent `db` (pool OU connexion de transaction) pour
 * que la garde de solde puisse être évaluée DANS la transaction qui insère.
 */

const { ApiError } = require('../middleware/error');

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/** Encaissé et reversé, par propriétaire (un seul si `ownerId`). Map<ownerId, { collected, remitted, balance }>. */
async function getChargeAccounts(db, tenantId, { ownerId = null } = {}) {
  const ownerFilter = ownerId != null ? 'AND p.owner_id = :ownerId' : '';
  const params = { tenantId, ownerId };

  const [collectedRows] = await db.query(
    `SELECT p.owner_id, COALESCE(SUM(up.amount), 0) AS total
     FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL
     JOIN leases l ON l.id = uc.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE up.tenant_id = :tenantId ${ownerFilter}
     GROUP BY p.owner_id`,
    params,
  );
  const [remittedRows] = await db.query(
    `SELECT owner_id, COALESCE(SUM(amount), 0) AS total
     FROM owner_charge_remittances
     WHERE tenant_id = :tenantId AND deleted_at IS NULL ${ownerId != null ? 'AND owner_id = :ownerId' : ''}
     GROUP BY owner_id`,
    params,
  );

  const accounts = new Map();
  const ensure = (id) => {
    if (!accounts.has(id)) accounts.set(id, { collected: 0, remitted: 0, balance: 0 });
    return accounts.get(id);
  };
  for (const r of collectedRows) ensure(r.owner_id).collected = Number(r.total);
  for (const r of remittedRows) ensure(r.owner_id).remitted = Number(r.total);
  for (const a of accounts.values()) a.balance = a.collected - a.remitted;
  return accounts;
}

async function getChargeAccount(db, tenantId, ownerId) {
  const accounts = await getChargeAccounts(db, tenantId, { ownerId });
  return accounts.get(ownerId) ?? { collected: 0, remitted: 0, balance: 0 };
}

/**
 * Garde-fou (même esprit que `assertPayoutWithinBalance`, audit A2) : on ne
 * peut pas reverser plus de charges qu'on n'en a réellement encaissées pour
 * ce propriétaire.
 */
async function assertRemittanceWithinBalance(db, tenantId, ownerId, amount) {
  const { balance } = await getChargeAccount(db, tenantId, ownerId);
  if (amount > balance) {
    throw new ApiError(
      400,
      `Montant supérieur aux charges à reverser à ce propriétaire (${Math.max(balance, 0)} FCFA encaissés et pas encore reversés).`,
    );
  }
}

/** Reversements d'un propriétaire, du plus récent au plus ancien (annulés exclus par défaut). */
async function listRemittances(db, tenantId, ownerId, { fromDate = null, toDate = null, includeDeleted = false, limit = 200 } = {}) {
  const where = ['cr.tenant_id = :tenantId', 'cr.owner_id = :ownerId'];
  if (!includeDeleted) where.push('cr.deleted_at IS NULL');
  if (fromDate) where.push('cr.paid_at >= :fromDate');
  if (toDate) where.push('cr.paid_at <= :toDate');
  const [rows] = await db.query(
    `SELECT cr.*, u.first_name AS by_first_name, u.last_name AS by_last_name, u.role AS by_role
     FROM owner_charge_remittances cr
     LEFT JOIN users u ON u.id = cr.recorded_by
     WHERE ${where.join(' AND ')}
     ORDER BY cr.paid_at DESC, cr.id DESC
     LIMIT ${Number(limit)}`,
    { tenantId, ownerId, fromDate, toDate },
  );
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    periodLabel: r.period_label,
    paidAt: isoDate(r.paid_at),
    paymentMethod: r.payment_method,
    notes: r.notes,
    createdAt: r.created_at,
    byFirstName: r.by_first_name,
    byLastName: r.by_last_name,
    byRole: r.by_role,
    deletedAt: r.deleted_at,
    deletedReason: r.deleted_reason,
  }));
}

/**
 * Depuis quand des charges encaissées attendent d'être reversées, par
 * propriétaire : date du plus ancien règlement pas encore « couvert » par un
 * reversement (ordre chronologique — les reversements soldent d'abord les
 * plus anciens encaissements). Map<ownerId, 'AAAA-MM-JJ'>, uniquement pour
 * les propriétaires dont le solde est > 0.
 */
async function getOldestUnremittedDates(db, tenantId) {
  const [payments] = await db.query(
    `SELECT p.owner_id, up.paid_at, up.amount
     FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL
     JOIN leases l ON l.id = uc.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE up.tenant_id = :tenantId
     ORDER BY p.owner_id, up.paid_at, up.id`,
    { tenantId },
  );
  const accounts = await getChargeAccounts(db, tenantId);
  const result = new Map();
  const running = new Map();
  for (const pay of payments) {
    const acc = accounts.get(pay.owner_id);
    if (!acc || acc.balance <= 0 || result.has(pay.owner_id)) continue;
    const cumulative = (running.get(pay.owner_id) ?? 0) + Number(pay.amount);
    running.set(pay.owner_id, cumulative);
    if (cumulative > acc.remitted) result.set(pay.owner_id, isoDate(pay.paid_at));
  }
  return result;
}

module.exports = {
  getChargeAccounts,
  getChargeAccount,
  assertRemittanceWithinBalance,
  listRemittances,
  getOldestUnremittedDates,
};
