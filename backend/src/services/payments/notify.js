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
      payload: { ...base, recipientName: dg.first_name, label: `${order.label} (${order.beneficiary_name})` },
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

const PORTAL_HINT = 'Votre quittance est téléchargeable à tout moment depuis votre espace locataire.';

/**
 * Loyer(s) encaissé(s) : UN e-mail pour tout le règlement (un paiement réparti sur plusieurs mois n'envoie pas
 * plusieurs messages). À appeler APRÈS le commit ; ne lève jamais, ne bloque jamais le paiement.
 */
async function notifyRentPaymentsRecorded(tenantId, paymentIds) {
  try {
    if (!Array.isArray(paymentIds) || paymentIds.length === 0) return;
    const [rows] = await pool.query(
      `SELECT rp.id, rp.amount, rp.paid_at, rp.covers_month, rc.receipt_number, r.first_name, r.last_name, r.email
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id AND l.tenant_id = rp.tenant_id
       JOIN renters r ON r.id = l.renter_id
       LEFT JOIN receipts rc ON rc.payment_id = rp.id
       WHERE rp.tenant_id = :tenantId AND rp.id IN (:ids) ORDER BY rp.id ASC`,
      { tenantId, ids: paymentIds },
    );
    if (rows.length === 0) return;
    const first = rows[0];
    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    await notifyInboundPayment({
      tenantId, sourceTable: 'rent_payments', sourceId: first.id,
      payerName: `${first.first_name} ${first.last_name}`, payerEmail: first.email, purpose: 'loyer', amount: total,
      paidAt: first.paid_at, reference: first.receipt_number ?? `LOY-${first.id}`,
      label: rows.length > 1 ? `${rows.length} mois (${rows.map((r) => r.covers_month).join(', ')})` : `Loyer ${first.covers_month}`,
      downloadHint: PORTAL_HINT,
    });
  } catch (err) {
    logger.error('Notification de loyer impossible', { tenantId, error: err.message });
  }
}

/** Règlement d'une facture SONEB/SBEE (charge) : même principe. */
async function notifyUtilityPaymentRecorded(tenantId, paymentId) {
  try {
    const [[row]] = await pool.query(
      `SELECT up.id, up.amount, up.paid_at, uc.utility_type, r.first_name, r.last_name, r.email
       FROM utility_payments up
       JOIN utility_charges uc ON uc.id = up.charge_id
       JOIN leases l ON l.id = uc.lease_id
       JOIN renters r ON r.id = l.renter_id
       WHERE up.tenant_id = :tenantId AND up.id = :id LIMIT 1`,
      { tenantId, id: paymentId },
    );
    if (!row) return;
    await notifyInboundPayment({
      tenantId, sourceTable: 'utility_payments', sourceId: row.id,
      payerName: `${row.first_name} ${row.last_name}`, payerEmail: row.email, purpose: 'charge', amount: row.amount,
      paidAt: row.paid_at, reference: `CHG-${row.id}`, label: `Facture ${row.utility_type === 'soneb' ? 'SONEB' : 'SBEE'}`,
      downloadHint: PORTAL_HINT,
    });
  } catch (err) {
    logger.error('Notification de charge impossible', { tenantId, error: err.message });
  }
}

module.exports = { notifyOrderSent, notifyInboundPayment, notifyRentPaymentsRecorded, notifyUtilityPaymentRecorded };
