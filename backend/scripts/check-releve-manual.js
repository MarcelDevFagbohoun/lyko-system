'use strict';
/**
 * Test bout-en-bout du relevé de compteurs par immeuble (étape 9bis).
 * Cabinets JETABLES uniquement (préfixe RELEVE-), supprimés à la fin.
 *   cd backend && node scripts/check-releve-manual.js
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const API = process.env.API || 'http://localhost:4000';
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const DB = { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT) || 3306, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME };

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  \x1b[32mOK\x1b[0m   ${n}`); };
const ko = (n, d) => { fail++; console.log(`  \x1b[31mKO\x1b[0m   ${n}${d ? ` — ${d}` : ''}`); };
const eq = (n, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? ok(`${n} = ${JSON.stringify(got)}`) : ko(n, `attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`));

const STAMP = Date.now();
const PREFIX = `RELEVE-${STAMP}`;
let seq = 0;
async function api(method, p, { token, body } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, json: j, text: t };
}
function phone() { seq++; return '0' + String(66000000 + (STAMP % 20000000) + seq * 97).slice(0, 9).padStart(9, '0'); }
async function register(tag) {
  seq++;
  const c = 'ABCDEFGHJKLMNPQ'[seq % 15];
  const r = await api('POST', '/api/auth/register', { body: {
    firstName: 'Dir', lastName: `Cab${tag}`, companyName: `${PREFIX} ${tag}`,
    rccm: `RB/COT/24 ${c} ${1000 + seq}`, ifu: String(2000000000000 + seq).slice(0, 13),
    phone: phone(), password: 'Releve#2024xy', confirmPassword: 'Releve#2024xy',
  } });
  if (r.status !== 201) throw new Error(`register ${tag} → ${r.status} ${r.text}`);
  return { tag, token: r.json.accessToken, tenantId: r.json.tenant.id };
}

(async () => {
  const health = await api('GET', '/api/health');
  if (health.status !== 200) { console.error('API injoignable'); process.exit(1); }
  console.log(`Cible ${API} · préfixe ${PREFIX}\n`);

  const A = await register('A');
  const B = await register('B');
  const H = { token: A.token };

  // Bien + 3 unités : U01 & U02 avec compteur SONEB, U03 sans.
  const owner = await api('POST', '/api/owners', { ...H, body: { name: `Proprio ${A.tag}`, phone: phone() } });
  const prop = await api('POST', '/api/properties', { ...H, body: { ownerId: owner.json.ownerId, propertyType: 'immeuble', address: 'Rue test', levels: 1 } });
  const propId = prop.json.propertyId;
  const u1 = await api('POST', `/api/properties/${propId}/units`, { ...H, body: { designation: 'studio', monthlyRent: 40000, sonebMeterNumber: 'CPT-U01' } });
  const u2 = await api('POST', `/api/properties/${propId}/units`, { ...H, body: { designation: 'studio', monthlyRent: 40000, sonebMeterNumber: 'CPT-U02' } });
  const u3 = await api('POST', `/api/properties/${propId}/units`, { ...H, body: { designation: 'chambre_salon', monthlyRent: 30000 } });
  const [U1, U2, U3] = [u1.json.unitId, u2.json.unitId, u3.json.unitId];
  eq('3 unités créées', [u1.status, u2.status, u3.status], [201, 201, 201]);

  // Locataire sur U01 uniquement ; U02 reste vacante mais sous-comptée.
  const renter = await api('POST', '/api/renters', { ...H, body: {
    firstName: 'Loc', lastName: 'Un', phone: phone(), unitId: U1, monthlyRent: 40000, depositAmount: 0, rentDueDay: 5, startDate: '2026-01-05',
  } });
  eq('locataire U01', renter.status, 201);

  // 1) Config sous-comptage SONEB.
  const cfg = await api('PATCH', `/api/properties/${propId}/utility-config`, { ...H, body: {
    sonebSubmetered: true, sonebUnitPrice: 225, sonebMainMeterNumber: 'PRINCIPAL-1', sonebAccountNumber: 'ABN-42',
  } });
  eq('config SONEB → 200', cfg.status, 200);
  eq('config: submetered', cfg.json?.utilityConfig?.soneb?.submetered, true);
  eq('config: prix', cfg.json?.utilityConfig?.soneb?.unitPrice, 225);

  // activer sans prix → 400
  const cfgBad = await api('PATCH', `/api/properties/${propId}/utility-config`, { ...H, body: { sbeeSubmetered: true } });
  eq('activer SBEE sans prix → 400', cfgBad.status, 400);

  // 2) Créer le relevé.
  const created = await api('POST', `/api/properties/${propId}/utility-batches`, { ...H, body: { utilityType: 'soneb', periodStart: '2026-01-01', periodEnd: '2026-01-31' } });
  if (created.status !== 200) { ko('relevé créé → 200', `${created.status} ${created.text}`); throw new Error('stop'); }
  ok('relevé créé → 200');
  const batchId = created.json.batch.id;
  eq('2 lignes (U01 + U02, pas U03)', created.json.rows.length, 2);
  eq('unité price figé', created.json.batch.unitPrice, 225);
  eq('index précédent = 0', created.json.rows.every((r) => r.readingStart === 0 && r.consumption === 0), true);
  eq('U01 a un bail actif', !!created.json.rows.find((r) => r.unitId === U1).lease, true);
  eq('U02 vacante', created.json.rows.find((r) => r.unitId === U2).lease, null);

  // doublon même période → 409
  const dup = await api('POST', `/api/properties/${propId}/utility-batches`, { ...H, body: { utilityType: 'soneb', periodStart: '2026-01-01', periodEnd: '2026-01-31' } });
  eq('doublon période → 409', dup.status, 409);

  // valider sans compteur principal renseigné → 400
  const noMain = await api('POST', `/api/utility-batches/${batchId}/validate`, { ...H });
  eq('validation sans compteur principal → 400', noMain.status, 400);

  // relevé SBEE sur un bien sans compteur SBEE sur les unités → 400
  await api('PATCH', `/api/properties/${propId}/utility-config`, { ...H, body: { sbeeSubmetered: true, sbeeUnitPrice: 110 } });
  const noMeter = await api('POST', `/api/properties/${propId}/utility-batches`, { ...H, body: { utilityType: 'sbee', periodStart: '2026-01-01', periodEnd: '2026-01-31' } });
  eq('relevé sans aucun compteur d\'unité → 400', noMeter.status, 400);

  // 3) Saisir la grille : U01 305→349 (conso 44 → 9900), U02 100→111 (conso 11 → 2475), compteur principal 28330→29400 (1070), facture 240750.
  const saved = await api('PATCH', `/api/utility-batches/${batchId}`, { ...H, body: {
    mainReadingStart: 28330, mainReadingEnd: 29400, mainInvoiceAmount: 240750,
    readings: [
      { unitId: U1, readingStart: 305, readingEnd: 349 },
      { unitId: U2, readingStart: 100, readingEnd: 111 },
    ],
  } });
  eq('grille enregistrée → 200', saved.status, 200);
  const r1 = saved.json.rows.find((r) => r.unitId === U1);
  eq('U01 conso 44 · montant 9900', [r1.consumption, r1.amount], [44, 9900]);
  eq('U02 montant 2475', saved.json.rows.find((r) => r.unitId === U2).amount, 2475);
  eq('Total décompteur conso', saved.json.totals.subConsumption, 55);
  eq('Total décompteur montant', saved.json.totals.subAmount, 12375);
  eq('Compteur principal conso', saved.json.totals.mainConsumption, 1070);
  eq('Différence conso', saved.json.totals.differenceConsumption, 1015);
  eq('Différence montant', saved.json.totals.differenceAmount, 228375);
  eq('alerte = high (diff > 15%)', saved.json.totals.alert, 'high');

  // Incohérence : décompteurs > principal → alerte negative
  const inc = await api('PATCH', `/api/utility-batches/${batchId}`, { ...H, body: { mainReadingStart: 0, mainReadingEnd: 40, mainInvoiceAmount: 9000 } });
  eq('alerte = negative', inc.json.totals.alert, 'negative');
  // remettre des valeurs cohérentes
  await api('PATCH', `/api/utility-batches/${batchId}`, { ...H, body: { mainReadingStart: 28330, mainReadingEnd: 29400, mainInvoiceAmount: 240750 } });

  // 4) Valider → 1 facture générée (U01 occupée, montant > 0), U02 non.
  const validated = await api('POST', `/api/utility-batches/${batchId}/validate`, { ...H });
  eq('validation → 200', validated.status, 200);
  eq('statut = valide', validated.json.batch.status, 'valide');
  const vr1 = validated.json.rows.find((r) => r.unitId === U1);
  eq('U01 : facture liée', !!vr1.charge, true);
  eq('U02 : pas de facture', validated.json.rows.find((r) => r.unitId === U2).charge, null);

  // la facture apparaît dans le registre des charges
  const list = await api('GET', '/api/charges', { ...H });
  const gen = list.json.charges.find((c) => c.id === vr1.charge.id);
  eq('facture au registre : impayée, 9900', [gen?.status, gen?.amount], ['impayee', 9900]);

  // re-valider → 409
  const reval = await api('POST', `/api/utility-batches/${batchId}/validate`, { ...H });
  eq('re-validation → 409', reval.status, 409);
  // modifier un relevé validé → 409
  const editLocked = await api('PATCH', `/api/utility-batches/${batchId}`, { ...H, body: { readings: [{ unitId: U1, readingStart: 305, readingEnd: 400 }] } });
  eq('modif relevé validé → 409', editLocked.status, 409);

  // 5) Rouvrir → facture non payée supprimée, retour brouillon.
  const reopened = await api('POST', `/api/utility-batches/${batchId}/reopen`, { ...H });
  eq('réouverture → 200', reopened.status, 200);
  eq('statut = brouillon', reopened.json.batch.status, 'brouillon');
  const listAfter = await api('GET', '/api/charges', { ...H });
  eq('facture supprimée du registre', listAfter.json.charges.find((c) => c.id === vr1.charge.id), undefined);

  // 6) Re-valider, PAYER la facture, puis rouvrir → 409.
  await api('POST', `/api/utility-batches/${batchId}/validate`, { ...H });
  const list2 = await api('GET', '/api/charges', { ...H });
  const chId = list2.json.charges.find((c) => c.status === 'impayee' && c.amount === 9900).id;
  const paid = await api('PATCH', `/api/charges/${chId}/pay`, { ...H, body: { paymentMethod: 'especes', paidAt: '2026-02-05' } });
  eq('paiement facture → 200', paid.status, 200);
  const reopenBlocked = await api('POST', `/api/utility-batches/${batchId}/reopen`, { ...H });
  eq('réouverture bloquée (facture payée) → 409', reopenBlocked.status, 409);

  // 7) Isolation multi-tenant.
  const iso1 = await api('GET', `/api/utility-batches/${batchId}`, { token: B.token });
  eq('B lit le relevé de A → 404', iso1.status, 404);
  const iso2 = await api('PATCH', `/api/properties/${propId}/utility-config`, { token: B.token, body: { sonebSubmetered: false } });
  eq('B modifie la config de A → 404', iso2.status, 404);
  const iso3 = await api('POST', `/api/properties/${propId}/utility-batches`, { token: B.token, body: { utilityType: 'soneb', periodStart: '2026-03-01', periodEnd: '2026-03-31' } });
  eq('B crée un relevé sur le bien de A → 404', iso3.status, 404);

  // Nettoyage.
  const conn = await mysql.createConnection(DB);
  const [del] = await conn.query("DELETE FROM tenants WHERE company_name LIKE 'RELEVE-%'");
  console.log(`\nNettoyage : ${del.affectedRows} cabinet(s) jetable(s) supprimé(s)`);
  await conn.end();

  console.log(`\n${'='.repeat(40)}\n\x1b[1m${pass} OK · ${fail} KO\x1b[0m`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('\n\x1b[31mERREUR\x1b[0m', e);
  try { const c = await mysql.createConnection(DB); await c.query("DELETE FROM tenants WHERE company_name LIKE 'RELEVE-%'"); await c.end(); console.log('nettoyage de secours effectué'); } catch { /* */ }
  process.exit(2);
});
