'use strict';

/**
 * Salaires (demande utilisateur, 2026-10-18) : paiement du salaire d'un employé (comptable, agent
 * ou le DG lui-même — décision explicite de l'utilisateur). Réservé au DG (jamais délégable via une
 * permission). Voir routes/payslips.js.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, createFixture, teardown } = require('./gl/fixtures');

let fx;
let comptableId;
let server;
let baseUrl;

before(async () => {
  fx = await createBareFixture();
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'comptable', 'Awa', 'Kpakpo', :phone, 'x')",
    { t: fx.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}` },
  );
  comptableId = r.insertId;
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM payslips WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
});
const jsonHeaders = (id, tenantId, role) => ({ ...bearer(id, tenantId, role), 'Content-Type': 'application/json' });

test('les routes /api/payslips sont réservées au DG, jamais déléguées via une permission', async () => {
  const res = await fetch(`${baseUrl}/api/payslips/staff`, { headers: bearer(comptableId, fx.tenantId, 'comptable') });
  assert.equal(res.status, 403);
});

test('GET /api/payslips/staff — liste TOUT le personnel, le DG compris (contrairement à /api/employees)', async () => {
  const res = await fetch(`${baseUrl}/api/payslips/staff`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.staff.map((s) => s.id);
  assert.ok(ids.includes(fx.dgId), 'le DG doit apparaître dans la liste');
  assert.ok(ids.includes(comptableId), 'le comptable doit apparaître dans la liste');
  const dgRow = body.staff.find((s) => s.id === fx.dgId);
  assert.equal(dgRow.baseSalary, null);
  assert.equal(dgRow.lastPayslip, null);
});

test('PATCH /api/payslips/staff/:userId/base-salary — fixe le salaire de base, repris par défaut ensuite', async () => {
  const res = await fetch(`${baseUrl}/api/payslips/staff/${comptableId}/base-salary`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ baseSalary: 150000 }),
  });
  assert.equal(res.status, 204);

  const staffRes = await fetch(`${baseUrl}/api/payslips/staff`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const staffBody = await staffRes.json();
  assert.equal(staffBody.staff.find((s) => s.id === comptableId).baseSalary, 150000);

  const badUser = await fetch(`${baseUrl}/api/payslips/staff/999999/base-salary`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ baseSalary: 1000 }),
  });
  assert.equal(badUser.status, 404);
});

test('POST /api/payslips — paie un salaire : net calculé côté serveur, dépense + fiche créées', async () => {
  const res = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: comptableId,
      period: '2026-06',
      baseAmount: 150000,
      bonusAmount: 20000,
      bonusLabel: 'Prime de performance',
      deductionAmount: 5000,
      deductionLabel: 'Avance déjà versée',
      paymentMethod: 'mobile_money',
      paidAt: '2026-06-28',
      idempotencyKey: 'payslip-test-key-0001',
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.payslip.grossAmount, 170000, '150000 + 20000');
  assert.equal(body.payslip.netAmount, 165000, '170000 - 5000');
  assert.equal(body.payslip.employee.id, comptableId);
  assert.equal(body.payslip.paymentMethod, 'mobile_money');
  assert.ok(body.payslip.createdBy);

  const [[expenseRow]] = await pool.query(
    "SELECT * FROM expenses WHERE tenant_id = :t AND category = 'salaires' ORDER BY id DESC LIMIT 1",
    { t: fx.tenantId },
  );
  assert.ok(expenseRow, 'une dépense doit avoir été créée pour ce paiement');
  assert.equal(Number(expenseRow.amount), 165000, "la dépense porte le NET versé, jamais le brut");
  assert.equal(expenseRow.payment_status, 'paid');

  const [[noGlEntry]] = await pool.query(
    "SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t AND source_operation_type = 'salaire_paye'",
    { t: fx.tenantId },
  );
  assert.equal(Number(noGlEntry.n), 0, "tenant sans comptabilité avancée active : aucune écriture GL");
});

test('POST /api/payslips — refusé (409) si le salaire de cet employé pour cette période a déjà été payé', async () => {
  const retry = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: comptableId,
      period: '2026-06',
      baseAmount: 150000,
      paymentMethod: 'especes',
      paidAt: '2026-06-29',
      idempotencyKey: 'payslip-test-key-0002',
    }),
  });
  assert.equal(retry.status, 409);
});

test('POST /api/payslips — refuse une retenue supérieure au brut, et un net à payer ≤ 0', async () => {
  const res = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: comptableId,
      period: '2026-07',
      baseAmount: 100000,
      deductionAmount: 150000,
      paymentMethod: 'especes',
      paidAt: '2026-07-05',
      idempotencyKey: 'payslip-test-key-0003',
    }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/payslips — le DG peut aussi s\'enregistrer une fiche de paie (décision explicite de l\'utilisateur)', async () => {
  const res = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: fx.dgId,
      period: '2026-06',
      baseAmount: 300000,
      paymentMethod: 'virement',
      paidAt: '2026-06-28',
      idempotencyKey: 'payslip-test-key-0004',
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.payslip.employee.id, fx.dgId);
  assert.equal(body.payslip.employee.role, 'dg');
});

test('GET /api/payslips?userId=&period= — filtre correctement', async () => {
  const all = await fetch(`${baseUrl}/api/payslips`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const allBody = await all.json();
  assert.ok(allBody.payslips.length >= 2);

  const byUser = await fetch(`${baseUrl}/api/payslips?userId=${comptableId}`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const byUserBody = await byUser.json();
  assert.ok(byUserBody.payslips.every((p) => p.employee.id === comptableId));

  const byPeriod = await fetch(`${baseUrl}/api/payslips?period=2026-06`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const byPeriodBody = await byPeriod.json();
  assert.ok(byPeriodBody.payslips.every((p) => p.period === '2026-06'));
  assert.ok(byPeriodBody.payslips.length >= 2, 'le comptable ET le DG ont été payés pour 2026-06');
});

test('GET /api/payslips/:id/pdf — document PDF valide', async () => {
  const list = await fetch(`${baseUrl}/api/payslips?userId=${comptableId}&period=2026-06`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const { payslips } = await list.json();
  const id = payslips[0].id;

  const res = await fetch(`${baseUrl}/api/payslips/${id}/pdf`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 500, 'le PDF généré doit avoir un contenu substantiel');
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

test('DELETE /api/payslips/:id — annule la fiche ET la dépense liée (motif obligatoire)', async () => {
  const create = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: comptableId,
      period: '2026-08',
      baseAmount: 150000,
      paymentMethod: 'especes',
      paidAt: '2026-08-05',
      idempotencyKey: 'payslip-test-key-0005',
    }),
  });
  const { payslip } = await create.json();

  const tooShort = await fetch(`${baseUrl}/api/payslips/${payslip.id}`, {
    method: 'DELETE',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ reason: 'x' }),
  });
  assert.equal(tooShort.status, 400);

  const ok = await fetch(`${baseUrl}/api/payslips/${payslip.id}`, {
    method: 'DELETE',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ reason: 'Erreur de saisie du montant' }),
  });
  assert.equal(ok.status, 204);

  const listAfter = await fetch(`${baseUrl}/api/payslips?period=2026-08`, { headers: bearer(fx.dgId, fx.tenantId, 'dg') });
  const listAfterBody = await listAfter.json();
  assert.ok(!listAfterBody.payslips.some((p) => p.id === payslip.id));

  const [[payslipRow]] = await pool.query('SELECT expense_id FROM payslips WHERE id = :id', { id: payslip.id });
  const [[expenseRow]] = await pool.query('SELECT deleted_reason FROM expenses WHERE id = :id', { id: payslipRow.expense_id });
  assert.match(expenseRow.deleted_reason, /Erreur de saisie du montant/);

  // Une nouvelle fiche pour la MÊME période peut maintenant être créée (l'ancienne est annulée).
  const recreate = await fetch(`${baseUrl}/api/payslips`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      userId: comptableId,
      period: '2026-08',
      baseAmount: 160000,
      paymentMethod: 'especes',
      paidAt: '2026-08-06',
      idempotencyKey: 'payslip-test-key-0006',
    }),
  });
  assert.equal(recreate.status, 201);
});

/**
 * Comptabilité avancée (SYSCOHADA) : quand le module est actif, le paiement d'un salaire doit
 * générer l'écriture `salaire_paye` (règle déjà existante, compte 661) — voir
 * `db/seedGeneralLedger.js`.
 */
test('POST /api/payslips — comptabilité avancée active : écriture GL `salaire_paye` équilibrée générée', async () => {
  const glFx = await createFixture();
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
  try {
    const [r] = await pool.query(
      "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Fifi', 'Dossou', :phone, 'x')",
      { t: glFx.tenantId, phone: `07${Math.floor(Math.random() * 100000000)}` },
    );
    const agentId = r.insertId;

    const res = await fetch(`${baseUrl}/api/payslips`, {
      method: 'POST',
      headers: jsonHeaders(glFx.dgId, glFx.tenantId, 'dg'),
      body: JSON.stringify({
        userId: agentId,
        period: '2026-03',
        baseAmount: 120000,
        paymentMethod: 'virement',
        paidAt: '2026-03-28',
        idempotencyKey: 'payslip-test-key-gl-0001',
      }),
    });
    assert.equal(res.status, 201);
    const { payslip } = await res.json();
    assert.equal(payslip.netAmount, 120000);

    const [[entry]] = await pool.query(
      `SELECT id, narration FROM gl_entries WHERE tenant_id = :t AND source_operation_type = 'salaire_paye' LIMIT 1`,
      { t: glFx.tenantId },
    );
    assert.ok(entry, 'une écriture comptable doit avoir été générée');
    assert.match(entry.narration, /Fifi Dossou/);

    const [lines] = await pool.query('SELECT side, amount FROM gl_entry_lines WHERE entry_id = :id', { id: entry.id });
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + Number(l.amount), 0);
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + Number(l.amount), 0);
    assert.equal(debit, 120000);
    assert.equal(credit, 120000);
  } finally {
    await pool.query('DELETE el FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id WHERE e.tenant_id = :t', { t: glFx.tenantId });
    await pool.query('DELETE FROM gl_entries WHERE tenant_id = :t', { t: glFx.tenantId });
    await pool.query('DELETE FROM payslips WHERE tenant_id = :t', { t: glFx.tenantId });
    await pool.query('DELETE FROM expenses WHERE tenant_id = :t', { t: glFx.tenantId });
    await teardown(glFx.tenantId);
  }
});
