'use strict';
/**
 * Tests unitaires du calcul de recette / commission (services/commission.js).
 * Appelle directement les fonctions du service (pas de passage par l'API) :
 * ce sont les tests unitaires demandés pour le calcul, séparés des tests
 * bout-en-bout de l'API (`pentest.js`, `test-releve.js`).
 *
 * Cabinet JETABLE uniquement (préfixe COMMISSION-TEST-<horodatage>), les
 * données de test sont créées et supprimées par ce script — jamais de
 * données réelles touchées.
 *
 *   cd backend && node scripts/test-commission.js
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const envPath = path.resolve(__dirname, '../.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const DB = {
  host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'lyko_system',
};

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  \x1b[32mOK\x1b[0m   ${n}`); };
const ko = (n, d) => { fail++; console.log(`  \x1b[31mKO\x1b[0m   ${n}${d ? ` — ${d}` : ''}`); };
const eq = (n, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? ok(`${n} = ${JSON.stringify(got)}`) : ko(n, `attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`));

const STAMP = Date.now();
const TAG = `COMMISSION-TEST-${STAMP}`;

async function main() {
  const conn = await mysql.createConnection(DB);

  // Le service lit via `../config/db` (un pool distinct de cette connexion
  // de préparation) : le module resitue son propre pool sur le même MySQL,
  // donc les deux voient les mêmes données une fois committées.
  const commission = require('../src/services/commission');

  let tenantId, userId, ownerId, propertyId, unit1Id, unit2Id, renter1Id, renter2Id, lease1Id, lease2Id;

  try {
    console.log(`\n=== Préparation (cabinet jetable ${TAG}) ===`);

    const [tRes] = await conn.query(
      `INSERT INTO tenants (company_name, rccm, ifu, contact_phone) VALUES (?, 'RB/COT/26 T 0001', '1234567890123', '0100000001')`,
      [TAG],
    );
    tenantId = tRes.insertId;

    const [uRes] = await conn.query(
      `INSERT INTO users (tenant_id, first_name, last_name, phone, password_hash, role)
       VALUES (?, 'Test', 'DG', ?, 'x', 'dg')`,
      [tenantId, `01${String(STAMP).slice(-8)}`],
    );
    userId = uRes.insertId;

    const [oRes] = await conn.query(
      `INSERT INTO owners (tenant_id, name, created_by) VALUES (?, 'Propriétaire Test', ?)`,
      [tenantId, userId],
    );
    ownerId = oRes.insertId;

    const [pRes] = await conn.query(
      `INSERT INTO properties (tenant_id, code, owner_id, property_type, created_by)
       VALUES (?, 'BIEN-T01', ?, 'autre', ?)`,
      [tenantId, ownerId, userId],
    );
    propertyId = pRes.insertId;

    const [u1Res] = await conn.query(
      `INSERT INTO property_units (tenant_id, property_id, code, designation, monthly_rent, created_by)
       VALUES (?, ?, 'BIEN-T01-U01', 'studio', 40000, ?)`,
      [tenantId, propertyId, userId],
    );
    unit1Id = u1Res.insertId;
    const [u2Res] = await conn.query(
      `INSERT INTO property_units (tenant_id, property_id, code, designation, monthly_rent, created_by)
       VALUES (?, ?, 'BIEN-T01-U02', 'studio', 60000, ?)`,
      [tenantId, propertyId, userId],
    );
    unit2Id = u2Res.insertId;

    const [r1Res] = await conn.query(
      `INSERT INTO renters (tenant_id, first_name, last_name, phone) VALUES (?, 'Loc', 'Un', ?)`,
      [tenantId, `02${String(STAMP).slice(-8)}`],
    );
    renter1Id = r1Res.insertId;
    const [r2Res] = await conn.query(
      `INSERT INTO renters (tenant_id, first_name, last_name, phone) VALUES (?, 'Loc', 'Deux', ?)`,
      [tenantId, `03${String(STAMP).slice(-8)}`],
    );
    renter2Id = r2Res.insertId;

    const [l1Res] = await conn.query(
      `INSERT INTO leases (tenant_id, unit_id, renter_id, monthly_rent, start_date) VALUES (?, ?, ?, 40000, '2026-01-01')`,
      [tenantId, unit1Id, renter1Id],
    );
    lease1Id = l1Res.insertId;
    const [l2Res] = await conn.query(
      `INSERT INTO leases (tenant_id, unit_id, renter_id, monthly_rent, start_date) VALUES (?, ?, ?, 60000, '2026-01-01')`,
      [tenantId, unit2Id, renter2Id],
    );
    lease2Id = l2Res.insertId;

    console.log(`  tenant ${tenantId}, bien ${propertyId} (2 unités), baux ${lease1Id}/${lease2Id}`);

    // ── Cas 1 : plusieurs unités — la recette additionne les paiements des
    //    DEUX unités du Bien, pour le mois demandé uniquement.
    console.log('\n=== Cas 1 — plusieurs unités ===');
    await conn.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, paid_at, amount, recorded_by) VALUES
         (?, ?, '2026-03', '2026-03-05', 40000, ?),
         (?, ?, '2026-03', '2026-03-05', 60000, ?),
         (?, ?, '2026-04', '2026-04-05', 40000, ?)`,
      [tenantId, lease1Id, userId, tenantId, lease2Id, userId, tenantId, lease1Id, userId],
    );
    let recette = await commission.getRecetteNetteMaison(tenantId, propertyId, '2026-03');
    eq('mars : total paiements (40000 unité 1 + 60000 unité 2)', recette.totalPayments, 100000);
    eq('mars : recette nette sans dépense', recette.recetteNette, 100000);
    recette = await commission.getRecetteNetteMaison(tenantId, propertyId, '2026-04');
    eq('avril : seule l’unité 1 a payé ce mois-là', recette.totalPayments, 40000);

    // ── Cas 2 : dépenses au niveau Bien vs Unité — les deux doivent réduire
    //    la recette nette du Bien, sans double comptage.
    console.log('\n=== Cas 2 — dépenses niveau Bien + niveau Unité ===');
    await conn.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, property_id, unit_id, recorded_by) VALUES
         (?, 'entretien', 'Peinture façade (bien entier)', 12000, '2026-03-10', ?, NULL, ?),
         (?, 'entretien', 'Robinetterie unité 2', 8000, '2026-03-15', ?, ?, ?)`,
      [tenantId, propertyId, userId, tenantId, propertyId, unit2Id, userId],
    );
    recette = await commission.getRecetteNetteMaison(tenantId, propertyId, '2026-03');
    eq('mars : total dépenses (12000 bien + 8000 unité)', recette.totalExpenses, 20000);
    eq('mars : recette nette = 100000 − 20000', recette.recetteNette, 80000);

    // Isolation : une dépense d'un AUTRE bien ne doit pas être comptée.
    const [otherPropRes] = await conn.query(
      `INSERT INTO properties (tenant_id, code, owner_id, property_type, created_by) VALUES (?, 'BIEN-T02', ?, 'autre', ?)`,
      [tenantId, ownerId, userId],
    );
    await conn.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, property_id, recorded_by)
       VALUES (?, 'entretien', 'Dépense autre bien', 99999, '2026-03-20', ?, ?)`,
      [tenantId, otherPropRes.insertId, userId],
    );
    recette = await commission.getRecetteNetteMaison(tenantId, propertyId, '2026-03');
    eq('mars : dépense d’un autre Bien non comptée (toujours 20000)', recette.totalExpenses, 20000);

    // Dépense cabinet (property_id NULL, comme avant cette fonctionnalité) : jamais comptée sur un Bien.
    await conn.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, recorded_by)
       VALUES (?, 'fournitures', 'Fourniture bureau (cabinet)', 5000, '2026-03-20', ?)`,
      [tenantId, userId],
    );
    recette = await commission.getRecetteNetteMaison(tenantId, propertyId, '2026-03');
    eq('mars : dépense cabinet (property_id NULL) non comptée', recette.totalExpenses, 20000);

    // ── Cas 3 : aucun taux défini — commission à 0 %, jamais d'erreur.
    console.log('\n=== Cas 3 — aucun taux défini ===');
    let rec = await commission.getRecetteProprietaire(tenantId, propertyId, '2026-03');
    eq('mars : rateDefined = false', rec.rateDefined, false);
    eq('mars : taux 0 % par défaut', rec.rate, 0);
    eq('mars : commission 0, part propriétaire = recette nette', [rec.commissionCabinet, rec.partProprietaire], [0, 80000]);

    // ── Cas 4 : changement de taux EN COURS DE MOIS (au sens : entre deux
    //    mois consécutifs) — chaque mois doit utiliser le taux qui était
    //    réellement actif à l'époque, jamais le dernier taux en date.
    console.log('\n=== Cas 4 — changement de taux entre deux mois ===');
    await conn.query(
      `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
       VALUES (?, ?, 10, '2026-01-01', '2026-03-31', ?)`,
      [tenantId, ownerId, userId],
    );
    await conn.query(
      `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
       VALUES (?, ?, 20, '2026-04-01', NULL, ?)`,
      [tenantId, ownerId, userId],
    );
    rec = await commission.getRecetteProprietaire(tenantId, propertyId, '2026-03');
    eq('mars (avant le changement) : taux 10 %', rec.rate, 10);
    eq('mars : commission = 80000 × 10 % = 8000', rec.commissionCabinet, 8000);
    eq('mars : part propriétaire = 80000 − 8000 = 72000', rec.partProprietaire, 72000);

    rec = await commission.getRecetteProprietaire(tenantId, propertyId, '2026-04');
    eq('avril (après le changement) : taux 20 %', rec.rate, 20);
    eq('avril : recette nette = 40000 (seul paiement d’avril, aucune dépense)', rec.recetteNette, 40000);
    eq('avril : commission = 40000 × 20 % = 8000', rec.commissionCabinet, 8000);
    eq('avril : part propriétaire = 40000 − 8000 = 32000', rec.partProprietaire, 32000);

    // getTauxCommissionActif / getActiveCommissionRate directement, à une
    // date précise à cheval sur le changement (dernier jour de mars).
    let rate = await commission.getTauxCommissionActif(tenantId, ownerId, '2026-03');
    eq('getTauxCommissionActif(mars) = 10', rate.rate, 10);
    rate = await commission.getActiveCommissionRate(tenantId, ownerId, '2026-03-31');
    eq('getActiveCommissionRate(2026-03-31) = 10 (dernier jour de l’ancien taux)', rate.rate, 10);
    rate = await commission.getActiveCommissionRate(tenantId, ownerId, '2026-04-01');
    eq('getActiveCommissionRate(2026-04-01) = 20 (premier jour du nouveau taux)', rate.rate, 20);

    // Mois sans aucun paiement ni dépense : recette nette 0, jamais d'erreur.
    rec = await commission.getRecetteProprietaire(tenantId, propertyId, '2026-12');
    eq('décembre (aucune activité) : recette nette 0', rec.recetteNette, 0);
    eq('décembre : commission 0', rec.commissionCabinet, 0);
  } finally {
    console.log('\n=== Nettoyage ===');
    if (tenantId) {
      await conn.query('DELETE FROM tenants WHERE id = ?', [tenantId]);
      console.log(`  tenant jetable ${tenantId} supprimé (cascade)`);
    }
    await conn.end();
  }

  console.log(`\n${pass} OK / ${fail} KO`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Erreur script:', err);
  process.exit(1);
});
