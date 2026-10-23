'use strict';

/**
 * Menu « Paiements » unique : FedaPay actif ⇒ saisie manuelle refusée (salaires, reversements, charges) ;
 * FedaPay inactif ⇒ saisie manuelle possible ; historique unifié avec reçus ; n° Mobile Money mémorisé.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { encryptSecret } = require('../src/utils/encryption');
const { createFixture, teardown } = require('./gl/fixtures');
const { insertBatch, insertCharge } = require('./utilityFixtures');

const PASSWORD = 'Mot-de-passe-Test-42';
let A; // FedaPay actif
let B; // FedaPay inactif
let empA;
let empB;
let server;
let baseUrl;
const realFetch = global.fetch;
const payouts = new Map();
let nextPayoutId = 7000;

function installMock() {
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('fedapay.com')) return realFetch(url, init);
    const path = new URL(u).pathname;
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (init.method === 'POST' && path === '/v1/payouts') {
      const body = JSON.parse(init.body);
      const id = nextPayoutId++;
      payouts.set(String(id), { status: 'pending', amount: body.amount });
      return json({ 'v1/payout': { id, status: 'pending', amount: body.amount } });
    }
    if (init.method === 'PUT' && path === '/v1/payouts/start') {
      const id = String(JSON.parse(init.body).payouts[0].id);
      payouts.get(id).status = 'started';
      return json({ 'v1/payouts': [{ id: Number(id), status: 'started' }] });
    }
    const m = path.match(/^\/v1\/payouts\/(\d+)$/);
    if (init.method === 'GET' && m) {
      const p = payouts.get(m[1]);
      return json({ 'v1/payout': { id: Number(m[1]), status: p.status, amount: p.amount } });
    }
    return new Response('{}', { status: 404 });
  };
}

async function makeDg(tenantId, label) {
  const hash = await hashPassword(PASSWORD);
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, email, password_hash) VALUES (:t, 'dg', :l, 'Dg', :phone, :email, :hash)",
    { t: tenantId, l: label, phone: `07${Math.floor(Math.random() * 100000000)}`, email: `${label.toLowerCase()}${Date.now()}@example.test`, hash },
  );
  return r.insertId;
}
async function makeEmployee(tenantId, name) {
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', :n, 'Staff', :phone, 'x')",
    { t: tenantId, n: name, phone: `05${Math.floor(Math.random() * 100000000)}` },
  );
  return r.insertId;
}

before(async () => {
  A = await createFixture();
  B = await createFixture();
  A.dg = await makeDg(A.tenantId, 'Dga');
  B.dg = await makeDg(B.tenantId, 'Dgb');
  empA = await makeEmployee(A.tenantId, 'Awa');
  empB = await makeEmployee(B.tenantId, 'Koffi');
  await pool.query(
    'UPDATE tenants SET fedapay_enabled = 1, fedapay_sandbox = 1, fedapay_secret_key_enc = :k, payments_per_order_limit = 500000, payments_daily_limit = 2000000 WHERE id = :t',
    { k: encryptSecret('sk_sandbox_SECRET_VALUE_123'), t: A.tenantId },
  );
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  installMock();
});

after(async () => {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  for (const fx of [A, B]) {
    await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM payslips WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM owner_charge_remittances WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM payment_reauth_state WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :t)', { t: fx.tenantId });
    await pool.query('DELETE FROM payment_orders WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM utility_payments WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM utility_readings WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: fx.tenantId });
    await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :t', { t: fx.tenantId });
    await teardown(fx.tenantId);
  }
  await closePool();
});

const auth = (id, tenantId, role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`, 'Content-Type': 'application/json' });
const key = () => `k${Date.now()}${Math.random().toString(36).slice(2, 12)}`.slice(0, 40).padEnd(16, 'x');
const call = (fx, method, path, body, role = 'dg') => fetch(`${baseUrl}${path}`, { method, headers: auth(fx.dg, fx.tenantId, role), body: body ? JSON.stringify(body) : undefined });

const payslipBody = (userId) => ({
  userId, period: '2026-10', baseAmount: 100000, bonusAmount: 0, deductionAmount: 0, paymentMethod: 'especes', paidAt: '2026-10-20', idempotencyKey: key(),
});

test('FedaPay actif : saisie manuelle refusée (salaire, reversement, charges) avec le code 409', async () => {
  const s = await call(A, 'POST', '/api/payslips', payslipBody(empA));
  assert.equal(s.status, 409);
  assert.match(JSON.stringify(await s.json()), /FedaPay/);
  const p = await call(A, 'POST', `/api/owners/${A.ownerId}/payouts`, { amount: 1000, periodLabel: 'Octobre', paidAt: '2026-10-20', paymentMethod: 'virement', idempotencyKey: key() });
  assert.equal(p.status, 409);
  const c = await call(A, 'POST', `/api/owners/${A.ownerId}/charge-remittances`, { amount: 1000, periodLabel: 'Octobre', paidAt: '2026-10-20', paymentMethod: 'virement', idempotencyKey: key() });
  assert.equal(c.status, 409);
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM payslips WHERE tenant_id = :t', { t: A.tenantId });
  assert.equal(Number(n.n), 0);
});

test('FedaPay inactif : le salaire manuel reste possible et apparaît dans l\'historique avec son reçu', async () => {
  const s = await call(B, 'POST', '/api/payslips', payslipBody(empB));
  assert.equal(s.status, 201, await s.clone().text());
  const h = await (await call(B, 'GET', '/api/payments/history')).json();
  const sal = h.items.find((i) => i.kind === 'salaire');
  assert.ok(sal);
  assert.equal(sal.amount, 100000);
  assert.equal(sal.channel, 'manuel');
  assert.match(sal.receiptUrl, /^\/api\/payslips\/\d+\/pdf$/);
  assert.equal(h.total, 100000);
  // Un comptable ne voit pas les salaires (confidentiels).
  const hc = await (await call(B, 'GET', '/api/payments/history', null, 'comptable')).json();
  assert.equal(hc.items.filter((i) => i.kind === 'salaire').length, 0);
});

test('salaire par FedaPay avec n° mémorisé : appliqué une fois, pas de doublon dans l\'historique, reçu = avis', async () => {
  const noNumber = await call(A, 'POST', '/api/payments/orders', { purpose: 'salaire', userId: empA, period: '2026-10', baseAmount: 120000, password: PASSWORD, idempotencyKey: key() });
  assert.equal(noNumber.status, 422);

  const res = await call(A, 'POST', '/api/payments/orders', {
    purpose: 'salaire', userId: empA, period: '2026-10', baseAmount: 120000, phone: '97 00 11 22', operator: 'mtn', saveNumber: true, password: PASSWORD, idempotencyKey: key(),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const { order } = await res.json();
  const [[u]] = await pool.query('SELECT momo_phone, momo_operator FROM users WHERE id = :id', { id: empA });
  assert.equal(u.momo_operator, 'mtn');
  assert.ok(u.momo_phone.startsWith('+229'));

  const staff = await (await call(A, 'GET', '/api/payslips/staff')).json();
  const me = staff.staff.find((x) => x.id === empA);
  assert.ok(me.momoPhoneMasked.includes('••••'));
  assert.ok(!JSON.stringify(staff).includes('97001122'));

  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'sent';
  await call(A, 'POST', `/api/payments/orders/${order.id}/refresh`);

  const h = await (await call(A, 'GET', '/api/payments/history')).json();
  const sal = h.items.filter((i) => i.kind === 'salaire');
  assert.equal(sal.length, 1, 'une seule ligne pour un salaire FedaPay');
  assert.equal(sal[0].channel, 'fedapay');
  assert.equal(sal[0].reference, order.reference);
  assert.equal(sal[0].receiptUrl, `/api/payments/orders/${order.id}/advice.pdf`);
  const [[exp]] = await pool.query("SELECT COUNT(*) AS n FROM expenses WHERE tenant_id = :t AND category = 'salaires'", { t: A.tenantId });
  assert.equal(Number(exp.n), 1);

  // 2e salaire pour le même employé : n° mémorisé utilisé sans le ressaisir.
  const second = await call(A, 'POST', '/api/payments/orders', { purpose: 'salaire', userId: empA, period: '2026-11', baseAmount: 50000, password: PASSWORD, idempotencyKey: key() });
  assert.equal(second.status, 201, await second.clone().text());
});

test('reversement de charges par FedaPay : plafonné au solde, appliqué en reversement de charges', async () => {
  const batchId = await insertBatch(A, { periodStart: '2026-08-01', periodEnd: '2026-08-31', mainInvoice: 100000, mainPaid: 100000 });
  await insertCharge(A, { batchId, unitId: A.unitId, leaseId: A.leaseId, amount: 40000, paid: 40000, paidAt: '2026-09-02', periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  const base = { purpose: 'reversement_charges', ownerId: A.ownerId, periodLabel: 'Août 2026', phone: '97 00 11 22', operator: 'mtn', password: PASSWORD };
  const tooMuch = await call(A, 'POST', '/api/payments/orders', { ...base, amount: 50000, idempotencyKey: key() });
  assert.equal(tooMuch.status, 422);
  const ok = await call(A, 'POST', '/api/payments/orders', { ...base, amount: 40000, idempotencyKey: key() });
  assert.equal(ok.status, 201, await ok.clone().text());
  const { order } = await ok.json();
  // Montant déjà réservé : un second ordre est refusé.
  const again = await call(A, 'POST', '/api/payments/orders', { ...base, amount: 1000, idempotencyKey: key() });
  assert.equal(again.status, 422);
  const [[row]] = await pool.query('SELECT fedapay_payout_id FROM payment_orders WHERE id = :id', { id: order.id });
  payouts.get(row.fedapay_payout_id).status = 'sent';
  await call(A, 'POST', `/api/payments/orders/${order.id}/refresh`);
  const [[rem]] = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM owner_charge_remittances WHERE tenant_id = :t AND deleted_at IS NULL', { t: A.tenantId });
  assert.equal(Number(rem.n), 1);
  assert.equal(Number(rem.total), 40000);
  const h = await (await call(A, 'GET', '/api/payments/history?kind=reversement_charges')).json();
  assert.equal(h.items.length, 1);
  assert.equal(h.items[0].channel, 'fedapay');
});

test('reçus génériques PDF (dépense manuelle) et isolation entre cabinets', async () => {
  const [e] = await pool.query(
    "INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, recorded_by) VALUES (:t, 'fournitures', 'Papier', 7500, '2026-10-10', 'especes', 'paid', '2026-10-10', :by)",
    { t: B.tenantId, by: B.dg },
  );
  const pdf = await call(B, 'GET', `/api/payments/receipts/depense/${e.insertId}.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const other = await call(A, 'GET', `/api/payments/receipts/depense/${e.insertId}.pdf`);
  assert.equal(other.status, 404);
  const bad = await call(B, 'GET', `/api/payments/receipts/inconnu/${e.insertId}.pdf`);
  assert.equal(bad.status, 404);
});

test('PATCH momo : numéro invalide refusé, effacement possible', async () => {
  const bad = await call(A, 'PATCH', `/api/payslips/staff/${empA}/momo`, { phone: '123', operator: 'mtn' });
  assert.equal(bad.status, 422);
  const clear = await call(A, 'PATCH', `/api/payslips/staff/${empA}/momo`, {});
  assert.equal(clear.status, 204);
  const [[u]] = await pool.query('SELECT momo_phone FROM users WHERE id = :id', { id: empA });
  assert.equal(u.momo_phone, null);
});
