'use strict';

const crypto = require('crypto');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const logger = require('../../utils/logger');
const fedapay = require('./fedapay');
const { appendAudit } = require('./audit');
const { assertPasswordReauth } = require('./reauth');
const { normalizeBeninPhone, maskPhone } = require('./phone');
const { notifyOrderSent } = require('./notify');
const { getEscrowBalances, getReservedOwnerPayouts } = require('../commission');
const { assertPeriodOpenLocked } = require('../accountingPeriods');
const { isModuleActive, genererEcriture } = require('../gl/glPostingService');
const { todayIso } = require('../../utils/dates');

/**
 * Ordres de paiement sortants (salaires, reversements propriétaires, paiements libres) via FedaPay.
 *
 * Cycle de vie : created → processing (FedaPay a accepté l'envoi) → sent (FedaPay confirme) | failed.
 * RÈGLE CENTRALE : l'effet métier (versement, fiche de paie, dépense, écriture comptable) n'est appliqué QUE
 * lorsque le statut `sent` a été RELU chez FedaPay par le serveur, et une seule fois (verrou + `applied_at`).
 * Aucun statut fourni par un client ou un webhook n'est jamais cru tel quel.
 */

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
function newReference() {
  const bytes = crypto.randomBytes(14);
  let out = 'LYK-';
  for (const b of bytes) out += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return out; // 4 + 14 = 18 caractères
}

/** Vue publique d'un ordre : numéro masqué, jamais la clé d'idempotence ni le contexte interne brut. */
function toPublicOrder(row) {
  return {
    id: row.id,
    reference: row.reference,
    purpose: row.purpose,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    beneficiaryType: row.beneficiary_type,
    beneficiaryName: row.beneficiary_name,
    beneficiaryPhoneMasked: maskPhone(row.beneficiary_phone),
    operator: row.operator,
    label: row.label,
    providerStatus: row.provider_status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    applied: !!row.applied_at,
    appliedRef: row.applied_ref,
    createdBy: row.created_by,
  };
}

async function loadTenant(tenantId) {
  const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  return tenant;
}

async function loadOrder(tenantId, orderId, db = pool) {
  const [[row]] = await db.query('SELECT * FROM payment_orders WHERE id = :orderId AND tenant_id = :tenantId LIMIT 1', { orderId, tenantId });
  if (!row) throw new ApiError(404, 'Paiement introuvable');
  return row;
}

async function assertWithinLimits(tenant, amount) {
  if (amount > Number(tenant.payments_per_order_limit)) {
    throw new ApiError(422, `Montant supérieur au plafond par paiement (${Number(tenant.payments_per_order_limit)} FCFA).`);
  }
  const [[row]] = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payment_orders WHERE tenant_id = :tenantId AND status <> 'failed' AND DATE(created_at) = CURDATE()",
    { tenantId: tenant.id },
  );
  if (Number(row.total) + amount > Number(tenant.payments_daily_limit)) {
    throw new ApiError(422, `Plafond journalier atteint (${Number(tenant.payments_daily_limit)} FCFA par jour).`);
  }
}

/** Résout bénéficiaire, montant, libellé et contexte selon l'objet — toute donnée vient de la base, jamais du client. */
async function resolvePurpose(tenantId, input) {
  if (input.purpose === 'salaire') {
    const [[employee]] = await pool.query(
      "SELECT id, first_name, last_name, email, status FROM users WHERE id = :id AND tenant_id = :tenantId LIMIT 1",
      { id: input.userId, tenantId },
    );
    if (!employee) throw new ApiError(404, 'Employé introuvable');
    if (employee.status !== 'active') throw new ApiError(422, "Cet employé n'est plus actif.");
    const gross = input.baseAmount + input.bonusAmount;
    const { loadPayrollSettings, computePayroll } = require('../payroll');
    const payroll = computePayroll(await loadPayrollSettings(pool, tenantId), { gross, deduction: input.deductionAmount });
    const net = payroll.net;
    if (input.deductionAmount > gross || net <= 0) throw new ApiError(422, 'Le net à payer doit être supérieur à 0.');
    const [[existing]] = await pool.query(
      "SELECT id FROM payslips WHERE tenant_id = :tenantId AND user_id = :userId AND period = :period AND deleted_at IS NULL LIMIT 1",
      { tenantId, userId: input.userId, period: input.period },
    );
    if (existing) throw new ApiError(409, `Le salaire de ${input.period} a déjà été payé à cet employé.`);
    const name = `${employee.first_name} ${employee.last_name}`;
    return {
      amount: net,
      beneficiary: { type: 'employee', userId: employee.id, ownerId: null, name, email: input.beneficiaryEmail ?? employee.email ?? null },
      label: `Salaire ${input.period} — ${name}`,
      context: {
        userId: employee.id, period: input.period, baseAmount: input.baseAmount, bonusAmount: input.bonusAmount,
        bonusLabel: input.bonusLabel, deductionAmount: input.deductionAmount, deductionLabel: input.deductionLabel,
        payroll,
      },
    };
  }

  if (input.purpose === 'reversement_proprietaire') {
    const [[owner]] = await pool.query(
      'SELECT id, name, email, mandate_ended_at FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id: input.ownerId, tenantId },
    );
    if (!owner) throw new ApiError(404, 'Propriétaire introuvable');
    if (owner.mandate_ended_at) throw new ApiError(422, 'Le mandat de ce propriétaire est terminé.');
    // Solde séquestre RÉSERVÉ : ce qui est déjà en cours d'envoi (ou envoyé mais pas encore enregistré) est déduit,
    // pour que deux ordres simultanés ne puissent pas dépasser ensemble ce qui est réellement dû. Même calcul que
    // `assertPayoutWithinBalance` (versement manuel, routes/owners.js) — une seule source de vérité partagée
    // depuis l'audit du 2026-10-23, pour que les deux chemins se voient mutuellement.
    const balances = await getEscrowBalances(tenantId);
    const balance = balances.get(owner.id)?.balance ?? 0;
    const reserved = await getReservedOwnerPayouts(tenantId, owner.id);
    if (input.amount > balance - reserved) {
      throw new ApiError(422, `Le montant dépasse le solde disponible pour ce propriétaire (${Math.max(0, balance - reserved)} FCFA).`);
    }
    return {
      amount: input.amount,
      beneficiary: { type: 'owner', userId: null, ownerId: owner.id, name: owner.name, email: input.beneficiaryEmail ?? owner.email ?? null },
      label: `Reversement ${input.periodLabel} — ${owner.name}`,
      context: { ownerId: owner.id, periodLabel: input.periodLabel },
    };
  }

  return {
    amount: input.amount,
    beneficiary: { type: 'other', userId: null, ownerId: null, name: input.beneficiaryName, email: input.beneficiaryEmail ?? null },
    label: input.label,
    context: { category: 'autre' },
  };
}

/**
 * Crée l'ordre puis demande l'envoi à FedaPay. `ctx` : { user, req }. Rejoue un ordre déjà créé avec la même clé
 * d'idempotence (même cabinet) sans rien renvoyer à FedaPay.
 */
async function createOrder({ user, req }, rawInput) {
  let input = rawInput;
  const tenant = await loadTenant(user.tenantId);
  if (!tenant.fedapay_enabled || !tenant.fedapay_secret_key_enc) {
    throw new ApiError(403, "Les paiements sortants ne sont pas activés pour cette entreprise.");
  }

  // Rejeu : même clé = même ordre (aucune nouvelle re-saisie de mot de passe nécessaire pour lire le résultat).
  const [[replay]] = await pool.query('SELECT * FROM payment_orders WHERE tenant_id = :tenantId AND idempotency_key = :key LIMIT 1', {
    tenantId: user.tenantId, key: input.idempotencyKey,
  });
  if (replay) return { order: replay, replayed: true };

  try {
    await assertPasswordReauth(user.id, input.password);
  } catch (err) {
    await appendAudit({ tenantId: user.tenantId, eventType: 'reauth_failed', actorUserId: user.id, req, details: { purpose: input.purpose } }).catch(() => {});
    throw err;
  }

  if (input.purpose === 'salaire' && (!input.phone || !input.operator)) {
    const [[emp]] = await pool.query('SELECT momo_phone, momo_operator FROM users WHERE id = :id AND tenant_id = :tenantId LIMIT 1', { id: input.userId, tenantId: user.tenantId });
    if (!emp?.momo_phone || !emp?.momo_operator) throw new ApiError(422, "Aucun numéro Mobile Money enregistré pour cet employé : saisissez-le.");
    input = { ...input, phone: input.phone || emp.momo_phone, operator: input.operator || emp.momo_operator };
  }
  const phone = normalizeBeninPhone(input.phone);
  if (!phone) throw new ApiError(422, 'Numéro Mobile Money invalide (format béninois attendu).');

  const resolved = await resolvePurpose(user.tenantId, input);
  await assertWithinLimits(tenant, resolved.amount);

  const reference = newReference();
  let orderId;
  try {
    const [result] = await pool.query(
      `INSERT INTO payment_orders
         (tenant_id, reference, purpose, amount, beneficiary_type, beneficiary_user_id, beneficiary_owner_id, beneficiary_name,
          beneficiary_phone, beneficiary_email, operator, label, context_json, idempotency_key, created_by)
       VALUES (:tenantId, :reference, :purpose, :amount, :type, :userId, :ownerId, :name, :phone, :email, :operator, :label, :context, :key, :createdBy)`,
      {
        tenantId: user.tenantId, reference, purpose: input.purpose, amount: resolved.amount,
        type: resolved.beneficiary.type, userId: resolved.beneficiary.userId, ownerId: resolved.beneficiary.ownerId,
        name: resolved.beneficiary.name, phone, email: resolved.beneficiary.email, operator: input.operator,
        label: resolved.label, context: JSON.stringify(resolved.context), key: input.idempotencyKey, createdBy: user.id,
      },
    );
    orderId = result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[existing]] = await pool.query('SELECT * FROM payment_orders WHERE tenant_id = :tenantId AND idempotency_key = :key LIMIT 1', { tenantId: user.tenantId, key: input.idempotencyKey });
      if (existing) return { order: existing, replayed: true };
    }
    throw err;
  }
  if (input.purpose === 'salaire' && input.saveNumber) {
    await pool.query('UPDATE users SET momo_phone = :phone, momo_operator = :operator WHERE id = :id AND tenant_id = :tenantId', { phone, operator: input.operator, id: input.userId, tenantId: user.tenantId });
  }
  await appendAudit({
    tenantId: user.tenantId, orderId, eventType: 'order_created', actorUserId: user.id, req,
    details: { reference, purpose: input.purpose, amount: resolved.amount, operator: input.operator, beneficiary: resolved.beneficiary.name },
  });

  // Demande d'envoi à FedaPay.
  try {
    const created = await fedapay.createPayout(tenant, {
      amount: resolved.amount, name: resolved.beneficiary.name, email: resolved.beneficiary.email,
      phone, operator: input.operator, description: resolved.label, reference,
    });
    await pool.query('UPDATE payment_orders SET fedapay_payout_id = :id, provider_status = :status WHERE id = :orderId', { id: created.id, status: created.status, orderId });
    await appendAudit({ tenantId: user.tenantId, orderId, eventType: 'provider_created', actorUserId: user.id, req, details: { providerStatus: created.status } });

    const started = await fedapay.startPayout(tenant, created.id);
    await pool.query("UPDATE payment_orders SET status = 'processing', provider_status = :status WHERE id = :orderId", { status: started.status, orderId });
    await appendAudit({ tenantId: user.tenantId, orderId, eventType: 'provider_started', actorUserId: user.id, req, details: { providerStatus: started.status } });
  } catch (err) {
    const reason = err instanceof fedapay.ProviderError ? err.message : "Erreur lors de l'envoi";
    // Si la création a réussi mais le démarrage a échoué, rien n'est parti : l'ordre est marqué échoué.
    await pool.query("UPDATE payment_orders SET status = 'failed', failure_reason = :reason WHERE id = :orderId AND status IN ('created')", { reason: reason.slice(0, 250), orderId });
    await appendAudit({ tenantId: user.tenantId, orderId, eventType: 'provider_error', actorUserId: user.id, req, details: { reason } });
    logger.warn("Ordre de paiement non envoyé", { tenantId: user.tenantId, orderId, reason });
  }
  return { order: await loadOrder(user.tenantId, orderId), replayed: false };
}

/** Applique l'effet métier d'un ordre confirmé `sent`, une seule fois. */
async function applyOrder(tenantId, orderId, { req = null } = {}) {
  const conn = await pool.getConnection();
  let appliedOrder = null;
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM payment_orders WHERE id = :orderId AND tenant_id = :tenantId FOR UPDATE', { orderId, tenantId });
    if (!order) throw new ApiError(404, 'Paiement introuvable');
    if (order.applied_at) {
      await conn.rollback();
      return order;
    }
    const paidAt = todayIso();
    const context = order.context_json ? JSON.parse(order.context_json) : {};
    let appliedRef = null;
    let blockedReason = null;

    try {
      await assertPeriodOpenLocked(conn, tenantId, paidAt);
      // Chargés ici pour éviter une dépendance circulaire au chargement des modules de routes.
      if (order.purpose === 'reversement_proprietaire') {
        const { recordOwnerPayout } = require('../../routes/owners');
        const [[owner]] = await conn.query('SELECT * FROM owners WHERE id = :id AND tenant_id = :tenantId', { id: context.ownerId, tenantId });
        const payoutId = await recordOwnerPayout(conn, {
          tenantId, ownerId: context.ownerId, owner,
          data: { amount: Number(order.amount), periodLabel: context.periodLabel, paidAt, paymentMethod: 'mobile_money', notes: `FedaPay ${order.reference}` },
          recordedBy: order.created_by, skipBalanceCheck: true, skipIdempotency: true,
        });
        appliedRef = `owner_payouts:${payoutId}`;
      } else if (order.purpose === 'salaire') {
        const { recordPayslip } = require('../../routes/payslips');
        const [[employee]] = await conn.query('SELECT * FROM users WHERE id = :id AND tenant_id = :tenantId', { id: context.userId, tenantId });
        const [[dup]] = await conn.query('SELECT id FROM payslips WHERE tenant_id = :tenantId AND user_id = :userId AND period = :period AND deleted_at IS NULL LIMIT 1', { tenantId, userId: context.userId, period: context.period });
        if (dup) throw new ApiError(409, 'Un salaire pour cette période a été enregistré entre-temps.');
        const gross = context.baseAmount + context.bonusAmount;
        const { payslipId } = await recordPayslip(conn, {
          tenantId, employee,
          data: { ...context, paymentMethod: 'mobile_money', paidAt },
          createdBy: order.created_by, grossAmount: gross, netAmount: Number(order.amount), payroll: context.payroll ?? undefined, skipIdempotency: true,
        });
        appliedRef = `payslips:${payslipId}`;
      } else {
        const [exp] = await conn.query(
          `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by)
           VALUES (:tenantId, 'autre', :label, :amount, :paidAt, 'mobile_money', 'paid', :paidAt, :by)`,
          { tenantId, label: order.label, amount: Number(order.amount), paidAt, by: order.created_by },
        );
        if (await isModuleActive(conn, tenantId)) {
          await genererEcriture(conn, {
            tenantId, operationType: 'depense_autre', entryDate: paidAt, amount: Number(order.amount), paymentMethod: 'mobile_money',
            narrationVars: { libelle: order.label, mois: paidAt.slice(0, 7), employe: order.label },
            sourceTable: 'expenses', sourceId: exp.insertId, createdBy: order.created_by, context: {},
          });
        }
        appliedRef = `expenses:${exp.insertId}`;
      }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      // L'argent est PARTI : on garde la trace « envoyé » et on signale ce qui reste à régulariser à la main.
      blockedReason = `À régulariser manuellement : ${err.message}`.slice(0, 250);
      await conn.rollback();
      await conn.beginTransaction();
      await conn.query('SELECT id FROM payment_orders WHERE id = :orderId FOR UPDATE', { orderId });
    }

    await conn.query(
      `UPDATE payment_orders SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), applied_at = ${blockedReason ? 'NULL' : 'NOW()'},
         applied_ref = :appliedRef, failure_reason = :blockedReason WHERE id = :orderId`,
      { appliedRef, blockedReason, orderId },
    );
    await conn.commit();
    await appendAudit({
      tenantId, orderId, eventType: blockedReason ? 'apply_blocked' : 'applied', req,
      details: blockedReason ? { reason: blockedReason } : { appliedRef },
    });
    appliedOrder = await loadOrder(tenantId, orderId);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  if (appliedOrder) await notifyOrderSent(appliedOrder);
  return appliedOrder;
}

/** Relit l'état chez FedaPay et fait avancer l'ordre. Sans effet si l'ordre n'est plus `processing`. */
async function refreshOrder(tenantId, orderId, { req = null } = {}) {
  const order = await loadOrder(tenantId, orderId);
  if (order.status !== 'processing' || !order.fedapay_payout_id) return order;
  const tenant = await loadTenant(tenantId);

  let remote;
  try {
    remote = await fedapay.getPayout(tenant, order.fedapay_payout_id);
  } catch (err) {
    await pool.query('UPDATE payment_orders SET last_checked_at = NOW(), check_count = check_count + 1 WHERE id = :orderId', { orderId });
    return order;
  }
  await pool.query('UPDATE payment_orders SET provider_status = :status, last_checked_at = NOW(), check_count = check_count + 1 WHERE id = :orderId', { status: remote.status.slice(0, 30), orderId });

  if (remote.status === 'sent') {
    if (remote.amount != null && remote.amount !== Number(order.amount)) {
      // Montant confirmé par le prestataire ≠ montant de l'ordre : on n'enregistre RIEN et on alerte.
      await pool.query("UPDATE payment_orders SET failure_reason = 'ANOMALIE : montant confirmé différent du montant demandé' WHERE id = :orderId", { orderId });
      await appendAudit({ tenantId, orderId, eventType: 'anomaly_amount', req, details: { expected: Number(order.amount), received: remote.amount } });
      logger.error('Paiement sortant : montant divergent', { tenantId, orderId });
      return loadOrder(tenantId, orderId);
    }
    await appendAudit({ tenantId, orderId, eventType: 'provider_confirmed', req, details: { providerStatus: remote.status } });
    return applyOrder(tenantId, orderId, { req });
  }
  if (remote.status === 'failed') {
    await pool.query("UPDATE payment_orders SET status = 'failed', failure_reason = 'Le prestataire a signalé un échec de l''envoi' WHERE id = :orderId AND status = 'processing'", { orderId });
    await appendAudit({ tenantId, orderId, eventType: 'provider_failed', req, details: { providerStatus: remote.status } });
  }
  return loadOrder(tenantId, orderId);
}

module.exports = { createOrder, refreshOrder, applyOrder, loadOrder, toPublicOrder, newReference };
