'use strict';

const { pool } = require('../../config/db');
const logger = require('../../utils/logger');
const { sendPaymentConfirmationEmail } = require('../email/sendEmail');
const { maskEmail } = require('./phone');

function dateLabel(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function alreadyNotified({ tenantId, orderId, sourceTable, sourceId, role }) {
  const [rows] = await pool.query(
    `SELECT id FROM payment_notifications
     WHERE tenant_id = :tenantId AND recipient_role = :role AND status = 'sent'
       AND ${orderId != null ? 'order_id = :orderId' : 'source_table = :sourceTable AND source_id = :sourceId'}
     LIMIT 1`,
    { tenantId, role, orderId, sourceTable, sourceId },
  );
  return rows.length > 0;
}

async function logNotification({ tenantId, orderId = null, sourceTable = null, sourceId = null, role, email, status, error = null }) {
  await pool.query(
    `INSERT INTO payment_notifications (tenant_id, order_id, source_table, source_id, recipient_role, recipient_masked, status, error)
     VALUES (:tenantId, :orderId, :sourceTable, :sourceId, :role, :masked, :status, :error)`,
    { tenantId, orderId, sourceTable, sourceId, role, masked: maskEmail(email) || '(aucune adresse)', status, error: error ? String(error).slice(0, 190) : null },
  );
}

/** Envoie un e-mail et en garde la trace ; n'échoue JAMAIS (un e-mail raté ne doit pas défaire un paiement). */
async function deliver({ tenantId, orderId, sourceTable, sourceId, role, to, payload }) {
  try {
    if (!to) {
      await logNotification({ tenantId, orderId, sourceTable, sourceId, role, email: null, status: 'skipped', error: 'Aucune adresse e-mail' });
      return;
    }
    if (await alreadyNotified({ tenantId, orderId, sourceTable, sourceId, role })) return;
    const result = await sendPaymentConfirmationEmail({ to, ...payload });
    await logNotification({ tenantId, orderId, sourceTable, sourceId, role, email: to, status: result.sent ? 'sent' : 'failed', error: result.sent ? null : 'Envoi non confirmé' });
  } catch (err) {
    logger.error("Échec de la notification de paiement", { tenantId, orderId, error: err.message });
  }
}

/** Paiement SORTANT confirmé : e-mail au bénéficiaire (s'il a une adresse) et au(x) DG de l'entreprise. */
async function notifyOrderSent(order) {
  const [[tenant]] = await pool.query('SELECT company_name FROM tenants WHERE id = :id', { id: order.tenant_id });
  const [dgs] = await pool.query("SELECT first_name, email FROM users WHERE tenant_id = :id AND role = 'dg' AND status = 'active' AND email IS NOT NULL", { id: order.tenant_id });
  const base = {
    companyName: tenant?.company_name ?? 'Votre entreprise',
    direction: 'out',
    purpose: order.purpose,
    amount: Number(order.amount),
    reference: order.reference,
    dateLabel: dateLabel(order.sent_at ?? new Date()),
    label: order.label,
  };
  await deliver({
    tenantId: order.tenant_id, orderId: order.id, role: 'beneficiary', to: order.beneficiary_email,
    payload: { ...base, recipientName: order.beneficiary_name },
  });
  for (const dg of dgs) {
    await deliver({
      tenantId: order.tenant_id, orderId: order.id, role: 'dg', to: dg.email,
      payload: { ...base, recipientName: dg.first_name, label: `${order.label} — ${order.beneficiary_name}` },
    });
  }
}

/**
 * Paiement ENTRANT enregistré (loyer, charges…) : e-mail de confirmation au payeur s'il a une adresse.
 * Dédoublonné par (table source, id) — un rejeu de webhook n'envoie pas un second e-mail.
 */
async function notifyInboundPayment({ tenantId, sourceTable, sourceId, payerName, payerEmail, purpose, amount, paidAt, reference, label, downloadHint }) {
  const [[tenant]] = await pool.query('SELECT company_name FROM tenants WHERE id = :id', { id: tenantId });
  await deliver({
    tenantId, sourceTable, sourceId, role: 'payer', to: payerEmail,
    payload: {
      recipientName: payerName, companyName: tenant?.company_name ?? 'Votre bailleur', direction: 'in', purpose,
      amount: Number(amount), reference, dateLabel: dateLabel(paidAt), label, downloadHint,
    },
  });
}

module.exports = { notifyOrderSent, notifyInboundPayment };
