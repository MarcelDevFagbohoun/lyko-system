'use strict';

const { pool } = require('../config/db');

/**
 * Historique unifié de TOUTES les sorties d'argent de l'entreprise, avec le reçu de chacune.
 * Sources : fiches de paie, reversements propriétaires, reversements de charges, dépenses payées (hors salaires,
 * déjà couverts par les fiches), restitutions de caution, et ordres FedaPay pas encore comptabilisés
 * (en cours / échoués / à régulariser). Un ordre FedaPay appliqué n'apparaît PAS en double : on affiche l'opération
 * qu'il a créée, rattachée à sa référence FedaPay.
 */

const KIND_LABELS = {
  salaire: 'Salaire',
  reversement_proprietaire: 'Reversement propriétaire',
  reversement_charges: 'Reversement de charges',
  depense: 'Dépense',
  restitution_caution: 'Restitution de caution',
};

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

async function loadAppliedOrders(tenantId) {
  const [rows] = await pool.query(
    "SELECT id, reference, applied_ref FROM payment_orders WHERE tenant_id = :tenantId AND applied_at IS NOT NULL AND applied_ref IS NOT NULL",
    { tenantId },
  );
  const map = new Map();
  for (const r of rows) map.set(r.applied_ref, r);
  return map;
}

function channelOf(applied, method) {
  if (applied) return 'fedapay';
  return method === 'mobile_money' ? 'manuel_mobile_money' : 'manuel';
}

/** @param {{from?:string,to?:string,kinds?:string[],includeSalaries?:boolean,search?:string}} opts */
async function listPaymentHistory(tenantId, { from = null, to = null, kinds = null, includeSalaries = true } = {}) {
  const applied = await loadAppliedOrders(tenantId);
  const items = [];
  const range = (col) => `${from ? `AND ${col} >= :from` : ''} ${to ? `AND ${col} <= :to` : ''}`;
  const params = { tenantId, from, to };
  const want = (k) => !kinds || kinds.includes(k);

  if (includeSalaries && want('salaire')) {
    const [rows] = await pool.query(
      `SELECT p.id, p.period, p.net_amount, p.payment_method, p.paid_at, u.first_name, u.last_name
       FROM payslips p JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = :tenantId AND p.deleted_at IS NULL ${range('p.paid_at')}`,
      params,
    );
    for (const r of rows) {
      const ord = applied.get(`payslips:${r.id}`);
      items.push({
        kind: 'salaire', id: r.id, date: iso(r.paid_at), amount: Number(r.net_amount),
        beneficiary: `${r.first_name} ${r.last_name}`, label: `Salaire ${r.period}`,
        method: r.payment_method, channel: channelOf(ord, r.payment_method), reference: ord?.reference ?? null,
        status: 'paid', orderId: ord?.id ?? null,
        receiptUrl: ord ? `/api/payments/orders/${ord.id}/advice.pdf` : `/api/payslips/${r.id}/pdf`,
      });
    }
  }

  if (want('reversement_proprietaire')) {
    const [rows] = await pool.query(
      `SELECT op.id, op.amount, op.period_label, op.paid_at, op.payment_method, o.name AS owner_name
       FROM owner_payouts op JOIN owners o ON o.id = op.owner_id
       WHERE op.tenant_id = :tenantId ${range('op.paid_at')}`,
      params,
    );
    for (const r of rows) {
      const ord = applied.get(`owner_payouts:${r.id}`);
      items.push({
        kind: 'reversement_proprietaire', id: r.id, date: iso(r.paid_at), amount: Number(r.amount),
        beneficiary: r.owner_name, label: `Reversement ${r.period_label}`, method: r.payment_method,
        channel: channelOf(ord, r.payment_method), reference: ord?.reference ?? null, status: 'paid', orderId: ord?.id ?? null,
        receiptUrl: ord ? `/api/payments/orders/${ord.id}/advice.pdf` : `/api/payments/receipts/reversement_proprietaire/${r.id}.pdf`,
      });
    }
  }

  if (want('reversement_charges')) {
    const [rows] = await pool.query(
      `SELECT cr.id, cr.amount, cr.period_label, cr.paid_at, cr.payment_method, o.name AS owner_name
       FROM owner_charge_remittances cr JOIN owners o ON o.id = cr.owner_id
       WHERE cr.tenant_id = :tenantId AND cr.deleted_at IS NULL ${range('cr.paid_at')}`,
      params,
    );
    for (const r of rows) {
      const ord = applied.get(`owner_charge_remittances:${r.id}`);
      items.push({
        kind: 'reversement_charges', id: r.id, date: iso(r.paid_at), amount: Number(r.amount),
        beneficiary: r.owner_name, label: `Reversement de charges${r.period_label ? ` ${r.period_label}` : ''}`, method: r.payment_method,
        channel: channelOf(ord, r.payment_method), reference: ord?.reference ?? null, status: 'paid', orderId: ord?.id ?? null,
        receiptUrl: ord ? `/api/payments/orders/${ord.id}/advice.pdf` : `/api/payments/receipts/reversement_charges/${r.id}.pdf`,
      });
    }
  }

  if (want('depense')) {
    const [rows] = await pool.query(
      `SELECT e.id, e.label, e.amount, e.category, e.payment_method, COALESCE(e.paid_at, e.expense_date) AS day
       FROM expenses e
       WHERE e.tenant_id = :tenantId AND e.payment_status = 'paid' AND e.category <> 'salaires'
         ${range('COALESCE(e.paid_at, e.expense_date)')}`,
      params,
    );
    for (const r of rows) {
      const ord = applied.get(`expenses:${r.id}`);
      items.push({
        kind: 'depense', id: r.id, date: iso(r.day), amount: Number(r.amount), beneficiary: null, label: r.label,
        method: r.payment_method, channel: channelOf(ord, r.payment_method), reference: ord?.reference ?? null, status: 'paid', orderId: ord?.id ?? null,
        receiptUrl: ord ? `/api/payments/orders/${ord.id}/advice.pdf` : `/api/payments/receipts/depense/${r.id}.pdf`,
      });
    }
  }

  if (want('restitution_caution')) {
    const [rows] = await pool.query(
      `SELECT m.id, m.net_refund, m.refund_payment_method, DATE(m.finalized_at) AS day, r.first_name, r.last_name
       FROM move_out_reports m
       JOIN leases l ON l.id = m.lease_id JOIN renters r ON r.id = l.renter_id
       WHERE m.tenant_id = :tenantId AND m.status = 'finalized' AND m.net_refund > 0 ${range('DATE(m.finalized_at)')}`,
      params,
    );
    for (const r of rows) {
      items.push({
        kind: 'restitution_caution', id: r.id, date: iso(r.day), amount: Number(r.net_refund),
        beneficiary: `${r.first_name} ${r.last_name}`, label: 'Restitution de caution', method: r.refund_payment_method ?? 'especes',
        channel: channelOf(null, r.refund_payment_method), reference: null, status: 'paid', orderId: null,
        receiptUrl: `/api/payments/receipts/restitution_caution/${r.id}.pdf`,
      });
    }
  }

  // Ordres FedaPay pas (encore) comptabilisés : visibles pour suivi, jamais comptés dans les totaux.
  const [pending] = await pool.query(
    `SELECT id, reference, purpose, amount, status, beneficiary_name, label, operator, created_at, failure_reason, applied_at
     FROM payment_orders WHERE tenant_id = :tenantId AND applied_at IS NULL ${range('DATE(created_at)')}`,
    params,
  );
  for (const o of pending) {
    const kind = o.purpose === 'autre' ? 'depense' : o.purpose;
    if (!want(kind)) continue;
    if (kind === 'salaire' && !includeSalaries) continue;
    items.push({
      kind, id: o.id, date: iso(o.created_at), amount: Number(o.amount), beneficiary: o.beneficiary_name, label: o.label,
      method: 'mobile_money', channel: 'fedapay', reference: o.reference,
      status: o.status === 'failed' ? 'failed' : o.status === 'sent' ? 'to_regularize' : 'processing',
      failureReason: o.failure_reason ?? null, orderId: o.id, receiptUrl: o.status === 'sent' ? `/api/payments/orders/${o.id}/advice.pdf` : null,
    });
  }

  items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  const total = items.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const byKind = {};
  for (const i of items) if (i.status === 'paid') byKind[i.kind] = (byKind[i.kind] ?? 0) + i.amount;
  return { items, total, byKind, kindLabels: KIND_LABELS };
}

module.exports = { listPaymentHistory, KIND_LABELS };
