'use strict';

/**
 * Tampon « PAYÉ » activable/désactivable sur les reçus (demande utilisateur, 2026-11-11 : « il faut
 * ajouter la fonctionnalité qui va permettre d'activer les cachets ou pas sur les quittances, chaque
 * employé autorisé doit l'activer ou pas en fonction de son besoin ainsi que l'admin »).
 *
 * Deux réglages distincts (voir migration 150) :
 *  - `users.show_paid_stamp` (personnel) : la quittance de loyer et le reçu d'entrée affichent
 *    toujours le cachet de l'employé qui a réellement encaissé (`issuer`) — c'est SON réglage qui
 *    décide, jamais celui de qui télécharge. Réglable seulement par qui peut encaisser (le DG, ou un
 *    employé avec la permission `loyers_encaisser`).
 *  - `tenants.show_paid_stamp_charges` (unique pour le cabinet) : le reçu de charges n'est rattaché à
 *    aucun employé en particulier (toujours le cachet de l'entreprise) — un seul interrupteur,
 *    réglable par le DG dans Réglages.
 *
 * Pas d'assertion fragile sur le texte du PDF (police custom, même principe que
 * `ownerPayoutReceipt.test.js`) : on vérifie le réglage en base et le comportement HTTP (200/403),
 * jamais le rendu visuel.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

let fx; let server; let base; let agentId; let paymentId; let receiptId;
const hdr = (userId, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: userId, tenantId: fx.tenantId, role })}` });

before(async () => {
  fx = await createFixture();

  const [agent] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'Test', :phone, 'x')",
    { t: fx.tenantId, phone: `05${Math.floor(Math.random() * 100000000)}` },
  );
  agentId = agent.insertId;

  const [pay] = await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-11', '2026-11-01', 50000, 'especes', '2026-11-01', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  paymentId = pay.insertId;
  const [receipt] = await pool.query(
    "INSERT INTO receipts (tenant_id, payment_id, receipt_number, issued_at) VALUES (:t, :p, 'QT-TEST-001', NOW())",
    { t: fx.tenantId, p: paymentId },
  );
  receiptId = receipt.insertId;

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM receipts WHERE id = :id', { id: receiptId });
  await pool.query('DELETE FROM rent_payments WHERE id = :id', { id: paymentId });
  await pool.query('DELETE FROM users WHERE id = :id', { id: agentId });
  await teardown(fx.tenantId);
  await closePool();
});

test('réglage personnel par défaut : activé pour tout le monde (comportement inchangé)', async () => {
  const me = await (await fetch(`${base}/api/auth/me`, { headers: hdr(fx.dgId, 'dg') })).json();
  assert.equal(me.user.showPaidStamp, true);
});

test('le DG peut désactiver son tampon personnel, et ça se reflète immédiatement', async () => {
  const fd = new FormData();
  fd.append('showPaidStamp', 'false');
  const r = await fetch(`${base}/api/auth/my-profile`, { method: 'PATCH', headers: hdr(fx.dgId, 'dg'), body: fd });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.showPaidStamp, false);

  // La quittance se génère toujours sans erreur, tampon ou pas.
  const pdf = await fetch(`${base}/api/leases/${fx.leaseId}/payments/${paymentId}/receipt.pdf`, { headers: hdr(fx.dgId, 'dg') });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);

  // Remis dans l'état initial pour ne pas affecter les tests suivants / la suite complète.
  const fd2 = new FormData();
  fd2.append('showPaidStamp', 'true');
  await fetch(`${base}/api/auth/my-profile`, { method: 'PATCH', headers: hdr(fx.dgId, 'dg'), body: fd2 });
});

test('un agent sans la permission « loyers_encaisser » ne peut pas toucher à ce réglage (403)', async () => {
  const fd = new FormData();
  fd.append('showPaidStamp', 'false');
  const r = await fetch(`${base}/api/auth/my-profile`, { method: 'PATCH', headers: hdr(agentId, 'agent'), body: fd });
  assert.equal(r.status, 403);

  // Le réglage n'a pas bougé.
  const [[row]] = await pool.query('SELECT show_paid_stamp FROM users WHERE id = :id', { id: agentId });
  assert.equal(row.show_paid_stamp, 1);
});

test('un agent AVEC la permission « loyers_encaisser » peut régler son propre tampon', async () => {
  await pool.query(
    "INSERT INTO user_permissions (user_id, permission_key) VALUES (:id, 'loyers_encaisser')",
    { id: agentId },
  );
  const fd = new FormData();
  fd.append('showPaidStamp', 'false');
  const r = await fetch(`${base}/api/auth/my-profile`, { method: 'PATCH', headers: hdr(agentId, 'agent'), body: fd });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.showPaidStamp, false);

  await pool.query('DELETE FROM user_permissions WHERE user_id = :id', { id: agentId });
});

test('réglage du cabinet pour le reçu de charges : par défaut activé, réglable par le DG uniquement', async () => {
  const before1 = await (await fetch(`${base}/api/settings`, { headers: hdr(fx.dgId, 'dg') })).json();
  assert.equal(before1.settings.showPaidStampCharges, true);

  const fd = new FormData();
  fd.append('showPaidStampCharges', 'false');
  const r = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: hdr(fx.dgId, 'dg'), body: fd });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.settings.showPaidStampCharges, false);

  // Un agent (même avec des permissions) n'a pas accès à /api/settings du tout (réservé au DG).
  const agentTry = await fetch(`${base}/api/settings`, { headers: hdr(agentId, 'agent') });
  assert.equal(agentTry.status, 403);

  // Remis dans l'état initial.
  const fd2 = new FormData();
  fd2.append('showPaidStampCharges', 'true');
  await fetch(`${base}/api/settings`, { method: 'PATCH', headers: hdr(fx.dgId, 'dg'), body: fd2 });
});
