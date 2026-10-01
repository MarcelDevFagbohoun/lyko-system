'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { isModuleActive, genererEcriture } = require('../../src/services/gl/glPostingService');
const {
  isInitialized,
  ensureFiscalYearsCoverRange,
  activateModule,
  deactivateModule,
  backfillHistoricalEntries,
} = require('../../src/services/gl/glActivationService');
const { createBareFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();

  // Opérations historiques enregistrées AVANT toute activation (comme un
  // vrai tenant qui n'a jamais utilisé la comptabilité avancée) — insérées
  // directement, sans passer par genererEcriture, pour simuler fidèlement
  // ce que produit le suivi simple seul.
  const [rp1] = await pool.query(
    "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-01', 50000, 'especes', '2026-01-05', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const [rp2] = await pool.query(
    "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-02', 50000, 'especes', '2026-02-05', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, recorded_by) VALUES (:t, 'fournitures', 'Papeterie', 12000, '2026-01-10', 'especes', :by)",
    { t: fx.tenantId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by) VALUES (:t, :o, 30000, 'Janvier 2026', '2026-01-20', 'especes', :by)",
    { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
  );
  const [uc] = await pool.query(
    "INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by) VALUES (:t, :l, 'soneb', '2026-01-01', '2026-01-31', 100, 116, 500, 8000, '2026-01-15', 'payee', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  await pool.query(
    "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, 8000, 'especes', '2026-01-16', :by)",
    { t: fx.tenantId, c: uc.insertId, by: fx.dgId },
  );

  fx.rentPaymentId1 = rp1.insertId;
  fx.rentPaymentId2 = rp2.insertId;
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test('avant activation : ni initialisé ni actif', async () => {
  assert.equal(await isInitialized(pool, fx.tenantId), false);
  assert.equal(await isModuleActive(pool, fx.tenantId), false);
});

test('activateModule — initialise, couvre les exercices, rattrape tout l\'historique', async () => {
  const result = await activateModule(pool, fx.tenantId, { userId: fx.dgId, ipAddress: '127.0.0.1' });

  assert.equal(result.wasAlreadyInitialized, false);
  assert.equal(result.fromDate, '2026-01-05', 'plancher = plus ancienne opération réelle (pas de accounting_start_date défini)');
  assert.equal(result.fiscalYearsCreated.length, 1);
  assert.equal(result.fiscalYearsCreated[0].label, '2026');
  assert.equal(result.entriesGenerated, 5, '2 loyers + 1 dépense + 1 versement + 1 charge SONEB');
  assert.equal(result.entriesSkipped, 0);
  assert.deepEqual(result.errors, []);

  assert.equal(await isInitialized(pool, fx.tenantId), true);
  assert.equal(await isModuleActive(pool, fx.tenantId), true);

  const [[entry]] = await pool.query(
    "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
    { t: fx.tenantId, id: fx.rentPaymentId1 },
  );
  assert.ok(entry, 'le loyer historique a bien une écriture GL');
});

test('activateModule rejoué — idempotent, aucun doublon', async () => {
  const result = await activateModule(pool, fx.tenantId, { userId: fx.dgId, ipAddress: '127.0.0.1' });
  assert.equal(result.wasAlreadyInitialized, true, 'ne re-seed jamais un tenant déjà initialisé');
  assert.equal(result.entriesGenerated, 0);
  assert.equal(result.entriesSkipped, 5, 'les 5 opérations ont déjà leur écriture');
});

test('deactivateModule — coupe la génération future sans rien supprimer', async () => {
  const [[beforeCount]] = await pool.query('SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });

  await deactivateModule(pool, fx.tenantId, { userId: fx.dgId, ipAddress: '127.0.0.1' });
  assert.equal(await isModuleActive(pool, fx.tenantId), false);
  assert.equal(await isInitialized(pool, fx.tenantId), true, 'le plan comptable reste consultable');

  const [[afterCount]] = await pool.query('SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t', { t: fx.tenantId });
  assert.equal(afterCount.n, beforeCount.n, 'aucune écriture supprimée par la suspension');
});

test('réactivation après suspension — rattrape uniquement le manqué pendant la pause', async () => {
  // Simule un paiement enregistré PENDANT la suspension (comme le ferait
  // vraiment leases.js : isModuleActive=false -> aucune écriture générée).
  const [rp3] = await pool.query(
    "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-03', 50000, 'especes', '2026-03-05', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );

  const result = await activateModule(pool, fx.tenantId, { userId: fx.dgId, ipAddress: '127.0.0.1' });
  assert.equal(result.entriesGenerated, 1, 'seule la nouvelle opération manque une écriture');
  assert.equal(result.entriesSkipped, 5);
  assert.equal(await isModuleActive(pool, fx.tenantId), true);

  const [[entry]] = await pool.query(
    "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
    { t: fx.tenantId, id: rp3.insertId },
  );
  assert.ok(entry);
});

test('ensureFiscalYearsCoverRange — couvre plusieurs années, ne duplique jamais un exercice existant', async () => {
  const fx2 = await createBareFixture();
  try {
    const created1 = await ensureFiscalYearsCoverRange(pool, fx2.tenantId, '2024-06-01', '2026-03-01');
    assert.deepEqual(
      created1.map((f) => f.label).sort(),
      ['2024', '2025', '2026'],
    );

    // Rejoué sur une plage chevauchante : aucune nouvelle création.
    const created2 = await ensureFiscalYearsCoverRange(pool, fx2.tenantId, '2025-01-01', '2025-12-31');
    assert.equal(created2.length, 0);

    const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM gl_fiscal_years WHERE tenant_id = :t', { t: fx2.tenantId });
    assert.equal(count.n, 3);
  } finally {
    await teardown(fx2.tenantId);
  }
});

test('rattrapage — applique le taux de commission EN VIGUEUR à la date du paiement, pas le taux actuel', async () => {
  const fx3 = await createBareFixture();
  try {
    // 8 % jusqu'au 1er février, puis 10 % ensuite.
    await pool.query(
      "INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by) VALUES (:t, :o, 8, '2026-01-01', '2026-02-01', :by)",
      { t: fx3.tenantId, o: fx3.ownerId, by: fx3.dgId },
    );
    await pool.query(
      "INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, set_by) VALUES (:t, :o, 10, '2026-02-01', :by)",
      { t: fx3.tenantId, o: fx3.ownerId, by: fx3.dgId },
    );
    const [rpJan] = await pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-01', 100000, 'especes', '2026-01-10', :by)",
      { t: fx3.tenantId, l: fx3.leaseId, by: fx3.dgId },
    );
    const [rpMar] = await pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-03', 100000, 'especes', '2026-03-10', :by)",
      { t: fx3.tenantId, l: fx3.leaseId, by: fx3.dgId },
    );

    await activateModule(pool, fx3.tenantId, { userId: fx3.dgId, ipAddress: '127.0.0.1' });

    const [[janEntry]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
      { t: fx3.tenantId, id: rpJan.insertId },
    );
    const [janLines] = await pool.query(
      "SELECT side, amount FROM gl_entry_lines WHERE entry_id = :id AND side = 'credit' ORDER BY amount DESC",
      { id: janEntry.id },
    );
    // 8 % de 100000 = 8000 (produit), 92000 (tiers-propriétaire).
    assert.deepEqual(janLines.map((l) => Number(l.amount)), [92000, 8000]);

    const [[marEntry]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :id",
      { t: fx3.tenantId, id: rpMar.insertId },
    );
    const [marLines] = await pool.query(
      "SELECT side, amount FROM gl_entry_lines WHERE entry_id = :id AND side = 'credit' ORDER BY amount DESC",
      { id: marEntry.id },
    );
    // 10 % de 100000 = 10000 (produit), 90000 (tiers-propriétaire).
    assert.deepEqual(marLines.map((l) => Number(l.amount)), [90000, 10000]);
  } finally {
    await teardown(fx3.tenantId);
  }
});

test('rattrapage — une dépense à crédit déjà réglée avant activation rejoue les 2 écritures (engagement + règlement)', async () => {
  const fx4 = await createBareFixture();
  try {
    const [s] = await pool.query('INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
      t: fx4.tenantId,
      n: 'Plombier Test',
      by: fx4.dgId,
    });
    // Engagée le 5 janvier, réglée le 20 janvier — les deux AVANT toute activation.
    const [exp] = await pool.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, supplier_id, payment_status, payment_method, paid_at, recorded_by)
       VALUES (:t, 'entretien', 'Fuite réparée', 15000, '2026-01-05', :s, 'paid', 'virement', '2026-01-20', :by)`,
      { t: fx4.tenantId, s: s.insertId, by: fx4.dgId },
    );

    const result = await activateModule(pool, fx4.tenantId, { userId: fx4.dgId, ipAddress: '127.0.0.1' });
    assert.equal(result.entriesGenerated, 2, 'engagement + règlement, 2 écritures distinctes');

    const [[engagement]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'expenses' AND source_id = :id",
      { t: fx4.tenantId, id: exp.insertId },
    );
    const [[settlement]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'expense_settlements' AND source_id = :id",
      { t: fx4.tenantId, id: exp.insertId },
    );
    assert.ok(engagement, "l'engagement (à crédit) a bien une écriture");
    assert.ok(settlement, 'le règlement a bien sa PROPRE écriture, distincte');
    assert.notEqual(engagement.id, settlement.id);

    const [engagementLines] = await pool.query(
      'SELECT side, amount FROM gl_entry_lines WHERE entry_id = :id ORDER BY line_order',
      { id: engagement.id },
    );
    assert.deepEqual(
      engagementLines.map((l) => ({ side: l.side, amount: Number(l.amount) })),
      [
        { side: 'debit', amount: 15000 },
        { side: 'credit', amount: 15000 },
      ],
    );

    const [[balance401]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
       FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id JOIN gl_accounts a ON a.id = el.account_id
       WHERE e.tenant_id = :t AND a.code = '401'`,
      { t: fx4.tenantId },
    );
    assert.equal(Number(balance401.solde), 0, 'engagé puis réglé : le 401 de ce tenant tout neuf revient à zéro');
  } finally {
    await teardown(fx4.tenantId);
  }
});

test("Haute #6 (étape 51) — un règlement de dépense DÉJÀ posté en direct (module actif) n'est jamais dupliqué par le rattrapage après une suspension/réactivation", async () => {
  // Reproduit exactement le scénario du bug : une dépense à crédit engagée ET réglée PENDANT que le
  // module est actif (donc déjà comptabilisée en direct, comme le fait maintenant routes/accounting.js
  // POST /expenses/:id/pay avec `sourceTable: 'expense_settlements'`) — puis le module est suspendu et
  // réactivé. Avant le correctif, le rattrapage cherchait à tort 'expenses' pour le règlement (au lieu de
  // 'expense_settlements', jamais généré en direct) et en reposait un second, en double.
  const fx6 = await createBareFixture();
  try {
    const [s] = await pool.query('INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
      t: fx6.tenantId,
      n: 'Menuisier Test',
      by: fx6.dgId,
    });
    await activateModule(pool, fx6.tenantId, { userId: fx6.dgId, ipAddress: '127.0.0.1' });

    const [exp] = await pool.query(
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, supplier_id, payment_status, payment_method, paid_at, recorded_by)
       VALUES (:t, 'entretien', 'Porte réparée', 20000, '2026-06-01', :s, 'paid', 'virement', '2026-06-10', :by)`,
      { t: fx6.tenantId, s: s.insertId, by: fx6.dgId },
    );
    // Les deux écritures « en direct », exactement comme le ferait la route (engagement puis règlement).
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await genererEcriture(conn, {
        tenantId: fx6.tenantId,
        operationType: 'depense_entretien',
        entryDate: '2026-06-01',
        amount: 20000,
        narrationVars: { libelle: 'Porte réparée' },
        sourceTable: 'expenses',
        sourceId: exp.insertId,
        createdBy: fx6.dgId,
        context: { supplierId: s.insertId },
      });
      await genererEcriture(conn, {
        tenantId: fx6.tenantId,
        operationType: 'reglement_fournisseur',
        entryDate: '2026-06-10',
        amount: 20000,
        paymentMethod: 'virement',
        narrationVars: { fournisseur: 'Menuisier Test' },
        sourceTable: 'expense_settlements',
        sourceId: exp.insertId,
        createdBy: fx6.dgId,
        context: { supplierId: s.insertId },
      });
      await conn.commit();
    } finally {
      conn.release();
    }

    await deactivateModule(pool, fx6.tenantId, { userId: fx6.dgId, ipAddress: '127.0.0.1' });
    const result = await activateModule(pool, fx6.tenantId, { userId: fx6.dgId, ipAddress: '127.0.0.1' });
    assert.equal(result.entriesGenerated, 0, 'les deux écritures existent déjà (postées en direct) — rien à rattraper');

    const [settlementEntries] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'expense_settlements' AND source_id = :id",
      { t: fx6.tenantId, id: exp.insertId },
    );
    assert.equal(settlementEntries.length, 1, 'jamais de doublon du règlement après suspension/réactivation');
  } finally {
    await teardown(fx6.tenantId);
  }
});

test('rattrapage — immobilisation à crédit déjà réglée + amortissement déjà saisi, tous AVANT activation', async () => {
  const fx5 = await createBareFixture();
  try {
    const [s] = await pool.query('INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:t, :n, :by)', {
      t: fx5.tenantId,
      n: 'Informatique Pro',
      by: fx5.dgId,
    });
    // Acquise à crédit le 5 janvier, réglée le 20 janvier, un mois
    // d'amortissement déjà saisi en février — les 3 AVANT toute activation.
    const [asset] = await pool.query(
      `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, supplier_id, payment_status, payment_method, paid_at, created_by)
       VALUES (:t, '3 ordinateurs portables', 'informatique', '2026-01-05', 600000, 3, :s, 'paid', 'virement', '2026-01-20', :by)`,
      { t: fx5.tenantId, s: s.insertId, by: fx5.dgId },
    );
    const [dep] = await pool.query(
      "INSERT INTO fixed_asset_depreciations (tenant_id, fixed_asset_id, period, amount, recorded_by) VALUES (:t, :a, '2026-02', 16667, :by)",
      { t: fx5.tenantId, a: asset.insertId, by: fx5.dgId },
    );

    const result = await activateModule(pool, fx5.tenantId, { userId: fx5.dgId, ipAddress: '127.0.0.1' });
    assert.equal(result.entriesGenerated, 3, 'acquisition + règlement + amortissement, 3 écritures distinctes');
    assert.deepEqual(result.errors, []);

    const [[acquisition]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'fixed_assets' AND source_id = :id",
      { t: fx5.tenantId, id: asset.insertId },
    );
    const [[settlement]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'fixed_asset_settlements' AND source_id = :id",
      { t: fx5.tenantId, id: asset.insertId },
    );
    const [[depreciation]] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'fixed_asset_depreciations' AND source_id = :id",
      { t: fx5.tenantId, id: dep.insertId },
    );
    assert.ok(acquisition, "l'acquisition (à crédit) a bien une écriture");
    assert.ok(settlement, 'le règlement a bien sa PROPRE écriture, distincte');
    assert.ok(depreciation, "l'amortissement déjà saisi a bien sa propre écriture");

    const [[balance481]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
       FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id JOIN gl_accounts a ON a.id = el.account_id
       WHERE e.tenant_id = :t AND a.code = '481'`,
      { t: fx5.tenantId },
    );
    assert.equal(Number(balance481.solde), 0, 'acquise puis réglée : le 481 de ce tenant tout neuf revient à zéro');

    const [depreciationLines] = await pool.query(
      'SELECT el.side, a.code FROM gl_entry_lines el JOIN gl_accounts a ON a.id = el.account_id WHERE el.entry_id = :id ORDER BY el.line_order',
      { id: depreciation.id },
    );
    assert.equal(depreciationLines[0].side, 'debit');
    assert.equal(depreciationLines[0].code, '681');
    assert.equal(depreciationLines[1].side, 'credit');
    assert.equal(depreciationLines[1].code, '28442');
  } finally {
    await teardown(fx5.tenantId);
  }
});

test("Haute #8 (étape 51) — deux rattrapages lancés en VRAIE concurrence sur le même tenant ne créent jamais deux écritures pour la même opération", async () => {
  // Reproduit la course exacte visée par l'audit : `backfillOne` vérifie l'absence d'écriture (SELECT)
  // AVANT `beginTransaction()`, sans aucun verrou — deux appels concurrents à `activateModule`/
  // `backfillHistoricalEntries` pour le MÊME tenant (double-clic, requête relancée) peuvent tous deux
  // passer cette vérification avant que l'un des deux ne commite. Avant ce correctif (migration 077,
  // contrainte UNIQUE `uq_gl_entries_active_source`), rien n'empêchait les DEUX d'insérer leur propre
  // écriture pour la même opération réelle. `Promise.all` déclenche une vraie concurrence (deux
  // connexions MySQL distinctes), pas un simple enchaînement séquentiel.
  const fx7 = await createBareFixture();
  try {
    // Module d'abord initialisé (plan comptable/règles seedés) SANS historique à rattraper, exactement
    // comme `activateModule` le ferait sur un tenant tout neuf — sinon `genererEcriture` échouerait
    // (aucune règle comptable encore seedée) et masquerait la course testée ici derrière une erreur sans
    // rapport.
    await activateModule(pool, fx7.tenantId, { userId: fx7.dgId, ipAddress: '127.0.0.1' });
    // Puis un paiement inséré directement (comme si le module avait momentanément raté cette écriture) :
    // la seule opération que les deux rattrapages concurrents ci-dessous vont se disputer.
    await pool.query(
      "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by) VALUES (:t, :l, '2026-04', 50000, 'especes', '2026-04-05', :by)",
      { t: fx7.tenantId, l: fx7.leaseId, by: fx7.dgId },
    );

    const [resultA, resultB] = await Promise.all([
      backfillHistoricalEntries(pool, fx7.tenantId, { fromDate: '2026-01-01', createdBy: fx7.dgId }),
      backfillHistoricalEntries(pool, fx7.tenantId, { fromDate: '2026-01-01', createdBy: fx7.dgId }),
    ]);

    // Jamais les deux à la fois : soit l'un génère pendant que l'autre trouve déjà fait (séquentiel de
    // fait, verrou implicite de la transaction), soit les deux passent la vérification en même temps et
    // la contrainte UNIQUE convertit le second en « déjà fait » (skipped) — jamais une vraie erreur, et
    // jamais 2 écritures générées pour la même opération.
    assert.equal(resultA.generated + resultB.generated, 1, 'une seule des deux générations doit aboutir');
    assert.equal(resultA.errors.length, 0, JSON.stringify(resultA.errors));
    assert.equal(resultB.errors.length, 0, JSON.stringify(resultB.errors));

    const [entries] = await pool.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments'",
      { t: fx7.tenantId },
    );
    assert.equal(entries.length, 1, 'une seule écriture au final, jamais un doublon');
  } finally {
    await teardown(fx7.tenantId);
  }
});
