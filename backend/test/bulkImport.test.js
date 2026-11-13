'use strict';

/**
 * Import en masse depuis Excel (demande utilisateur, 2026-11-13) — services/bulkImport.js,
 * routes/bulkImport.js. Vérifie le modèle, l'aperçu (n'écrit rien), l'import réel, le signalement
 * des erreurs par ligne et le tout-ou-rien.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { buildTemplateBuffer, SHEETS } = require('../src/services/bulkImport');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx; let server; let baseUrl;
const auth = (role = 'dg') => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role })}` });
const phone = (prefix) => `${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const monthsAgo = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

/** Remplit le VRAI modèle : `data = { owners: [{ 'Nom': … }], units: […], renters: […] }`, clés = en-têtes. */
async function workbook(data) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplateBuffer());
  for (const [key, lines] of Object.entries(data)) {
    const ws = wb.getWorksheet(SHEETS[key].name);
    const col = {};
    ws.getRow(1).eachCell((c, i) => { col[String(c.value).replace(' *', '')] = i; });
    lines.forEach((line, n) => {
      for (const [header, value] of Object.entries(line)) {
        assert.ok(col[header], `colonne inconnue dans le test : ${header}`);
        ws.getCell(n + 2, col[header]).value = value;
      }
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function send(path, buffer, headers = auth()) {
  const form = new FormData();
  if (buffer) form.set('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');
  const res = await fetch(`${baseUrl}/api/import/${path}`, { method: 'POST', headers, body: form });
  return { status: res.status, body: await res.json() };
}
async function counts() {
  const out = {};
  for (const t of ['owners', 'properties', 'property_units', 'renters', 'leases']) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = :t`, { t: fx.tenantId });
    out[t] = Number(n);
  }
  return out;
}

/** Un portefeuille valide : 1 propriétaire nouveau + 1 existant, 2 biens, 3 logements, 2 locataires. */
function validPortfolio() {
  const p = { newOwner: phone('01'), renterA: phone('01'), renterB: phone('01') };
  return {
    phones: p,
    data: {
      owners: [
        { Nom: 'Koffi ADJOVI', Téléphone: p.newOwner, 'E-mail': 'koffi@exemple.bj' },
        // Déjà dans l'espace (même téléphone) : réutilisé, jamais recréé.
        { Nom: 'Propriétaire Existant', Téléphone: fx.existingOwnerPhone },
      ],
      units: [
        { 'Téléphone du propriétaire': p.newOwner, 'Référence du bien': 'Immeuble Fidjrossè', 'Type de bien': 'Immeuble', 'Référence du logement': 'A1', Désignation: 'Chambre salon', 'Loyer mensuel': 45000, 'Compteur SBEE': `SB-${p.newOwner}` },
        { 'Téléphone du propriétaire': p.newOwner, 'Référence du bien': 'immeuble fidjrosse', 'Type de bien': 'Immeuble', 'Référence du logement': 'A2', Désignation: 'Studio', 'Loyer mensuel': '30 000' },
        { 'Téléphone du propriétaire': fx.existingOwnerPhone, 'Référence du bien': 'Villa Calavi', 'Type de bien': 'Villa', 'Adresse du bien': 'Calavi, Zogbadjè', 'Référence du logement': 'V1', Désignation: 'Autre', 'Précision (si « Autre »)': 'Villa 4 pièces', 'Loyer mensuel': 120000, Meublé: 'Oui' },
      ],
      renters: [
        {
          Nom: 'HOUNSOU', Prénom: 'Aïcha', Téléphone: p.renterA, 'Référence du bien': 'Immeuble Fidjrossè', 'Référence du logement': 'A1',
          "Date d'entrée": '15/03/2024', 'Caution de loyer': 90000, 'Caution remboursable': 'Non',
          'Mois de loyer impayés': `${monthsAgo(2)}, ${monthsAgo(1)}`, 'Impayé SBEE': 12500,
        },
        {
          Nom: 'DOSSOU', Prénom: 'Marc', Téléphone: p.renterB, 'Référence du bien': 'Villa Calavi', 'Référence du logement': 'V1',
          "Date d'entrée": new Date(Date.UTC(2023, 0, 10)), 'Loyer (si différent du logement)': 110000, "Jour d'échéance (1 à 28)": 10,
          'Loyer du mois en cours déjà payé': 'Oui',
        },
      ],
    },
  };
}

before(async () => {
  fx = await createBareFixture();
  fx.existingOwnerPhone = phone('01');
  await pool.query('UPDATE owners SET phone = :p WHERE id = :id', { p: fx.existingOwnerPhone, id: fx.ownerId });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await teardown(fx.tenantId);
  await closePool();
});

test('GET /api/import/template — le modèle contient les 3 feuilles et leurs colonnes obligatoires', async () => {
  const res = await fetch(`${baseUrl}/api/import/template`, { headers: auth() });
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  for (const def of Object.values(SHEETS)) {
    const ws = wb.getWorksheet(def.name);
    assert.ok(ws, `feuille ${def.name}`);
    const headers = [];
    ws.getRow(1).eachCell((c) => headers.push(String(c.value)));
    for (const col of def.columns) assert.ok(headers.includes(col.required ? `${col.header} *` : col.header), `${def.name} / ${col.header}`);
  }
});

test('accès — réservé au DG ; fichier manquant ou illisible refusé proprement', async () => {
  assert.equal((await fetch(`${baseUrl}/api/import/template`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/import/template`, { headers: auth('comptable') })).status, 403);
  assert.equal((await send('preview', null)).status, 400);
  const garbage = await send('preview', Buffer.from('ceci n’est pas un classeur'));
  assert.equal(garbage.status, 400);
});

test('aperçu puis import — l’aperçu n’écrit rien ; la confirmation crée tout, avec les mêmes règles que les formulaires', async () => {
  const { data, phones } = validPortfolio();
  const file = await workbook(data);
  const before = await counts();

  const preview = await send('preview', file);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.errors, []);
  assert.equal(preview.body.ok, true);
  assert.deepEqual(preview.body.summary, { ownersCreated: 1, ownersReused: 1, properties: 2, units: 3, vacantUnits: 1, renters: 2 });
  assert.deepEqual(await counts(), before, 'l’aperçu ne doit rien écrire');

  const confirm = await send('confirm', file);
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.ok, true);
  const after = await counts();
  assert.deepEqual(after, {
    owners: before.owners + 1, properties: before.properties + 2, property_units: before.property_units + 3,
    renters: before.renters + 2, leases: before.leases + 2,
  });

  // Logements : deux écritures de la même référence de bien (casse/accents) = un seul bien.
  const [units] = await pool.query(
    `SELECT u.code, u.status, u.monthly_rent, u.furnished, u.designation_custom, p.address, p.owner_id
     FROM property_units u JOIN properties p ON p.id = u.property_id
     WHERE u.tenant_id = :t AND u.id != :existing ORDER BY u.id`,
    { t: fx.tenantId, existing: fx.unitId },
  );
  assert.deepEqual(units.map((u) => u.status), ['loue', 'libre', 'loue']);
  assert.equal(units[0].code.replace(/-U\d+$/, ''), units[1].code.replace(/-U\d+$/, ''), 'A1 et A2 dans le même bien');
  assert.equal(Number(units[1].monthly_rent), 30000, '« 30 000 » lu comme 30000');
  assert.equal(units[0].address, 'Immeuble Fidjrossè', 'sans adresse, la référence du bien sert d’adresse');
  assert.equal(units[2].owner_id, fx.ownerId, 'bien rattaché au propriétaire déjà existant');
  assert.equal(units[2].furnished, 1);
  assert.equal(units[2].designation_custom, 'Villa 4 pièces');
  const [[{ histories }]] = await pool.query('SELECT COUNT(*) AS histories FROM property_owner_history WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(Number(histories), 3, 'chaque bien importé ouvre sa période propriétaire (comptabilité)');

  // Locataire A : caution non remboursable, 2 mois de loyer impayés + SBEE.
  const [[a]] = await pool.query(
    `SELECT l.*, r.portal_token_hash FROM leases l JOIN renters r ON r.id = l.renter_id WHERE r.tenant_id = :t AND r.phone = :p`,
    { t: fx.tenantId, p: phones.renterA },
  );
  assert.equal(new Date(a.start_date).toISOString().slice(0, 10), '2024-03-15');
  assert.equal(Number(a.monthly_rent), 45000);
  assert.equal(Number(a.deposit_amount), 90000);
  assert.equal(a.deposit_refundable, 0);
  assert.equal(a.deposit_received_method, 'especes');
  assert.equal(Number(a.opening_debt_amount), 45000 * 2 + 12500);
  assert.equal(a.up_to_date_at_onboarding, 0);
  assert.equal(Number(a.entry_fee_amount), 0, 'ancien locataire : jamais de frais d’agence');
  assert.equal(Number(a.entry_prorata_amount), 0, 'ancien locataire : jamais de prorata');
  assert.ok(a.portal_token_hash, 'lien du portail locataire créé');
  const [items] = await pool.query('SELECT debt_type, amount FROM lease_opening_debt_items WHERE lease_id = :id ORDER BY id', { id: a.id });
  assert.deepEqual(items.map((i) => [i.debt_type, Number(i.amount)]), [['loyer', 45000], ['loyer', 45000], ['sbee', 12500]]);

  // Locataire B : date en cellule Excel, loyer et échéance propres au bail, mois en cours payé.
  const [[b]] = await pool.query('SELECT l.* FROM leases l JOIN renters r ON r.id = l.renter_id WHERE r.tenant_id = :t AND r.phone = :p', { t: fx.tenantId, p: phones.renterB });
  assert.equal(new Date(b.start_date).toISOString().slice(0, 10), '2023-01-10');
  assert.equal(Number(b.monthly_rent), 110000);
  assert.equal(b.rent_due_day, 10);
  assert.equal(b.up_to_date_at_onboarding, 1);
  assert.equal(Number(b.opening_debt_amount), 0);

  // Renvoyer le même fichier : tout existe déjà → refusé, rien créé en double.
  const again = await send('confirm', file);
  assert.equal(again.status, 422);
  assert.equal(again.body.ok, false);
  assert.deepEqual(await counts(), after);
});

test('téléphone saisi comme nombre dans Excel (zéro initial perdu) — restitué', async () => {
  const owner = phone('01');
  const file = await workbook({ owners: [{ Nom: 'Zéro Perdu', Téléphone: Number(owner) }] });
  const res = await send('confirm', file);
  assert.equal(res.body.ok, true, JSON.stringify(res.body.errors));
  const [[row]] = await pool.query('SELECT phone FROM owners WHERE tenant_id = :t AND name = :n', { t: fx.tenantId, n: 'Zéro Perdu' });
  assert.equal(row.phone, owner);
});

test('erreurs — chacune citée avec sa feuille, sa ligne et sa colonne ; rien n’est créé (tout ou rien)', async () => {
  const { data } = validPortfolio();
  const dup = phone('01');
  data.owners.push({ Nom: 'X', Téléphone: '12345' }); // ligne 4 : nom trop court + téléphone invalide
  data.units.push({ 'Téléphone du propriétaire': phone('01'), 'Référence du bien': 'Bien Orphelin', 'Type de bien': 'Villa', 'Référence du logement': 'B1', Désignation: 'Studio', 'Loyer mensuel': 20000 }); // ligne 5 : propriétaire inconnu
  data.units.push({ 'Téléphone du propriétaire': data.owners[0].Téléphone, 'Référence du bien': 'Immeuble Fidjrossè', 'Type de bien': 'Château', 'Référence du logement': 'A3', Désignation: 'Studio', 'Loyer mensuel': 'beaucoup' }); // ligne 6 : type + montant
  data.renters[0].Téléphone = dup;
  data.renters[1].Téléphone = dup; // ligne 3 : doublon dans le fichier
  data.renters.push({ Nom: 'FUTUR', Prénom: 'Jean', Téléphone: phone('01'), 'Référence du bien': 'Immeuble Fidjrossè', 'Référence du logement': 'A2', "Date d'entrée": '01/01/2999' }); // ligne 4
  data.renters.push({ Nom: 'PERDU', Prénom: 'Luc', Téléphone: phone('01'), 'Référence du bien': 'Immeuble Fidjrossè', 'Référence du logement': 'Z9', "Date d'entrée": '31/02/2024' }); // ligne 5 : date impossible
  data.renters.push({ Nom: 'CONTRA', Prénom: 'Eve', Téléphone: phone('01'), 'Référence du bien': 'Immeuble Fidjrossè', 'Référence du logement': 'A2', "Date d'entrée": '01/01/2024', 'Loyer du mois en cours déjà payé': 'Oui', 'Mois de loyer impayés': monthsAgo(1) }); // ligne 6 : contradiction
  const file = await workbook(data);
  const before = await counts();

  const preview = await send('preview', file);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, false);
  const has = (sheet, row, column) => preview.body.errors.some((e) => e.sheet === sheet && e.row === row && e.column === column);
  assert.ok(has('Propriétaires', 4, 'Nom'), 'nom trop court');
  assert.ok(has('Propriétaires', 4, 'Téléphone'), 'téléphone invalide');
  assert.ok(has('Logements', 5, 'Téléphone du propriétaire'), 'propriétaire inconnu');
  assert.ok(has('Logements', 6, 'Type de bien'), 'type de bien inconnu');
  assert.ok(has('Logements', 6, 'Loyer mensuel'), 'montant illisible');
  assert.ok(has('Locataires', 3, 'Téléphone'), 'doublon de téléphone');
  assert.ok(has('Locataires', 4, "Date d'entrée"), 'date future');
  assert.ok(has('Locataires', 5, "Date d'entrée"), 'date impossible');
  assert.ok(has('Locataires', 6, 'Loyer du mois en cours déjà payé'), 'à jour ET loyer impayé : contradiction');
  assert.ok(preview.body.errors.every((e) => e.message), 'chaque erreur porte un message');

  const confirm = await send('confirm', file);
  assert.equal(confirm.status, 422);
  assert.deepEqual(await counts(), before, 'une seule erreur = rien n’est créé');
});

test('refus de la base pendant l’écriture (mois en cours clôturé) — vu dès l’aperçu, et rien n’est créé', async () => {
  const { data } = validPortfolio();
  const file = await workbook(data);
  const today = new Date().toISOString().slice(0, 7);
  const [y, m] = today.split('-').map(Number);
  await pool.query(
    'INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, :period, :s, :e, :by)',
    { t: fx.tenantId, period: today, s: `${today}-01`, e: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), by: fx.dgId },
  );
  try {
    const before = await counts();
    const preview = await send('preview', file);
    assert.equal(preview.body.ok, false, 'la caution reçue tomberait dans un mois clôturé');
    assert.equal(preview.body.errors[0].sheet, 'Locataires');
    assert.equal(preview.body.errors[0].row, 2);
    const confirm = await send('confirm', file);
    assert.equal(confirm.status, 422);
    assert.deepEqual(await counts(), before, 'propriétaires et logements déjà écrits dans la transaction sont annulés aussi');
  } finally {
    await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
  }
});

test('fichier sans aucune ligne — signalé, pas un import vide « réussi »', async () => {
  const res = await send('preview', await workbook({}));
  assert.equal(res.body.ok, false);
  assert.match(res.body.errors[0].message, /aucune ligne/);
});
