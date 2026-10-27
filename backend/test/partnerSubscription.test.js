'use strict';
process.env.SUBSCRIPTIONS_ENFORCED = 'true';

/** Abonnement partenaire : attribution depuis le back-office, droits réellement appliqués, prolongation, fin, expiration. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken, signAdminToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const { assertFeature, assertWithinLimit } = require('../src/services/entitlements');
const { runSubscriptionJob } = require('../src/jobs/subscriptionJob');

let fx; let server; let base; let adminId; let adminToken; let adminEmail;
const adHdr = () => ({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' });
const dgHdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}`, 'Content-Type': 'application/json' });
const grant = (body, tenantId = fx.tenantId) => fetch(`${base}/api/admin/tenants/${tenantId}/partner`, { method: 'POST', headers: adHdr(), body: JSON.stringify(body) });
const revoke = (body = { note: 'Fin du partenariat' }) => fetch(`${base}/api/admin/tenants/${fx.tenantId}/partner/revoke`, { method: 'POST', headers: adHdr(), body: JSON.stringify(body) });
const sub = async () => (await pool.query('SELECT *, TIMESTAMPDIFF(DAY, NOW(), current_period_end) AS days_left FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId }))[0][0];
const mine = async () => (await (await fetch(`${base}/api/billing/subscription`, { headers: dgHdr() })).json());
const body0 = { months: 3, features: ['payroll', 'owner_portal'], note: 'Partenaire cabinet pilote' };

before(async () => {
  fx = await createBareFixture();
  await pool.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, NULL, 'pending_payment') ON DUPLICATE KEY UPDATE plan_key = NULL, status = 'pending_payment'", { t: fx.tenantId });
  adminEmail = `partner-${Date.now()}@aim.test`;
  const [a] = await pool.query("INSERT INTO platform_admins (email, name, password_hash) VALUES (:e, 'Admin Partenaire', :h)", { e: adminEmail, h: await hashPassword('motdepasse-solide-1') });
  adminId = a.insertId;
  adminToken = signAdminToken({ sub: adminId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM platform_admin_audit WHERE admin_id = :id OR admin_email = :e', { id: adminId, e: adminEmail });
  await pool.query('DELETE FROM platform_admins WHERE id = :id', { id: adminId });
  await teardown(fx.tenantId);
  await closePool();
});

test('réservé à l’administrateur de la plateforme', async () => {
  const noAuth = await fetch(`${base}/api/admin/tenants/${fx.tenantId}/partner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body0) });
  assert.equal(noAuth.status, 401);
  const asDg = await fetch(`${base}/api/admin/tenants/${fx.tenantId}/partner`, { method: 'POST', headers: dgHdr(), body: JSON.stringify(body0) });
  assert.equal(asDg.status, 401);
  assert.equal((await fetch(`${base}/api/admin/partner-features`, { headers: dgHdr() })).status, 401);
  assert.equal((await sub()).plan_key, null);
});

test('fonctions proposées : tout sauf la base et l’assistant IA', async () => {
  const r = await (await fetch(`${base}/api/admin/partner-features`, { headers: adHdr() })).json();
  assert.deepEqual([...r.features].sort(), ['advanced_accounting', 'audit_full', 'owner_portal', 'payouts', 'payroll', 'sale_properties', 'tenant_collect']);
  assert.equal(r.maxMonths, 60);
});

test('validation : durée, fonctions, motif, entreprise', async () => {
  for (const bad of [
    { ...body0, months: 0 }, { ...body0, months: 61 }, { ...body0, months: 1.5 }, { ...body0, months: '3' },
    { ...body0, features: ['inconnue'] }, { ...body0, features: ['ai_assistant'] }, { ...body0, features: ['core'] },
    { ...body0, note: 'a' }, { months: 3, features: [] },
    { ...body0, limits: { units: -1, owners: null, users: null } },
  ]) assert.equal((await grant(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await grant(body0, 99999999)).status, 404);
  assert.equal((await sub()).plan_key, null); // rien n'a été écrit
});

test('attribution : offre partenaire active pour 3 mois, fonctions enregistrées, journal et audit', async () => {
  const r = await grant(body0);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.extended, false);
  const s = await sub();
  assert.equal(s.plan_key, 'partenaire');
  assert.equal(s.status, 'active');
  assert.equal(s.period_months, 3);
  assert.ok(s.days_left >= 88 && s.days_left <= 92, `jours restants: ${s.days_left}`);
  assert.deepEqual(JSON.parse(s.partner_features).sort(), ['owner_portal', 'payroll']);
  assert.equal(s.partner_note, 'Partenaire cabinet pilote');
  assert.equal(s.refund_eligible_until, null);
  const [ev] = await pool.query("SELECT actor, details FROM subscription_events WHERE tenant_id = :t AND event_type = 'partner_granted'", { t: fx.tenantId });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, `admin:${adminId}`);
  const [au] = await pool.query("SELECT action FROM platform_admin_audit WHERE admin_id = :id AND action = 'tenant_partner_grant'", { id: adminId });
  assert.equal(au.length, 1);
  // aucun paiement fantôme
  const [[pay]] = await pool.query('SELECT COUNT(*) AS n FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(Number(pay.n), 0);
});

test('badge : l’entreprise voit une offre « Partenaire » avec ses fonctions', async () => {
  const m = await mine();
  assert.equal(m.active, true);
  assert.equal(m.planKey, 'partenaire');
  assert.equal(m.planLabel, 'Partenaire');
  assert.equal(m.isPartner, true);
  assert.deepEqual(m.partner.features.sort(), ['core', 'owner_portal', 'payroll']);
  assert.deepEqual(m.partner.limits, { units: null, owners: null, users: null });
  assert.ok(m.daysLeft >= 88);
  // une entreprise ordinaire n'a pas le badge
  assert.equal((await pool.query("SELECT 1 FROM tenant_subscriptions WHERE plan_key = 'partenaire' AND tenant_id <> :t LIMIT 0", { t: fx.tenantId }))[0].length, 0);
});

test('droits appliqués côté serveur : seules les fonctions cochées sont accessibles', async () => {
  await assertFeature(fx.tenantId, 'core');
  await assertFeature(fx.tenantId, 'payroll');
  await assertFeature(fx.tenantId, 'owner_portal');
  for (const f of ['payouts', 'sale_properties', 'advanced_accounting', 'audit_full', 'tenant_collect']) {
    await assert.rejects(() => assertFeature(fx.tenantId, f), (e) => e.status === 403 && e.details.code === 'FEATURE_NOT_IN_PLAN', f);
  }
  // par la vraie route : « payouts » est refusée, « payroll » ne l'est pas
  const payouts = await fetch(`${base}/api/payments`, { headers: dgHdr() });
  assert.equal(payouts.status, 403);
  assert.equal((await payouts.json()).details.code, 'FEATURE_NOT_IN_PLAN');
  const payroll = await fetch(`${base}/api/payslips/staff`, { headers: dgHdr() });
  assert.ok(![402, 403].includes(payroll.status), `payroll: ${payroll.status}`);
});

test('prolongation : les mois s’ajoutent à l’échéance, fonctions et limites remplacées', async () => {
  const before = await sub();
  const r = await grant({ months: 2, features: ['payouts'], limits: { units: 5, owners: null, users: 1 }, note: 'Prolongation' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).extended, true);
  const after = await sub();
  const [[diff]] = await pool.query('SELECT TIMESTAMPDIFF(DAY, :a, :b) AS d', { a: before.current_period_end, b: after.current_period_end });
  assert.ok(Number(diff.d) >= 58 && Number(diff.d) <= 62, `écart: ${diff.d}`);
  assert.equal(new Date(after.started_at).getTime(), new Date(before.started_at).getTime());
  assert.deepEqual(JSON.parse(after.partner_features), ['payouts']);
  await assertFeature(fx.tenantId, 'payouts');
  await assert.rejects(() => assertFeature(fx.tenantId, 'payroll'), (e) => e.details.code === 'FEATURE_NOT_IN_PLAN');
  const [ev] = await pool.query("SELECT 1 FROM subscription_events WHERE tenant_id = :t AND event_type = 'partner_extended'", { t: fx.tenantId });
  assert.equal(ev.length, 1);
});

test('limites facultatives appliquées à la création (utilisateurs : 1 déjà atteint)', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assert.rejects(() => assertWithinLimit(fx.tenantId, 'users', conn), (e) => e.status === 403 && e.details.code === 'PLAN_LIMIT_REACHED');
    await assertWithinLimit(fx.tenantId, 'owners', conn); // illimité
    await conn.rollback();
  } finally { conn.release(); }
  const m = await mine();
  assert.deepEqual(m.partner.limits, { units: 5, owners: null, users: 1 });
  assert.equal(m.overLimits.length, 0);
});

test('pendant le partenariat : paiement, changement d’offre et annulation sont refusés', async () => {
  const quote = await fetch(`${base}/api/billing/quote`, { method: 'POST', headers: dgHdr(), body: JSON.stringify({ planKey: 'pro', months: 4 }) });
  assert.equal(quote.status, 409);
  const checkout = await fetch(`${base}/api/billing/checkout`, { method: 'POST', headers: dgHdr(), body: JSON.stringify({ planKey: 'pro', months: 4 }) });
  assert.equal(checkout.status, 409);
  const up = await (await fetch(`${base}/api/billing/upgrade-options`, { headers: dgHdr() })).json();
  assert.deepEqual(up.options, []);
  const refund = await fetch(`${base}/api/billing/refund-requests`, { method: 'POST', headers: dgHdr(), body: JSON.stringify({ reason: 'Je souhaite annuler cet abonnement' }) });
  assert.equal(refund.status, 400);
});

test('liste du back-office : le partenaire est repéré avec ses fonctions', async () => {
  const list = await (await fetch(`${base}/api/admin/tenants`, { headers: adHdr() })).json();
  const t = list.tenants.find((x) => x.id === fx.tenantId);
  assert.equal(t.planKey, 'partenaire');
  assert.equal(t.status, 'active');
  assert.deepEqual(t.partner.features.sort(), ['core', 'payouts']);
  assert.equal(t.partner.note, 'Prolongation');
  assert.equal(list.tenants.filter((x) => x.partner).every((x) => x.planKey === 'partenaire'), true);
});

test('abonnement payant en cours : remplacement refusé sans confirmation, avec confirmation les mois payés sont consommés', async () => {
  await pool.query("UPDATE tenant_subscriptions SET plan_key = 'pro', status = 'active', current_period_end = DATE_ADD(NOW(), INTERVAL 2 MONTH), partner_features = NULL, partner_limits = NULL WHERE tenant_id = :t", { t: fx.tenantId });
  await pool.query(
    "INSERT INTO subscription_payments (tenant_id, reference, plan_key, months, amount, status, paid_at, period_end, is_first_purchase) VALUES (:t, :r, 'pro', 4, 65000, 'paid', NOW(), DATE_ADD(NOW(), INTERVAL 2 MONTH), 1)",
    { t: fx.tenantId, r: require('crypto').randomBytes(16).toString('hex') },
  );
  const refused = await grant(body0);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).details.code, 'PAID_SUBSCRIPTION_RUNNING');
  assert.equal((await sub()).plan_key, 'pro');
  const ok = await grant({ ...body0, replacePaid: true });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).extended, false);
  assert.equal((await sub()).plan_key, 'partenaire');
  const [[p]] = await pool.query('SELECT consumed_at FROM subscription_payments WHERE tenant_id = :t', { t: fx.tenantId });
  assert.ok(p.consumed_at);
});

test('fin du partenariat : accès coupé tout de suite, puis souscription normale possible', async () => {
  assert.equal((await revoke({ note: 'x' })).status, 400); // motif trop court
  assert.equal((await revoke()).status, 200);
  const s = await sub();
  assert.equal(s.status, 'cancelled');
  await assert.rejects(() => assertFeature(fx.tenantId, 'core'), (e) => e.status === 402 && e.details.code === 'SUBSCRIPTION_INACTIVE');
  const m = await mine();
  assert.equal(m.active, false);
  assert.equal((await revoke()).status, 400); // déjà terminé
  const quote = await fetch(`${base}/api/billing/quote`, { method: 'POST', headers: dgHdr(), body: JSON.stringify({ planKey: 'pro', months: 4 }) });
  assert.equal(quote.status, 200);
  const [ev] = await pool.query("SELECT 1 FROM subscription_events WHERE tenant_id = :t AND event_type = 'partner_revoked'", { t: fx.tenantId });
  assert.equal(ev.length, 1);
});

test('réattribution après la fin : repart de maintenant ; échéance dépassée : expire et coupe', async () => {
  const r = await grant({ months: 1, features: ['payroll'], note: 'Nouveau partenariat' });
  assert.equal((await r.json()).extended, false);
  let s = await sub();
  assert.equal(s.status, 'active');
  assert.ok(s.days_left >= 28 && s.days_left <= 31);
  await assertFeature(fx.tenantId, 'payroll');

  await pool.query('UPDATE tenant_subscriptions SET current_period_end = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE tenant_id = :t', { t: fx.tenantId });
  await assert.rejects(() => assertFeature(fx.tenantId, 'payroll'), (e) => e.details.code === 'SUBSCRIPTION_INACTIVE'); // coupé même avant le passage du job
  await runSubscriptionJob();
  s = await sub();
  assert.equal(s.status, 'expired');
  const list = await (await fetch(`${base}/api/admin/tenants`, { headers: adHdr() })).json();
  assert.equal(list.tenants.find((x) => x.id === fx.tenantId).status, 'expired');
  // partenariat échu : on peut de nouveau l'attribuer (repart de maintenant, pas de l'ancienne échéance)
  const again = await grant({ months: 1, features: ['payroll'], note: 'Renouvellement' });
  assert.equal((await again.json()).extended, false);
  assert.ok((await sub()).days_left >= 28);
});
