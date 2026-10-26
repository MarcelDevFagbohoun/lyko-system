'use strict';

/**
 * Factures SONEB/SBEE refacturées aux locataires (`utility_charges`) et leurs règlements
 * (`utility_payments`) : toutes les requêtes SQL de la route `/api/charges` vivent ici, ainsi que le
 * cœur commun du règlement (`recordUtilityPayment`), réutilisé par le portail locataire, les liens de
 * paiement, la vérification FedaPay et la sortie de bail. Chaque fonction est isolée par `tenantId` et,
 * pour un agent restreint, par `scopeAgentId` (`null` = accès complet).
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { claimIdempotencyKey, DUPLICATE_MESSAGE } = require('./paymentGuards');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { assertLeaseInScope } = require('./scope');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { notifyUtilityPaymentRecorded } = require('./payments/notify');
const { isoDate } = require('../utils/dates');

// Un lien de paiement expire par défaut sous 48h — même valeur que leases.js.
const PAYMENT_LINK_TTL_HOURS = 48;

const CHARGE_SELECT = `
  uc.*,
  COALESCE(pt.paid_total, 0) AS paid_total,
  l.status AS lease_status,
  r.id AS renter_id, r.first_name AS renter_first_name, r.last_name AS renter_last_name, r.phone AS renter_phone,
  u.id AS unit_id, u.code AS unit_code,
  p.id AS property_id, p.code AS property_code,
  ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name, ru.role AS recorder_role,
  pu.first_name AS payer_first_name, pu.last_name AS payer_last_name, pu.role AS payer_role
`;
const CHARGE_JOINS = `
  FROM utility_charges uc
  LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
  JOIN leases l ON l.id = uc.lease_id
  JOIN renters r ON r.id = l.renter_id
  JOIN property_units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id
  LEFT JOIN users ru ON ru.id = uc.recorded_by
  LEFT JOIN users pu ON pu.id = uc.paid_recorded_by
`;

/**
 * Charge un bail actif de l'entreprise courante, ou lève une erreur explicite. `scopeAgentId` (via
 * `resolvePropertyScope`) : `null` = accès complet, sinon vérifié contre `properties.agent_id` (sans
 * quoi un agent restreint verrait les factures de toute l'entreprise).
 */
async function loadActiveLease(tenantId, leaseId, scopeAgentId) {
  const lease = await assertLeaseInScope(tenantId, leaseId, scopeAgentId);
  if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est terminé : impossible d\'y rattacher une facture');
  return lease;
}

/** Charge une facture de l'entreprise courante (non supprimée) dans la portée de l'agent, ou lève 404. */
async function loadCharge(conn, tenantId, id, scopeAgentId) {
  const [rows] = await conn.query(
    `SELECT uc.*, p.agent_id AS property_agent_id
     FROM utility_charges uc
     JOIN leases l ON l.id = uc.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE uc.id = :id AND uc.tenant_id = :tenantId AND uc.deleted_at IS NULL LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Facture introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Facture introuvable');
  }
  return rows[0];
}

/** Une facture avec tout son contexte (locataire, unité, Bien, auteurs) pour l'affichage, ou undefined. */
async function getChargeRow(id, db = pool) {
  const [rows] = await db.query(`SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE uc.id = :id`, { id });
  return rows[0];
}

/** Index de fin de la dernière facture de ce bail pour ce fluide (préremplit l'index de début), ou null. */
async function getPreviousReadingEnd(tenantId, leaseId, utilityType, scopeAgentId) {
  await assertLeaseInScope(tenantId, leaseId, scopeAgentId);
  const [[row]] = await pool.query(
    `SELECT reading_end FROM utility_charges
     WHERE tenant_id = :tenantId AND lease_id = :leaseId AND utility_type = :utilityType AND deleted_at IS NULL
     ORDER BY billed_at DESC, id DESC LIMIT 1`,
    { tenantId, leaseId, utilityType },
  );
  return row ? row.reading_end : null;
}

/** Registre des factures (filtres facultatifs : status, utilityType, leaseId, q), portée agent comprise. */
async function listCharges(tenantId, scopeAgentId, { status, utilityType, leaseId, q }) {
  const params = { tenantId };
  let where = 'uc.tenant_id = :tenantId AND uc.deleted_at IS NULL';
  if (scopeAgentId != null) {
    where += ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  if (status) {
    where += ' AND uc.status = :status';
    params.status = status;
  }
  if (utilityType) {
    where += ' AND uc.utility_type = :utilityType';
    params.utilityType = utilityType;
  }
  if (leaseId) {
    where += ' AND uc.lease_id = :leaseId';
    params.leaseId = leaseId;
  }
  if (q) {
    where += ' AND (r.first_name LIKE :q OR r.last_name LIKE :q OR u.code LIKE :q)';
    params.q = `%${q}%`;
  }
  const [rows] = await pool.query(
    `SELECT ${CHARGE_SELECT} ${CHARGE_JOINS} WHERE ${where} ORDER BY uc.billed_at DESC, uc.id DESC`,
    params,
  );
  return rows;
}

/**
 * Encadré « Ce mois-ci » : factures émises dans le mois (facturé / réglé / reste), règlements reçus dans
 * le mois et ce qui reste dû sur les mois précédents. Factures supprimées logiquement ignorées.
 */
async function getMonthSummary(tenantId, scopeAgentId, month, currentMonth) {
  const [y, m] = month.split('-').map(Number);
  const params = {
    tenantId,
    firstDay: `${month}-01`,
    lastDay: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
  if (scopeAgentId != null) params.scopeAgentId = scopeAgentId;
  const paidPerCharge = '(SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id)';
  // Jointure jusqu'au Bien uniquement quand le cloisonnement par agent l'exige.
  const scopeJoin = scopeAgentId != null
    ? 'JOIN leases scl ON scl.id = uc.lease_id JOIN property_units scu ON scu.id = scl.unit_id JOIN properties scp ON scp.id = scu.property_id'
    : '';
  const scopeWhere = scopeAgentId != null ? ' AND scp.agent_id = :scopeAgentId' : '';

  const [[billed]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(uc.amount), 0) AS billed, COALESCE(SUM(pt.paid_total), 0) AS paid
     FROM utility_charges uc LEFT JOIN ${paidPerCharge} pt ON pt.charge_id = uc.id ${scopeJoin}
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.billed_at BETWEEN :firstDay AND :lastDay${scopeWhere}`,
    params,
  );
  const [[older]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(uc.amount - COALESCE(pt.paid_total, 0)), 0) AS remaining
     FROM utility_charges uc LEFT JOIN ${paidPerCharge} pt ON pt.charge_id = uc.id ${scopeJoin}
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee' AND uc.billed_at < :firstDay${scopeWhere}`,
    params,
  );
  const [[received]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(up.amount), 0) AS total
     FROM utility_payments up JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL ${scopeJoin}
     WHERE up.tenant_id = :tenantId AND up.paid_at BETWEEN :firstDay AND :lastDay${scopeWhere}`,
    params,
  );
  const billedTotal = Number(billed.billed);
  const paid = Math.min(Number(billed.paid), billedTotal);
  return {
    month,
    isCurrentMonth: month === currentMonth,
    billedCount: Number(billed.n),
    billed: billedTotal,
    paid,
    remaining: billedTotal - paid,
    receivedInMonth: Number(received.total),
    receivedCount: Number(received.n),
    olderRemaining: Number(older.remaining),
    olderCount: Number(older.n),
  };
}

/** Total déjà réglé sur une facture. */
async function getPaidTotal(chargeId, db = pool) {
  const [[{ paidTotal }]] = await db.query(
    'SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM utility_payments WHERE charge_id = :id',
    { id: chargeId },
  );
  return Number(paidTotal);
}

/** Enregistre une facture sur un bail actif ; le montant est toujours consommation × prix unitaire. */
async function createCharge(tenantId, userId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    await loadActiveLease(tenantId, data.leaseId, scopeAgentId);
    await assertPeriodOpen(tenantId, data.billedAt);

    // Le montant n'est jamais saisi : toujours consommation (index fin - index début) × prix unitaire,
    // arrondi au franc le plus proche.
    const consumption = data.readingEnd - data.readingStart;
    const amount = Math.round(consumption * data.unitPrice);

    await conn.beginTransaction();
    // Re-vérifie SOUS VERROU, dans la transaction — voir `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.billedAt);
    // Clé d'idempotence : un double-clic ne doit jamais créer deux factures identiques (`paymentGuards.js`).
    if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'charge_created', data.idempotencyKey);
    const [result] = await conn.query(
      `INSERT INTO utility_charges
         (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end,
          unit_price, amount, billed_at, notes, recorded_by)
       VALUES (:tenantId, :leaseId, :utilityType, :periodStart, :periodEnd, :readingStart, :readingEnd,
               :unitPrice, :amount, :billedAt, :notes, :recordedBy)`,
      {
        tenantId,
        leaseId: data.leaseId,
        utilityType: data.utilityType,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        readingStart: data.readingStart,
        readingEnd: data.readingEnd,
        unitPrice: data.unitPrice,
        amount,
        billedAt: data.billedAt,
        notes: data.notes,
        recordedBy: userId,
      },
    );
    await conn.commit();
    return { chargeId: result.insertId, consumption, amount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Corrige une facture avant tout règlement ; renvoie la ligne d'affichage à jour. */
async function updateCharge(tenantId, id, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadCharge(pool, tenantId, id, scopeAgentId);
    await assertPeriodOpen(tenantId, existing.billed_at);
    if (data.billedAt !== undefined) {
      await assertPeriodOpen(tenantId, data.billedAt);
    }

    // Un paiement (même partiel) déjà enregistré fige le montant : le modifier désynchroniserait la
    // facture de ce qui a déjà été réglé.
    if (data.readingStart !== undefined || data.readingEnd !== undefined || data.unitPrice !== undefined) {
      if ((await getPaidTotal(id)) > 0) {
        throw new ApiError(409, 'Un paiement a déjà été enregistré sur cette facture — impossible de modifier le montant.');
      }
    }

    const fields = [];
    const params = { id };
    if (data.utilityType !== undefined) { fields.push('utility_type = :utilityType'); params.utilityType = data.utilityType; }
    if (data.periodStart !== undefined) { fields.push('period_start = :periodStart'); params.periodStart = data.periodStart; }
    if (data.periodEnd !== undefined) { fields.push('period_end = :periodEnd'); params.periodEnd = data.periodEnd; }
    if (data.readingStart !== undefined) { fields.push('reading_start = :readingStart'); params.readingStart = data.readingStart; }
    if (data.readingEnd !== undefined) { fields.push('reading_end = :readingEnd'); params.readingEnd = data.readingEnd; }
    if (data.unitPrice !== undefined) { fields.push('unit_price = :unitPrice'); params.unitPrice = data.unitPrice; }
    if (data.billedAt !== undefined) { fields.push('billed_at = :billedAt'); params.billedAt = data.billedAt; }
    if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

    // Le montant recalcule dès que l'un des trois facteurs change, en combinant les nouvelles valeurs
    // avec celles déjà en base.
    if (data.readingStart !== undefined || data.readingEnd !== undefined || data.unitPrice !== undefined) {
      const readingStart = data.readingStart ?? existing.reading_start;
      const readingEnd = data.readingEnd ?? existing.reading_end;
      const unitPrice = data.unitPrice ?? Number(existing.unit_price);
      if (readingEnd < readingStart) {
        throw new ApiError(400, "L'index de fin doit être supérieur ou égal à l'index de début", {
          readingEnd: ["L'index de fin doit être supérieur ou égal à l'index de début"],
        });
      }
      fields.push('amount = :amount');
      params.amount = Math.round((readingEnd - readingStart) * unitPrice);
    }

    if (fields.length > 0) {
      await conn.beginTransaction();
      await assertPeriodOpenLocked(conn, tenantId, existing.billed_at);
      if (data.billedAt !== undefined) {
        await assertPeriodOpenLocked(conn, tenantId, data.billedAt);
      }
      await conn.query(`UPDATE utility_charges SET ${fields.join(', ')} WHERE id = :id`, params);
      await conn.commit();
    }

    return getChargeRow(id);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Historique des règlements d'une facture. */
async function listChargePayments(tenantId, id, scopeAgentId) {
  await loadCharge(pool, tenantId, id, scopeAgentId);
  const [rows] = await pool.query(
    `SELECT up.id, up.amount, up.payment_method, up.paid_at, up.notes, up.created_at,
            pu.first_name AS recorder_first_name, pu.last_name AS recorder_last_name, pu.role AS recorder_role
     FROM utility_payments up
     LEFT JOIN users pu ON pu.id = up.recorded_by
     WHERE up.charge_id = :id ORDER BY up.paid_at DESC, up.id DESC`,
    { id },
  );
  return rows;
}

/**
 * Cœur commun du règlement d'une facture SONEB/SBEE (total ou partiel) :
 * vérifie le solde restant, insère `utility_payments`, met à jour le statut
 * de `utility_charges`. Seul endroit qui insère dans `utility_payments` —
 * utilisé par la route manuelle ci-dessous ET par les chemins FedaPay
 * (portail, lien de paiement, webhook). Appelant responsable du verrou
 * (`SELECT ... FOR UPDATE` sur `utility_charges`) et de la transaction.
 *
 * `recordedBy` : `null` pour un règlement confirmé par FedaPay.
 */
async function recordUtilityPayment(
  conn,
  { tenantId, charge, amount, paymentMethod, paidAt, notes, recordedBy, onlineTransactionId = null, settledFromDeposit = false },
) {
  // Bug corrigé (audit fermeture du mois, point 3, 16/10/2026) : ce point d'insertion UNIQUE dans
  // `utility_payments` ne vérifiait jamais lui-même la clôture du mois — seul l'appelant "route directe"
  // (`POST /:id/payments`) le faisait, jamais le règlement par caution à la sortie
  // (`settleUnpaidUtilityCharges`/`finalizeAdditionalDeposits`). Vérifié ICI, une fois pour toutes :
  // toujours appelée DANS une transaction déjà ouverte par l'appelant, la version verrouillée suffit.
  await assertPeriodOpenLocked(conn, tenantId, paidAt);

  const [[{ paidTotal }]] = await conn.query(
    'SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM utility_payments WHERE charge_id = :id',
    { id: charge.id },
  );
  const remaining = Number(charge.amount) - Number(paidTotal);
  if (amount > remaining) {
    throw new ApiError(400, `Le montant dépasse le solde restant (${remaining} FCFA).`);
  }

  const [paymentResult] = await conn.query(
    `INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, notes, recorded_by, online_transaction_id, settled_from_deposit)
     VALUES (:tenantId, :chargeId, :amount, :paymentMethod, :paidAt, :notes, :recordedBy, :onlineTransactionId, :settledFromDeposit)`,
    {
      tenantId,
      chargeId: charge.id,
      amount,
      paymentMethod,
      paidAt,
      notes: notes ?? null,
      recordedBy: recordedBy ?? null,
      onlineTransactionId,
      settledFromDeposit: settledFromDeposit ? 1 : 0,
    },
  );

  const newPaidTotal = Number(paidTotal) + amount;
  const newStatus = newPaidTotal >= Number(charge.amount) ? 'payee' : 'partiellement_payee';
  await conn.query(
    `UPDATE utility_charges
     SET status = :status, paid_at = :paidAt, payment_method = :paymentMethod, paid_recorded_by = :by
     WHERE id = :id`,
    { status: newStatus, paidAt, paymentMethod, by: recordedBy ?? null, id: charge.id },
  );

  // Module comptabilité SYSCOHADA (nouveau) — voir le commentaire identique
  // dans routes/leases.js `recordRentPayment` : rien ne change pour une
  // entreprise qui n'a pas activé le module.
  if (await isModuleActive(conn, tenantId)) {
    const [renterRows] = await conn.query(
      `SELECT r.first_name, r.last_name FROM leases l JOIN renters r ON r.id = l.renter_id WHERE l.id = :leaseId LIMIT 1`,
      { leaseId: charge.lease_id },
    );
    const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';
    await genererEcriture(conn, {
      tenantId,
      operationType: settledFromDeposit ? 'charge_locative_reglee_par_caution' : 'charge_locative_encaissee',
      entryDate: paidAt,
      amount,
      paymentMethod,
      narrationVars: {
        fluide: charge.utility_type === 'soneb' ? 'SONEB' : 'SBEE',
        periode: `${isoDate(charge.period_start)} au ${isoDate(charge.period_end)}`,
        locataire: renterName,
      },
      sourceTable: 'utility_payments',
      sourceId: paymentResult.insertId,
      createdBy: recordedBy,
      context: { leaseId: charge.lease_id },
    });
  }

  return { paymentId: paymentResult.insertId, newStatus, newPaidTotal };
}

/** Enregistre un règlement manuel (total ou partiel) sur une facture. */
async function recordManualPayment(tenantId, userId, id, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const charge = await loadCharge(conn, tenantId, id, scopeAgentId);
    if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà entièrement réglée.');
    await assertPeriodOpen(tenantId, charge.billed_at);

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, charge.billed_at);
    // Sérialise les enregistrements concurrents sur cette facture — même principe que les paiements de
    // loyer (routes/leases.js).
    await conn.query('SELECT id FROM utility_charges WHERE id = :id FOR UPDATE', { id });

    // Garde anti-doublon (étape 36). Voie normale : clé d'idempotence jointe à l'envoi, réclamée dans la
    // transaction — deux règlements VOULUS, même de montants égaux le même jour avec le même mode, ne
    // sont jamais confondus. Envoi SANS clé (ancien client) : heuristique héritée — même date, mode et
    // montant sous 2 minutes.
    if (data.idempotencyKey) {
      await claimIdempotencyKey(conn, tenantId, 'charge_payment', data.idempotencyKey);
    } else {
      const [recent] = await conn.query(
        `SELECT COUNT(*) AS n FROM utility_payments
         WHERE charge_id = :id AND paid_at = :paidAt AND payment_method = :method AND amount = :amount
           AND created_at > (NOW() - INTERVAL 2 MINUTE)`,
        { id, paidAt: data.paidAt, method: data.paymentMethod, amount: data.amount },
      );
      if (Number(recent[0].n) > 0) {
        throw new ApiError(409, DUPLICATE_MESSAGE, { code: ['duplicate_request'] });
      }
    }

    const { newStatus, paymentId } = await recordUtilityPayment(conn, {
      tenantId,
      charge,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      paidAt: data.paidAt,
      notes: data.notes,
      recordedBy: userId,
    });
    await conn.commit();
    notifyUtilityPaymentRecorded(tenantId, paymentId);
    return { newStatus, paymentId };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Suppression logique d'une facture mal saisie : la trace reste en base avec une justification, mais le
 * montant sort des totaux. Refusée dès qu'un règlement existe (l'écriture GL déjà posée ne serait pas
 * annulée et le solde séquestre pourrait devenir négatif).
 */
async function deleteCharge(tenantId, userId, id, scopeAgentId, reason) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadCharge(pool, tenantId, id, scopeAgentId);
    await assertPeriodOpen(tenantId, existing.billed_at);
    if ((await getPaidTotal(id)) > 0) {
      throw new ApiError(409, 'Un paiement a déjà été enregistré sur cette facture — impossible de la supprimer.');
    }
    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, existing.billed_at);
    await conn.query(
      'UPDATE utility_charges SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: userId, reason, id },
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Génère un lien de paiement FedaPay pour le solde restant d'une facture (révélé une seule fois). */
async function createPaymentLink(tenantId, userId, id, scopeAgentId) {
  const charge = await loadCharge(pool, tenantId, id, scopeAgentId);
  if (charge.status === 'payee') throw new ApiError(400, 'Cette facture est déjà entièrement réglée.');

  const [[tenant]] = await pool.query('SELECT fedapay_collect_enabled FROM tenants WHERE id = :id LIMIT 1', {
    id: tenantId,
  });
  if (!tenant?.fedapay_collect_enabled) {
    throw new ApiError(400, 'Le paiement en ligne (FedaPay) n\'est pas activé pour votre entreprise (Réglages).');
  }

  const remaining = Number(charge.amount) - (await getPaidTotal(id));

  const token = generatePortalToken();
  const [result] = await pool.query(
    `INSERT INTO payment_links (tenant_id, kind, charge_id, amount, token_hash, created_by, expires_at)
     VALUES (:tenantId, 'charge', :chargeId, :amount, :hash, :by, DATE_ADD(NOW(), INTERVAL :ttl HOUR))`,
    {
      tenantId,
      chargeId: id,
      amount: remaining,
      hash: hashToken(token),
      by: userId,
      ttl: PAYMENT_LINK_TTL_HOURS,
    },
  );
  return { token, linkId: result.insertId, remaining };
}

module.exports = {
  loadCharge,
  recordUtilityPayment,
  getChargeRow,
  getPreviousReadingEnd,
  listCharges,
  getMonthSummary,
  createCharge,
  updateCharge,
  listChargePayments,
  recordManualPayment,
  deleteCharge,
  createPaymentLink,
};
