'use strict';

/**
 * Étape 31 — reversement des charges encaissées, carnet des entrées, alertes
 * du suivi des charges et PDF du carnet. Fixtures GL réutilisées uniquement
 * pour créer un tenant/propriétaire/bien/bail jetables.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');

const { pool, closePool } = require('../src/config/db');
const { ApiError } = require('../src/middleware/error');
const {
  getChargeAccounts,
  getChargeAccount,
  assertRemittanceWithinBalance,
  getOldestUnremittedDates,
  listRemittances,
} = require('../src/services/utilityRemittance');
const { getUtilityEntries, getOwnerCarnet, resolveMonthWindow } = require('../src/services/utilityPoint');
const { listUtilityAlerts } = require('../src/services/utilityAlerts');
const { buildDigestMessage, runUtilityAlertsJob } = require('../src/jobs/utilityAlertsJob');
const { streamUtilityCarnetPdf, streamOwnerStatementPdf } = require('../src/services/pdf');
const { createBareFixture } = require('./gl/fixtures');
const { insertBatch, insertCharge, insertRemittance, addSecondUnit, cleanupUtility } = require('./utilityFixtures');

let fx;
let second; // 2e unité/bail
let otherOwnerId;

before(async () => {
  fx = await createBareFixture();
  second = await addSecondUnit(fx, 'U2');
  const [o] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
    t: fx.tenantId,
    n: 'Autre Propriétaire',
    by: fx.dgId,
  });
  otherOwnerId = o.insertId;
});

after(async () => {
  await cleanupUtility(fx.tenantId);
  await closePool();
});

test('resolveMonthWindow — 6 mois se terminant au mois choisi par défaut ; refuse un format ou un ordre invalide', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  assert.deepEqual(resolveMonthWindow(undefined, undefined, now), { fromMonth: '2026-04', toMonth: '2026-09' });
  assert.deepEqual(resolveMonthWindow(null, '2027-02', now), { fromMonth: '2026-09', toMonth: '2027-02' });
  assert.deepEqual(resolveMonthWindow('2026-01', '2026-03', now), { fromMonth: '2026-01', toMonth: '2026-03' });
  assert.throws(() => resolveMonthWindow('2026-13', '2026-09', now), (e) => e instanceof ApiError && e.status === 400);
  assert.throws(() => resolveMonthWindow('2026-10', '2026-09', now), (e) => e instanceof ApiError && e.status === 400);
  assert.throws(() => resolveMonthWindow('abc', undefined, now), (e) => e instanceof ApiError && e.status === 400);
});

test('getChargeAccounts — encaissé − reversé ; factures supprimées et reversements annulés ignorés ; jamais mélangé entre propriétaires', async () => {
  const batchId = await insertBatch(fx, { periodStart: '2026-08-01', periodEnd: '2026-08-31', mainInvoice: 100000, mainPaid: 100000 });
  await insertCharge(fx, { batchId, unitId: fx.unitId, leaseId: fx.leaseId, amount: 40000, paid: 40000, paidAt: '2026-09-02', periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  await insertCharge(fx, { batchId, unitId: second.unitId, leaseId: second.leaseId, amount: 30000, paid: 10000, paidAt: '2026-09-03', periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  // Une facture SUPPRIMÉE logiquement, pourtant réglée : ne compte pas.
  await insertCharge(fx, { unitId: fx.unitId, leaseId: fx.leaseId, amount: 9999, paid: 9999, paidAt: '2026-09-04', periodStart: '2026-07-01', periodEnd: '2026-07-31', deleted: true });

  let acc = await getChargeAccount(pool, fx.tenantId, fx.ownerId);
  assert.deepEqual(acc, { collected: 50000, remitted: 0, balance: 50000 });
  assert.deepEqual(await getChargeAccount(pool, fx.tenantId, otherOwnerId), { collected: 0, remitted: 0, balance: 0 });

  await insertRemittance(fx, { amount: 20000, paidAt: '2026-09-10' });
  await insertRemittance(fx, { amount: 5000, paidAt: '2026-09-11', deleted: true }); // annulé : ignoré
  acc = await getChargeAccount(pool, fx.tenantId, fx.ownerId);
  assert.deepEqual(acc, { collected: 50000, remitted: 20000, balance: 30000 });

  const all = await getChargeAccounts(pool, fx.tenantId);
  assert.equal(all.get(fx.ownerId).balance, 30000);
  assert.equal(all.has(otherOwnerId), false);
});

test('assertRemittanceWithinBalance — exactement le solde accepté, un FCFA de plus rejeté (400)', async () => {
  // Solde courant : 30 000 (test précédent).
  await assertRemittanceWithinBalance(pool, fx.tenantId, fx.ownerId, 30000);
  await assert.rejects(
    () => assertRemittanceWithinBalance(pool, fx.tenantId, fx.ownerId, 30001),
    (e) => e instanceof ApiError && e.status === 400,
  );
  await assert.rejects(
    () => assertRemittanceWithinBalance(pool, fx.tenantId, otherOwnerId, 1),
    (e) => e instanceof ApiError && e.status === 400,
    'un propriétaire sans aucune charge encaissée ne peut rien recevoir',
  );
});

test('getOldestUnremittedDates — les reversements soldent d\'abord les plus anciens encaissements', async () => {
  // Encaissements : 02/09 = 40 000, 03/09 = 10 000 ; reversé 20 000 → le plus ancien non couvert reste celui du 02/09 (40 000 > 20 000).
  let since = await getOldestUnremittedDates(pool, fx.tenantId);
  assert.equal(since.get(fx.ownerId), '2026-09-02');

  // Reversé 40 000 au total → le règlement du 02/09 est couvert, le plus ancien restant est celui du 03/09.
  await insertRemittance(fx, { amount: 20000, paidAt: '2026-09-12' });
  since = await getOldestUnremittedDates(pool, fx.tenantId);
  assert.equal(since.get(fx.ownerId), '2026-09-03');

  // Tout reversé (50 000) → plus rien en attente.
  await insertRemittance(fx, { amount: 10000, paidAt: '2026-09-13' });
  since = await getOldestUnremittedDates(pool, fx.tenantId);
  assert.equal(since.has(fx.ownerId), false);
  assert.equal((await getChargeAccount(pool, fx.tenantId, fx.ownerId)).balance, 0);
});

test('listRemittances — annulés exclus par défaut, plage de dates respectée', async () => {
  const active = await listRemittances(pool, fx.tenantId, fx.ownerId);
  assert.equal(active.length, 3);
  assert.ok(active.every((r) => r.deletedAt == null));
  const withDeleted = await listRemittances(pool, fx.tenantId, fx.ownerId, { includeDeleted: true });
  assert.equal(withDeleted.length, 4);
  const ranged = await listRemittances(pool, fx.tenantId, fx.ownerId, { fromDate: '2026-09-12', toDate: '2026-09-30' });
  assert.deepEqual(ranged.map((r) => r.amount).sort((a, b) => a - b), [10000, 20000]);
});

test('getUtilityEntries / getOwnerCarnet — entrées par période facturée, facture individuelle signalée, compte hors périmètre agent', async () => {
  const entries = await getUtilityEntries(fx.tenantId, { ownerId: fx.ownerId, fromMonth: '2026-08', toMonth: '2026-08' });
  assert.equal(entries.items.length, 2, 'les deux règlements du relevé d\'août (la facture supprimée de juillet est exclue)');
  assert.equal(entries.total, 50000);
  assert.equal(entries.outsideBatchesTotal, 0);
  assert.deepEqual(entries.items.map((e) => e.paidAt), ['2026-09-02', '2026-09-03'], 'triées par date de règlement');
  assert.ok(entries.items.every((e) => e.batchId != null));

  // Facture individuelle (hors relevé) sur le mois d'octobre.
  await insertCharge(fx, { unitId: fx.unitId, leaseId: fx.leaseId, amount: 7000, paid: 7000, paidAt: '2026-11-03', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  const oct = await getUtilityEntries(fx.tenantId, { ownerId: fx.ownerId, fromMonth: '2026-10', toMonth: '2026-10' });
  assert.equal(oct.items.length, 1);
  assert.equal(oct.items[0].batchId, null);
  assert.equal(oct.outsideBatchesTotal, 7000);

  const carnet = await getOwnerCarnet(fx.tenantId, fx.ownerId, { fromMonth: '2026-08', toMonth: '2026-10' });
  assert.equal(carnet.batches.length, 1);
  assert.equal(carnet.entries.total, 57000);
  assert.deepEqual(carnet.account, { collected: 57000, remitted: 50000, balance: 7000 });
  assert.equal(carnet.remittances.length, 3, 'reversements de la fenêtre (septembre)');
  assert.equal(carnet.remittedInWindow, 50000);

  const scoped = await getOwnerCarnet(fx.tenantId, fx.ownerId, { fromMonth: '2026-08', toMonth: '2026-10', scopeAgentId: fx.dgId });
  assert.equal(scoped.account, null, 'le solde de bout en bout n\'est jamais exposé à un agent restreint');
  assert.equal(scoped.batches.length, 0);
  assert.equal(scoped.entries.items.length, 0);
});

test('listUtilityAlerts — relevé manquant : délai de grâce, couverture par un relevé du mois précédent, sévérité selon le retard', async () => {
  await pool.query("UPDATE properties SET soneb_submetered = 1, soneb_unit_price = 100 WHERE id = :p", { p: fx.propertyId });
  await pool.query("UPDATE property_units SET soneb_meter_number = 'SONEB000000001' WHERE id = :u", { u: fx.unitId });

  const alertsOf = async (today, type) => (await listUtilityAlerts(fx.tenantId, { today })).filter((a) => a.type === type);

  // Dernier relevé : fin août. Aujourd'hui 10/11 → attendu : celui d'octobre ; manquent septembre et octobre → danger.
  let a = await alertsOf('2026-11-10', 'releve_manquant');
  assert.equal(a.length, 1);
  assert.equal(a[0].severity, 'danger');
  assert.equal(a[0].propertyId, fx.propertyId);
  assert.equal(a[0].utilityType, 'soneb');
  assert.match(a[0].href, /propertyId=/);
  assert.match(a[0].title, /Relevé SONEB d'octobre 2026 non fait/, 'élision devant octobre/août/avril');
  assert.match((await alertsOf('2026-10-10', 'releve_manquant'))[0].title, /Relevé SONEB de septembre 2026 non fait/);

  // Avant le 5 du mois : pas encore attendu.
  assert.equal((await alertsOf('2026-11-03', 'releve_manquant')).length, 0);

  // Relevé de septembre (fin 30/09) : il ne manque plus qu'octobre → simple avertissement.
  await insertBatch(fx, { periodStart: '2026-09-01', periodEnd: '2026-09-30', mainInvoice: 50000, mainPaid: 50000 });
  a = await alertsOf('2026-11-10', 'releve_manquant');
  assert.equal(a.length, 1);
  assert.equal(a[0].severity, 'warning');

  // Relevé d'octobre, même en brouillon → couvert.
  const octBatch = await insertBatch(fx, { periodStart: '2026-10-01', periodEnd: '2026-10-31', mainInvoice: 50000, status: 'brouillon', createdAt: '2026-11-01 08:00:00' });
  assert.equal((await alertsOf('2026-11-10', 'releve_manquant')).length, 0);

  // Brouillon vieux de 9 jours → « à valider » ; vieux de 2 jours → rien.
  const drafts = await alertsOf('2026-11-10', 'releve_a_valider');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].batchId, octBatch);
  assert.equal(drafts[0].daysLate, 9);
  assert.equal((await alertsOf('2026-11-03', 'releve_a_valider')).length, 0);

  // Bien sans locataire à facturer : aucun relevé attendu.
  await pool.query("UPDATE leases SET status = 'ended' WHERE tenant_id = :t", { t: fx.tenantId });
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :t AND period_start >= :d', { t: fx.tenantId, d: '2026-09-01' });
  assert.equal((await alertsOf('2026-11-10', 'releve_manquant')).length, 0);
  await pool.query("UPDATE leases SET status = 'active' WHERE tenant_id = :t", { t: fx.tenantId });
});

test('listUtilityAlerts — facture mère non déclarée, écart anormal, charges à reverser, agent restreint', async () => {
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_readings WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM owner_charge_remittances WHERE tenant_id = :t', { t: fx.tenantId });

  const today = '2026-11-10';
  const alertsOf = async (type, opts = {}) => (await listUtilityAlerts(fx.tenantId, { today, ...opts })).filter((a) => a.type === type);

  // Validé le 20/10 (21 j), non déclaré → warning ; validé le 01/09 (70 j) → danger.
  const recent = await insertBatch(fx, { periodStart: '2026-10-01', periodEnd: '2026-10-31', mainInvoice: 60000, validatedAt: '2026-10-20 09:00:00' });
  const old = await insertBatch(fx, { periodStart: '2026-08-01', periodEnd: '2026-08-31', mainInvoice: 70000, validatedAt: '2026-09-01 09:00:00' });
  // Déjà déclaré payé : aucune alerte de facture mère.
  const july = await insertBatch(fx, { periodStart: '2026-07-01', periodEnd: '2026-07-31', mainInvoice: 50000, mainPaid: 50000, validatedAt: '2026-08-01 09:00:00' });
  const declared = (await alertsOf('facture_mere_non_declaree')).map((x) => [x.batchId, x.severity]);
  assert.deepEqual(declared.sort(), [[recent, 'warning'], [old, 'danger']].sort());
  // Validé depuis moins de 7 jours : pas d'alerte.
  assert.equal((await alertsOf('facture_mere_non_declaree', { today: '2026-10-22' })).filter((x) => x.batchId === recent).length, 0);

  // Écart : compteur principal 1000, décompteurs 10 → 99 % non refacturé → warning ;
  // décompteurs 1200 > compteur → incohérence (danger) ; relevé de juillet (102 j) hors fenêtre de 90 jours.
  await insertCharge(fx, { batchId: recent, unitId: fx.unitId, leaseId: fx.leaseId, amount: 1000, periodStart: '2026-10-01', periodEnd: '2026-10-31', readingEnd: 10 });
  const negative = await insertBatch(fx, { periodStart: '2026-09-01', periodEnd: '2026-09-30', mainInvoice: 10000, mainPaid: 10000 });
  await insertCharge(fx, { batchId: negative, unitId: fx.unitId, leaseId: fx.leaseId, amount: 120000, periodStart: '2026-09-01', periodEnd: '2026-09-30', readingEnd: 1200 });
  const bySev = Object.fromEntries((await alertsOf('ecart_eleve')).map((x) => [x.batchId, x.severity]));
  assert.equal(bySev[recent], 'warning');
  assert.equal(bySev[negative], 'danger');
  assert.equal(bySev[july], undefined, 'hors fenêtre de 90 jours');

  // Un relevé correct (écart de 10 % seulement) : aucune alerte.
  const fine = await insertBatch(fx, { periodStart: '2026-11-01', periodEnd: '2026-11-30', mainInvoice: 10000, mainPaid: 10000, mainReadingEnd: 100 });
  await insertCharge(fx, { batchId: fine, unitId: fx.unitId, leaseId: fx.leaseId, amount: 9000, periodStart: '2026-11-01', periodEnd: '2026-11-30', readingEnd: 90 });
  assert.equal((await alertsOf('ecart_eleve')).filter((x) => x.batchId === fine).length, 0);

  // Charges à reverser : 40 000 encaissés le 01/10 (40 j) → warning ; encaissés le 05/11 (5 j) → rien.
  const paidCharge = await insertCharge(fx, { batchId: recent, unitId: second.unitId, leaseId: second.leaseId, amount: 40000, paid: 40000, paidAt: '2026-10-01', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  let remit = await alertsOf('charges_a_reverser');
  assert.equal(remit.length, 1);
  assert.equal(remit[0].ownerId, fx.ownerId);
  assert.equal(remit[0].amount, 40000);
  assert.equal(remit[0].severity, 'warning');
  assert.equal(remit[0].daysLate, 40);
  assert.equal((await alertsOf('charges_a_reverser', { today: '2026-10-05' })).length, 0, '4 jours seulement : pas encore une alerte');

  // Reversement partiel : l'alerte reste avec le solde restant.
  await insertRemittance(fx, { amount: 15000, paidAt: '2026-11-08' });
  remit = await alertsOf('charges_a_reverser');
  assert.equal(remit[0].amount, 25000);

  // Agent restreint : aucun Bien attribué → aucune alerte, et jamais d'alerte de reversement.
  const scoped = await listUtilityAlerts(fx.tenantId, { today, scopeAgentId: fx.dgId });
  assert.equal(scoped.length, 0);

  // Tout reversé → plus d'alerte.
  await insertRemittance(fx, { amount: 25000, paidAt: '2026-11-09' });
  assert.equal((await alertsOf('charges_a_reverser')).length, 0);
  assert.ok(paidCharge > 0);
});

test('runUtilityAlertsJob — une seule notification DG par jour, uniquement s\'il y a des alertes ; message de synthèse', async () => {
  const [dg] = await pool.query("SELECT id FROM users WHERE tenant_id = :t AND role = 'dg'", { t: fx.tenantId });
  assert.ok(dg[0], 'la fixture crée un DG');

  await runUtilityAlertsJob({ tenantIds: [fx.tenantId], today: '2026-11-10' });
  await runUtilityAlertsJob({ tenantIds: [fx.tenantId], today: '2026-11-10' }); // même jour : dédoublonné
  const [rows] = await pool.query("SELECT message FROM gl_notifications WHERE tenant_id = :t AND type = 'utility_alerts_digest'", { t: fx.tenantId });
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /^Charges SONEB\/SBEE : /);
  assert.ok(rows[0].message.length <= 255);

  assert.equal(
    buildDigestMessage([{ type: 'releve_manquant' }, { type: 'releve_manquant' }, { type: 'charges_a_reverser' }]),
    'Charges SONEB/SBEE : 2 relevés manquants, 1 propriétaire à qui reverser des charges — voir « Le point des charges »',
  );

  // Aucune alerte (tenant sans relevé ni charge) : aucune notification.
  const [t2] = await pool.query("INSERT INTO tenants (company_name, rccm, ifu, contact_phone) VALUES ('Vide', 'R', 'I', '0100000000')");
  await pool.query("INSERT INTO users (tenant_id, first_name, last_name, phone, password_hash, role) VALUES (:t, 'D', 'G', :phone, 'x', 'dg')", { t: t2.insertId, phone: `05${Math.floor(Math.random() * 100000000)}` });
  await runUtilityAlertsJob({ tenantIds: [t2.insertId], today: '2026-11-10' });
  const [none] = await pool.query("SELECT id FROM gl_notifications WHERE tenant_id = :t", { t: t2.insertId });
  assert.equal(none.length, 0);
  await pool.query('DELETE FROM users WHERE tenant_id = :t', { t: t2.insertId });
  await pool.query('DELETE FROM tenants WHERE id = :t', { t: t2.insertId });
});

// ── PDF ────────────────────────────────────────────────────────────────

function capturePdf(streamFn) {
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    try {
      streamFn(res);
    } catch (err) {
      reject(err);
    }
  });
}

function pdfText(buffer) {
  const file = path.join(os.tmpdir(), `carnet-test-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(file, buffer);
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } finally {
    fs.unlinkSync(file);
  }
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('streamUtilityCarnetPdf — PDF valide avec le point, les entrées, les reversements et le code de vérification', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  // État propre : un relevé validé, payé, deux règlements, un reversement.
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_readings WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM owner_charge_remittances WHERE tenant_id = :t', { t: fx.tenantId });

  const batchId = await insertBatch(fx, { periodStart: '2026-09-01', periodEnd: '2026-09-30', mainInvoice: 100000, mainPaid: 100000, mainReadingEnd: 1000 });
  await insertCharge(fx, { batchId, unitId: fx.unitId, leaseId: fx.leaseId, amount: 30000, paid: 30000, paidAt: '2026-10-02', periodStart: '2026-09-01', periodEnd: '2026-09-30', readingEnd: 300 });
  await insertCharge(fx, { batchId, unitId: second.unitId, leaseId: second.leaseId, amount: 20000, paid: 5000, paidAt: '2026-10-03', periodStart: '2026-09-01', periodEnd: '2026-09-30', readingEnd: 200 });
  await insertRemittance(fx, { amount: 20000, paidAt: '2026-10-10', periodLabel: 'Charges septembre' });

  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: fx.tenantId });
  const [ownerRows] = await pool.query('SELECT * FROM owners WHERE id = :id', { id: fx.ownerId });
  const carnet = await getOwnerCarnet(fx.tenantId, fx.ownerId, { fromMonth: '2026-09', toMonth: '2026-10' });

  const pdf = await capturePdf((res) => streamUtilityCarnetPdf(res, { tenant: tenantRows[0], owner: ownerRows[0], carnet, verificationCode: 'ABCD-1234-WXYZ' }));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const text = pdfText(pdf);
  assert.match(text, /CARNET DES CHARGES/);
  assert.ok(text.includes(ownerRows[0].name));
  assert.match(text, /de septembre 2026 à octobre 2026/);
  assert.match(text, /Facture mère payée par le propriétaire\s+100 000 FCFA/);
  assert.match(text, /Encaissé chez les locataires \(relevés\)\s+35 000 FCFA/);
  assert.match(text, /Reste à la charge du propriétaire\s+65 000 FCFA/);
  assert.match(text, /Reste à reverser au propriétaire\s+15 000 FCFA/);
  assert.match(text, /Loc?U2|LocU2/);
  assert.match(text, /Total encaissé \(2 règlements\)/);
  assert.match(text, /Charges septembre/);
  assert.match(text, /ABCD-1234-WXYZ/);
  assert.match(text, /Document téléchargé le/);

  // Copie employé agent restreint : pas de compte à reverser dans le document.
  const scoped = await getOwnerCarnet(fx.tenantId, fx.ownerId, { fromMonth: '2026-09', toMonth: '2026-10', scopeAgentId: fx.dgId });
  const scopedText = pdfText(await capturePdf((res) => streamUtilityCarnetPdf(res, { tenant: tenantRows[0], owner: ownerRows[0], carnet: scoped })));
  assert.doesNotMatch(scopedText, /Reste à reverser au propriétaire/);
  assert.match(scopedText, /Aucun relevé validé sur cette période/);
});

test('streamUtilityCarnetPdf — 80 entrées et 14 relevés : pagination correcte, aucune ligne perdue, noms longs tronqués', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: fx.tenantId });
  const batches = Array.from({ length: 14 }, (_, i) => ({
    batchId: i + 1, propertyId: 1, propertyCode: `BIEN-${String(i + 1).padStart(3, '0')}`, ownerId: 1, ownerName: 'X',
    utilityType: i % 2 ? 'sbee' : 'soneb', periodStart: '2026-09-01', periodEnd: '2026-09-30',
    mainInvoice: 100000, mainPaid: i % 3 === 0 ? null : 100000, mainPaidAt: i % 3 === 0 ? null : '2026-09-28',
    chargesCount: 3, unpaidChargesCount: 1, billed: 60000, collected: 45000, tenantUnpaid: 15000,
    gap: i % 3 === 0 ? null : 55000, nonRebilled: i % 3 === 0 ? null : 40000,
    status: ['paiement_non_renseigne', 'a_recouvrer', 'a_charge_proprietaire', 'solde'][i % 4],
  }));
  const items = Array.from({ length: 80 }, (_, i) => ({
    paymentId: i + 1, paidAt: '2026-10-05', amount: 1000 + i, paymentMethod: i % 2 ? 'mobile_money' : 'especes',
    chargeId: i + 1, batchId: i % 10 === 0 ? null : 1, utilityType: 'soneb', periodStart: '2026-09-01', periodEnd: '2026-09-30',
    propertyId: 1, propertyCode: 'BIEN-001', unitCode: `U${i + 1}`,
    renterName: i === 5 ? `Nom${'Tresmais'.repeat(12)} Prénom` : `Locataire${String(i + 1).padStart(3, '0')} Test`,
  }));
  const carnet = {
    from: '2026-09', to: '2026-09', batches,
    totals: { batchCount: 14, mainInvoiceTotal: 1400000, billedTotal: 840000, collectedTotal: 630000, tenantUnpaidTotal: 210000,
      mainPaidTotal: 900000, gapTotal: 500000, nonRebilledTotal: 300000, tenantUnpaidOnPaidTotal: 200000, pendingPaymentCount: 5, pendingInvoiceAmount: 500000 },
    entries: { items, total: items.reduce((s, e) => s + e.amount, 0), outsideBatchesTotal: items.filter((e) => e.batchId == null).reduce((s, e) => s + e.amount, 0) },
    remittances: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, amount: 1000, paidAt: '2026-10-08', paymentMethod: 'virement', periodLabel: `Reversement n°${i + 1}`, notes: null })),
    remittedInWindow: 30000,
    account: { collected: 500000, remitted: 30000, balance: 470000 },
  };
  const pdf = await capturePdf((res) => streamUtilityCarnetPdf(res, { tenant: tenantRows[0], owner: { name: 'Éléonore D’Almeida "Test"', phone: '0166000000' }, carnet }));
  const text = pdfText(pdf);
  const pages = text.split('\f').filter((p) => p.trim().length > 0);
  assert.ok(pages.length >= 3, `plusieurs pages attendues, obtenu ${pages.length}`);
  for (let i = 1; i <= 80; i += 1) {
    if (i === 6) continue;
    assert.ok(text.includes(`Locataire${String(i).padStart(3, '0')}`), `entrée ${i} présente`);
  }
  assert.ok(text.includes('Total encaissé (80 règlements)'));
  assert.ok(text.includes('Reversement n°30'), 'dernier reversement présent');
  assert.ok(text.includes('…'), 'le nom trop long est tronqué');
  assert.ok(!text.includes('Tresmaisdelong'), 'le nom trop long ne déborde pas');
  // Un pied de page par page, aucune page blanche parasite.
  assert.equal((text.match(/Document téléchargé le/g) ?? []).length, pages.length);
  assert.match(text, /dont .* de factures individuelles/);
  assert.match(text, /Total reversé sur la période/);
});

test('streamOwnerStatementPdf — la section « Charges SONEB / SBEE » figure dans le relevé propriétaire', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id', { id: fx.tenantId });
  const [ownerRows] = await pool.query('SELECT * FROM owners WHERE id = :id', { id: fx.ownerId });
  const carnet = await getOwnerCarnet(fx.tenantId, fx.ownerId, { fromMonth: '2026-04', toMonth: '2026-09' });
  const units = [{ propertyCode: 'GLT-001', address: 'Adresse', unitCode: 'U1', designationLabel: 'Studio', status: 'loue', monthlyRent: 50000, currentRenter: 'A B' }];
  const withCharges = pdfText(await capturePdf((res) => streamOwnerStatementPdf(res, { tenant: tenantRows[0], owner: ownerRows[0], units, payouts: [], charges: carnet })));
  assert.match(withCharges, /Charges SONEB \/ SBEE/);
  assert.match(withCharges, /d'avril 2026 à septembre 2026/);
  assert.match(withCharges, /Reste à reverser au propriétaire/);
  const without = pdfText(await capturePdf((res) => streamOwnerStatementPdf(res, { tenant: tenantRows[0], owner: ownerRows[0], units, payouts: [] })));
  assert.doesNotMatch(without, /Charges SONEB \/ SBEE/);
});
