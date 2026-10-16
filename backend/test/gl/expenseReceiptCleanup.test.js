'use strict';

/**
 * Audit comptabilité avancée (point 9, 16/10/2026) : le justificatif d'une dépense (upload) est écrit
 * sur disque AVANT l'écriture GL (`routes/accounting.js POST /expenses`). Si celle-ci échoue (ex.
 * aucun exercice comptable ne couvre la date — `resolveOpenFiscalYear`), toute la transaction SQL est
 * annulée, mais le fichier déjà écrit sur disque, LUI, ne l'était pas — un fichier orphelin restait
 * physiquement présent, sans jamais être rattaché à aucune dépense réelle.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { pool, closePool } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { signAccessToken } = require('../../src/utils/jwt');
const { createFixture, teardown } = require('./fixtures');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

let fx;
let server;
let baseUrl;

before(async () => {
  // Exercice fiscal 2026-01-01 → 2026-12-31 uniquement (voir `createFixture`) : une dépense datée en
  // 2027 ne sera couverte par AUCUN exercice — déclenche exactement l'échec visé par ce test.
  fx = await createFixture();
  // `createFixture` seed le plan comptable mais n'active PAS le module (`gl_module_enabled`) — la
  // route elle-même ne poste l'écriture GL que si ce drapeau est vrai (voir `isModuleActive`).
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: fx.tenantId });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Supprime les fichiers réellement écrits par ce test (jamais nettoyés par `teardown`, qui ne touche
  // que la base) — le tenant jetable ne doit laisser aucune trace sur disque non plus.
  await fs.rm(path.join(UPLOADS_ROOT, `tenants/${fx.tenantId}`), { recursive: true, force: true });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}` });

function fakePdfForm({ expenseDate }) {
  const form = new FormData();
  form.set('category', 'fournitures');
  form.set('label', 'Papeterie');
  form.set('amount', '15000');
  form.set('expenseDate', expenseDate);
  form.set('paymentStatus', 'paid');
  form.set('paymentMethod', 'especes');
  // En-tête PDF minimal (`detectFileType`, utils/uploads.js) : suffit à passer la validation par
  // contenu réel, sans dépendre d'une extension ou d'un en-tête HTTP déclaré.
  form.set('receipt', new Blob([Buffer.from('%PDF-1.4 fake content for test')], { type: 'application/pdf' }), 'justificatif.pdf');
  return form;
}

async function listExpenseFiles() {
  const dir = path.join(UPLOADS_ROOT, `tenants/${fx.tenantId}/expenses`);
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

test("POST /expenses — date hors de tout exercice comptable (échec GL) : le justificatif n'est PAS laissé orphelin sur disque", async () => {
  assert.deepEqual(await listExpenseFiles(), [], 'aucun fichier ne doit déjà traîner avant ce test');

  const res = await fetch(`${baseUrl}/api/accounting/expenses`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakePdfForm({ expenseDate: '2027-01-15' }), // hors de l'exercice 2026 de la fixture
  });
  assert.equal(res.status, 404); // `resolveOpenFiscalYear` : aucun exercice ne couvre cette date

  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(Number(row.n), 0, "la dépense elle-même doit être annulée (transaction rollback)");

  assert.deepEqual(await listExpenseFiles(), [], 'le justificatif écrit avant l’échec doit avoir été nettoyé, pas laissé orphelin');
});

test('POST /expenses — chemin normal (date couverte par un exercice ouvert) : le justificatif est bien conservé', async () => {
  const res = await fetch(`${baseUrl}/api/accounting/expenses`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId),
    body: fakePdfForm({ expenseDate: '2026-04-10' }), // couverte par l'exercice 2026
  });
  assert.equal(res.status, 201);

  const files = await listExpenseFiles();
  assert.equal(files.length, 1, 'le justificatif doit être conservé quand tout réussit');

  const [[row]] = await pool.query('SELECT receipt_path FROM expenses WHERE tenant_id = :t', { t: fx.tenantId });
  assert.ok(row.receipt_path.endsWith(files[0]));
});
