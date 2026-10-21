'use strict';

/** Autres entrées d'argent du cabinet (21/10/2026) : enregistrement, écriture GL, totaux, suppression, sécurité. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { pool, closePool } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { signAccessToken } = require('../../src/utils/jwt');
const { createFixture, teardown } = require('./fixtures');

let fx;
let other;
let server;
let baseUrl;

const bearer = (id, tenantId, role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}` });
const json = (fxx) => ({ ...bearer(fxx.dgId, fxx.tenantId), 'Content-Type': 'application/json' });

before(async () => {
  fx = await createFixture();
  other = await createFixture();
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(path.join(__dirname, `../../uploads/tenants/${fx.tenantId}`), { recursive: true, force: true });
  await teardown(fx.tenantId);
  await teardown(other.tenantId);
  await closePool();
});

async function post(body, who = fx) {
  return fetch(`${baseUrl}/api/accounting/incomes`, { method: 'POST', headers: json(who), body: JSON.stringify(body) });
}
const base = { category: 'prestation', label: 'Conseil juridique client X', amount: 120000, incomeDate: '2026-04-10', paymentMethod: 'mobile_money' };

async function glLines(sourceId) {
  const [rows] = await pool.query(
    `SELECT a.code, l.side, l.amount FROM gl_entries e
     JOIN gl_entry_lines l ON l.entry_id = e.id JOIN gl_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = :t AND e.source_table = 'other_incomes' AND e.source_id = :id AND e.status = 'validee'`,
    { t: fx.tenantId, id: sourceId },
  );
  return rows.map((r) => ({ code: r.code, debit: r.side === 'debit' ? Number(r.amount) : 0, credit: r.side === 'credit' ? Number(r.amount) : 0 }));
}

test('POST /incomes — enregistre l\'entrée et passe l\'écriture 5xx / 706', async () => {
  const res = await post(base);
  assert.equal(res.status, 201);
  const { incomeId } = await res.json();
  const lines = await glLines(incomeId);
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => l.credit > 0).code, '706');
  assert.equal(lines.find((l) => l.credit > 0).credit, 120000);
  assert.equal(lines.find((l) => l.debit > 0).debit, 120000);
});

test('POST /incomes — intérêts → 771, remboursement → 7588', async () => {
  const a = await (await post({ ...base, category: 'interets', label: 'Intérêts compte', amount: 5000 })).json();
  const b = await (await post({ ...base, category: 'remboursement', label: 'Remboursement assurance', amount: 7000 })).json();
  assert.equal((await glLines(a.incomeId)).find((l) => l.credit > 0).code, '771');
  assert.equal((await glLines(b.incomeId)).find((l) => l.credit > 0).code, '7588');
});

test('GET /dashboard et bilan du mois — l\'entrée augmente le solde net et la trésorerie', async () => {
  const dash = await (await fetch(`${baseUrl}/api/accounting/dashboard?from=2026-04-01&to=2026-04-30`, { headers: bearer(fx.dgId, fx.tenantId) })).json();
  assert.equal(dash.totals.otherIncomes, 132000);
  assert.equal(dash.totals.netCashFlow, 132000);
  const bilanRes = await (await fetch(`${baseUrl}/api/accounting/month-bilan/2026-04`, { headers: bearer(fx.dgId, fx.tenantId) })).json();
  const bilan = bilanRes.bilan ?? bilanRes;
  assert.equal(bilan.inflows.lines.otherIncomes, 132000);
  assert.equal(bilan.treasury.in, 132000);
  assert.equal(bilan.cabinet.otherIncomes, 132000);
});

test('GET /incomes — liste filtrée par catégorie, total, isolation entre entreprises', async () => {
  const list = await (await fetch(`${baseUrl}/api/accounting/incomes?category=interets`, { headers: bearer(fx.dgId, fx.tenantId) })).json();
  assert.equal(list.incomes.length, 1);
  assert.equal(list.total, 5000);
  const foreign = await (await fetch(`${baseUrl}/api/accounting/incomes`, { headers: bearer(other.dgId, other.tenantId) })).json();
  assert.equal(foreign.incomes.length, 0);
});

test('POST /incomes — validations (montant, catégorie, date, libellé, mode)', async () => {
  for (const bad of [
    { amount: 0 }, { amount: -5 }, { amount: 1.5 }, { amount: 2_000_000_000 },
    { category: 'hack' }, { incomeDate: '10/04/2026' }, { label: 'x' }, { paymentMethod: 'bitcoin' },
  ]) {
    const res = await post({ ...base, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test('POST /incomes — injection SQL dans le libellé stockée littéralement', async () => {
  const evil = "'); DROP TABLE other_incomes;--";
  const res = await post({ ...base, label: evil, amount: 1000 });
  assert.equal(res.status, 201);
  const [[row]] = await pool.query('SELECT label FROM other_incomes WHERE id = :id', { id: (await res.json()).incomeId });
  assert.equal(row.label, evil);
  await pool.query("DELETE FROM other_incomes WHERE tenant_id = :t AND label = :l", { t: fx.tenantId, l: evil });
});

test('POST /incomes — idempotence : même clé, une seule entrée', async () => {
  const key = 'idem-income-0123456789abcdef';
  const r1 = await post({ ...base, label: 'Idempotent', amount: 2000, idempotencyKey: key });
  const r2 = await post({ ...base, label: 'Idempotent', amount: 2000, idempotencyKey: key });
  assert.equal(r1.status, 201);
  assert.notEqual(r2.status, 201);
  const [[row]] = await pool.query("SELECT COUNT(*) n FROM other_incomes WHERE tenant_id = :t AND label = 'Idempotent'", { t: fx.tenantId });
  assert.equal(Number(row.n), 1);
});

test('POST /incomes — sans permission comptabilité : 403 ; sans jeton : 401', async () => {
  const [u] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'A', 'B', :p, 'x')",
    { t: fx.tenantId, p: `04${Math.floor(Math.random() * 100000000)}` },
  );
  const res = await fetch(`${baseUrl}/api/accounting/incomes`, {
    method: 'POST',
    headers: { ...bearer(u.insertId, fx.tenantId, 'agent'), 'Content-Type': 'application/json' },
    body: JSON.stringify(base),
  });
  assert.ok([403, 401].includes(res.status), `statut ${res.status}`);
  const anon = await fetch(`${baseUrl}/api/accounting/incomes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base) });
  assert.equal(anon.status, 401);
  await pool.query('DELETE FROM users WHERE id = :id', { id: u.insertId });
});

test('POST /incomes — date hors de tout exercice : rien n\'est enregistré (transaction annulée)', async () => {
  const before = await pool.query('SELECT COUNT(*) n FROM other_incomes WHERE tenant_id = :t', { t: fx.tenantId });
  const res = await post({ ...base, incomeDate: '2027-02-01', label: 'Hors exercice' });
  assert.notEqual(res.status, 201);
  const after = await pool.query('SELECT COUNT(*) n FROM other_incomes WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(Number(after[0][0].n), Number(before[0][0].n));
});

test('DELETE /incomes/:id — justification obligatoire, suppression logique, extourne GL, sortie des totaux', async () => {
  const { incomeId } = await (await post({ ...base, label: 'À annuler', amount: 40000, incomeDate: '2026-05-05' })).json();
  const noReason = await fetch(`${baseUrl}/api/accounting/incomes/${incomeId}`, { method: 'DELETE', headers: json(fx), body: JSON.stringify({}) });
  assert.equal(noReason.status, 400);
  const foreign = await fetch(`${baseUrl}/api/accounting/incomes/${incomeId}`, { method: 'DELETE', headers: json(other), body: JSON.stringify({ reason: 'tentative inter-tenant' }) });
  assert.equal(foreign.status, 404);

  const del = await fetch(`${baseUrl}/api/accounting/incomes/${incomeId}`, { method: 'DELETE', headers: json(fx), body: JSON.stringify({ reason: 'Saisie en double' }) });
  assert.equal(del.status, 200);
  const [[row]] = await pool.query('SELECT deleted_at, deleted_reason FROM other_incomes WHERE id = :id', { id: incomeId });
  assert.ok(row.deleted_at);
  assert.equal(row.deleted_reason, 'Saisie en double');
  const dash = await (await fetch(`${baseUrl}/api/accounting/dashboard?from=2026-05-01&to=2026-05-31`, { headers: bearer(fx.dgId, fx.tenantId) })).json();
  assert.equal(dash.totals.otherIncomes, 0);
  const [entries] = await pool.query(`SELECT status FROM gl_entries WHERE tenant_id = :t AND source_table = 'other_incomes' AND source_id = :id`, { t: fx.tenantId, id: incomeId });
  assert.ok(entries.some((e) => e.status === 'extournee'));
  const again = await fetch(`${baseUrl}/api/accounting/incomes/${incomeId}`, { method: 'DELETE', headers: json(fx), body: JSON.stringify({ reason: 'Deuxième tentative' }) });
  assert.equal(again.status, 404);
});

test('POST /incomes — justificatif conservé ; fichier orphelin nettoyé si l\'écriture échoue', async () => {
  const form = (date) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ ...base, incomeDate: date })) f.set(k, String(v));
    f.set('receipt', new Blob([Buffer.from('%PDF-1.4 fake content for test')], { type: 'application/pdf' }), 'j.pdf');
    return f;
  };
  const dir = path.join(__dirname, `../../uploads/tenants/${fx.tenantId}/incomes`);
  const ls = () => fs.readdir(dir).catch(() => []);
  const n0 = (await ls()).length;
  const bad = await fetch(`${baseUrl}/api/accounting/incomes`, { method: 'POST', headers: bearer(fx.dgId, fx.tenantId), body: form('2027-03-01') });
  assert.notEqual(bad.status, 201);
  assert.equal((await ls()).length, n0);
  const ok = await fetch(`${baseUrl}/api/accounting/incomes`, { method: 'POST', headers: bearer(fx.dgId, fx.tenantId), body: form('2026-06-01') });
  assert.equal(ok.status, 201);
  assert.equal((await ls()).length, n0 + 1);
});
