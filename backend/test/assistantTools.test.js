'use strict';

/**
 * Assistant IA — étape B : outils de LECTURE (`services/assistant/tools.js`). Le modèle ne touche
 * jamais la base ; ces outils sont de fins habillages au-dessus des calculs déjà en place ailleurs
 * (arriérés, point des charges, séquestre…) — déjà testés côté calcul (`rentTracking.test.js`,
 * `utilityPoint.test.js`, `commission.test.js`). Ici, on vérifie ce qui est de la responsabilité PROPRE
 * de ces outils : qui y a droit, le respect de la portée agent, la forme, le tri et le bornage.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { toolsFor, runTool, labelFor, TOOLS } = require('../src/services/assistant/tools');
const { createBareFixture } = require('./gl/fixtures');

let fx;
let scopedAgentId; // agent restreint à `scopedPropertyId` uniquement
let scopedPropertyId;
let scopedUnitId;
let scopedRenterId;
let scopedLeaseId;
let complaintUrgentId;
let complaintNormalId;
let batchId;
let unpaidLeaseId; // second bail EN RETARD, sur le Bien de la fixture (hors portée de l'agent restreint)
let unpaidRenterName;

before(async () => {
  fx = await createBareFixture();

  // Un second Bien du même tenant, attribué à un agent restreint — sert à vérifier que la portée
  // « Biens gérés » de l'assistant est EXACTEMENT celle des écrans (jamais plus large).
  const [agent] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'Restreint', :phone, 'x')",
    { t: fx.tenantId, phone: `06${Math.floor(Math.random() * 100000000)}` },
  );
  scopedAgentId = agent.insertId;

  const [property] = await pool.query(
    'INSERT INTO properties (tenant_id, code, owner_id, agent_id, address, created_by) VALUES (:t, :code, :ownerId, :agentId, :address, :by)',
    { t: fx.tenantId, code: 'GLT-002', ownerId: fx.ownerId, agentId: scopedAgentId, address: 'Adresse 2', by: fx.dgId },
  );
  scopedPropertyId = property.insertId;

  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 60000, :by)",
    { t: fx.tenantId, p: scopedPropertyId, by: fx.dgId },
  );
  scopedUnitId = unit.insertId;

  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Scopé', 'Test', :phone, :by)",
    { t: fx.tenantId, phone: `07${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  scopedRenterId = renter.insertId;

  // Bail actif jamais payé, plus ancien que celui de la fixture — doit ressortir EN PREMIER
  // (jours de retard plus élevés) dans `locataires_en_retard`, mais UNIQUEMENT pour l'agent restreint.
  const [lease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2025-01-01', 60000, 5, 0, 'active', :by)",
    { t: fx.tenantId, r: scopedRenterId, u: scopedUnitId, by: fx.dgId },
  );
  scopedLeaseId = lease.insertId;

  // Second bail EN RETARD, sur le Bien de la fixture (donc hors de la portée de l'agent restreint) —
  // jamais payé. Une nouvelle Unité : ne jamais réutiliser celle de `fx.leaseId` pour deux baux actifs.
  const [unpaidUnit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U3', 'studio', 'loue', 45000, :by)",
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );
  const [unpaidRenter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Jamais', 'Payé', :phone, :by)",
    { t: fx.tenantId, phone: `08${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  unpaidRenterName = 'Jamais Payé';
  const [unpaidLease] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2025-01-01', 45000, 1, 0, 'active', :by)",
    { t: fx.tenantId, r: unpaidRenter.insertId, u: unpaidUnit.insertId, by: fx.dgId },
  );
  unpaidLeaseId = unpaidLease.insertId;

  // Un paiement de loyer sur le bail de la fixture (mois en cours) — utilisé par le bilan comptable et
  // les soldes propriétaires. Le propriétaire n'a AUCUN taux de commission défini (comportement par
  // défaut de `createBareFixture`) : il doit apparaître dans « propriétaires sans taux ».
  const thisMonth = new Date().toISOString().slice(0, 7);
  await pool.query(
    "INSERT INTO rent_payments (tenant_id, lease_id, amount, covers_month, payment_method, paid_at, recorded_by) VALUES (:t, :l, 50000, :m, 'especes', CURDATE(), :by)",
    { t: fx.tenantId, l: fx.leaseId, m: thisMonth, by: fx.dgId },
  );

  // Une facture SONEB impayée sur le Bien restreint (portée).
  await pool.query(
    "INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by) VALUES (:t, :l, 'soneb', '2026-08-01', '2026-08-31', 0, 10, 100, 15000, '2026-08-31', 'impayee', :by)",
    { t: fx.tenantId, l: scopedLeaseId, by: fx.dgId },
  );

  // Deux plaintes ouvertes : une urgente (sur le Bien de la fixture), une normale (sur le Bien restreint).
  const [c1] = await pool.query(
    "INSERT INTO complaints (tenant_id, lease_id, code, category, title, priority, status, reported_at, created_by) VALUES (:t, :l, 'INC-TEST-1', 'plomberie', 'Fuite urgente', 'urgente', 'ouverte', '2026-09-01', :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  complaintUrgentId = c1.insertId;
  const [c2] = await pool.query(
    "INSERT INTO complaints (tenant_id, lease_id, code, category, title, priority, status, reported_at, created_by) VALUES (:t, :l, 'INC-TEST-2', 'electricite', 'Prise cassée', 'normale', 'en_cours', '2026-09-10', :by)",
    { t: fx.tenantId, l: scopedLeaseId, by: fx.dgId },
  );
  complaintNormalId = c2.insertId;

  // Un relevé SONEB validé sur le Bien restreint : facture mère payée 100 000, encaissé 40 000.
  const [batch] = await pool.query(
    `INSERT INTO utility_reading_batches
       (tenant_id, property_id, utility_type, period_start, period_end, unit_price,
        main_reading_start, main_reading_end, main_invoice_amount, main_paid_amount, main_paid_at,
        status, validated_at, recorded_by)
     VALUES (:t, :p, 'soneb', '2026-08-01', '2026-08-31', 100, 0, 1000, 100000, 100000, '2026-08-31', 'valide', NOW(), :by)`,
    { t: fx.tenantId, p: scopedPropertyId, by: fx.dgId },
  );
  batchId = batch.insertId;
  const [reading] = await pool.query(
    `INSERT INTO utility_charges (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end, unit_price, amount, billed_at, status, recorded_by)
     VALUES (:t, :l, 'soneb', '2026-08-01', '2026-08-31', 0, 4, 100, 40000, '2026-08-31', 'payee', :by)`,
    { t: fx.tenantId, l: scopedLeaseId, by: fx.dgId },
  );
  await pool.query(
    'INSERT INTO utility_readings (tenant_id, batch_id, unit_id, lease_id, reading_start, reading_end, amount, charge_id) VALUES (:t, :b, :u, :l, 0, 4, 40000, :c)',
    { t: fx.tenantId, b: batchId, u: scopedUnitId, l: scopedLeaseId, c: reading.insertId },
  );
  await pool.query(
    "INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by) VALUES (:t, :c, 40000, 'especes', '2026-08-31', :by)",
    { t: fx.tenantId, c: reading.insertId, by: fx.dgId },
  );
});

after(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM utility_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_readings WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_charges WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM utility_reading_batches WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM complaints WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM leases WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM renters WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM property_units WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM properties WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owners WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM users WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM tenants WHERE id = :tenantId', p);
  await closePool();
});

const fullCtx = (extra = {}) => ({ tenantId: fx.tenantId, userId: fx.dgId, role: 'dg', permissions: [], scopeAgentId: null, ...extra });
const scopedCtx = (extra = {}) => ({ tenantId: fx.tenantId, userId: scopedAgentId, role: 'agent', permissions: ['locataires', 'charges', 'plaintes'], scopeAgentId: scopedAgentId, ...extra });

// ───────────────────────────── catalogue / permissions ─────────────────────────────

test('toolsFor : la direction a toujours accès à tous les outils, quelles que soient ses permissions (vide)', () => {
  const tools = toolsFor({ role: 'dg', permissions: [] });
  assert.equal(tools.length, TOOLS.length);
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
  for (const t of tools) assert.deepEqual(Object.keys(t).sort(), ['description', 'input_schema', 'name']);
});

test("toolsFor : un employé sans aucune permission de données n'a AUCUN outil", () => {
  assert.deepEqual(toolsFor({ role: 'agent', permissions: ['assistant'] }), []);
});

test('toolsFor : un agent avec seulement « locataires » ne voit que l’outil des impayés de loyer', () => {
  const tools = toolsFor({ role: 'agent', permissions: ['locataires'] });
  assert.deepEqual(tools.map((t) => t.name), ['locataires_en_retard']);
});

test('toolsFor : « comptabilite » ouvre 5 outils sur 6, mais jamais celui des plaintes', () => {
  const names = toolsFor({ role: 'comptable', permissions: ['comptabilite'] }).map((t) => t.name);
  assert.equal(names.length, 5);
  assert.ok(!names.includes('plaintes_ouvertes'));
});

test('labelFor : un libellé en français pour chaque outil connu, un libellé générique sinon', () => {
  for (const t of TOOLS) assert.match(labelFor(t.name), /[a-zà-ÿ]/);
  assert.equal(labelFor('outil_inconnu'), 'Consultation de vos données…');
});

test('runTool : refuse silencieusement un outil que cet utilisateur ne peut pas utiliser (jamais une exception qui casserait le tour)', async () => {
  const res = await runTool({ role: 'agent', permissions: [] }, 'bilan_comptable_du_mois', {});
  assert.deepEqual(res, { erreur: "Cet outil n'est pas accessible." });
});

test("runTool : un outil inexistant (halluciné par le modèle) ne fait jamais planter le tour", async () => {
  const res = await runTool(fullCtx(), 'outil_qui_nexiste_pas', {});
  assert.deepEqual(res, { erreur: "Cet outil n'est pas accessible." });
});

test('runTool : une entrée non-objet (JSON invalide/absent) retombe sur les valeurs par défaut', async () => {
  const res = await runTool(fullCtx(), 'locataires_en_retard', null);
  assert.ok(Array.isArray(res.locataires));
});

// ───────────────────────────── portée agent ─────────────────────────────

test('locataires_en_retard : portée complète (DG) voit les deux baux en retard (celui de la fixture, payé ce mois-ci, n\'y figure pas)', async () => {
  const res = await runTool(fullCtx(), 'locataires_en_retard', {});
  assert.equal(res.nombreDeLocatairesEnRetard, 2);
  assert.deepEqual(res.locataires.map((l) => l.nom).sort(), ['Jamais Payé', 'Scopé Test']);
  assert.ok(!res.locataires.some((l) => l.nom === 'Locataire Test'), 'le bail déjà réglé ce mois-ci ne doit jamais apparaître');
  // Triés du plus au moins urgent (jours de retard, puis montant dû à égalité).
  for (let i = 1; i < res.locataires.length; i++) {
    const [a, b] = [res.locataires[i - 1], res.locataires[i]];
    assert.ok(a.joursDeRetard > b.joursDeRetard || (a.joursDeRetard === b.joursDeRetard && a.montantDu >= b.montantDu));
  }
  assert.equal(res.montantTotalDu, res.locataires.reduce((s, l) => s + l.montantDu, 0));
});

test("locataires_en_retard : l'agent restreint ne voit QUE le Bien qui lui est attribué", async () => {
  const res = await runTool(scopedCtx(), 'locataires_en_retard', {});
  assert.equal(res.nombreDeLocatairesEnRetard, 1);
  assert.equal(res.locataires[0].nom, 'Scopé Test');
  assert.equal(res.locataires[0].bien, 'GLT-002');
});

test('locataires_en_retard : la limite est bornée (jamais plus que demandé, jamais au-delà du maximum)', async () => {
  const res = await runTool(fullCtx(), 'locataires_en_retard', { limite: 1 });
  assert.equal(res.locataires.length, 1);
  assert.equal(res.nombreDeLocatairesEnRetard, 2, 'le compte total reste exact même si la liste est coupée');
  const trop = await runTool(fullCtx(), 'locataires_en_retard', { limite: 9999 });
  assert.equal(trop.locataires.length, 2, 'jamais plus que ce qui existe, ni plus que le plafond de sécurité imposé par le schéma (20)');
});

test('charges_impayees : scopée, montant et fluide corrects', async () => {
  const res = await runTool(scopedCtx(), 'charges_impayees', {});
  assert.equal(res.nombreDeFacturesImpayees, 1);
  assert.equal(res.factures[0].nom, 'Scopé Test');
  assert.equal(res.factures[0].fluide, 'SONEB (Eau)');
  assert.equal(res.factures[0].montantDu, 15000);
  const vueComplete = await runTool(fullCtx(), 'charges_impayees', {});
  assert.equal(vueComplete.nombreDeFacturesImpayees, 1, "la facture 'payée' du relevé validé n'apparaît pas ici");
});

test("plaintes_ouvertes : l'urgente ressort en premier, seul l'agent restreint voit la sienne", async () => {
  const res = await runTool(fullCtx(), 'plaintes_ouvertes', {});
  assert.equal(res.nombreDePlaintesOuvertes, 2);
  assert.equal(res.nombreUrgentes, 1);
  assert.equal(res.plaintes[0].reference, 'INC-TEST-1');
  assert.equal(res.plaintes[0].priorite, 'Urgente');

  const scoped = await runTool(scopedCtx(), 'plaintes_ouvertes', {});
  assert.equal(scoped.nombreDePlaintesOuvertes, 1);
  assert.equal(scoped.plaintes[0].reference, 'INC-TEST-2');
});

// ───────────────────────────── comptabilité ─────────────────────────────

test('bilan_comptable_du_mois : reprend le calcul du tableau de bord comptable, signale le propriétaire sans taux', async () => {
  const res = await runTool(fullCtx(), 'bilan_comptable_du_mois', {});
  assert.equal(res.loyersEncaisses, 50000);
  assert.equal(res.mois, new Date().toISOString().slice(0, 7));
  assert.ok(res.proprietairesSansTauxDeCommission.includes('Propriétaire Test'));
});

test('bilan_comptable_du_mois : un mois hors plage donne un bilan à zéro, jamais une erreur', async () => {
  const res = await runTool(fullCtx(), 'bilan_comptable_du_mois', { mois: '2020-01' });
  assert.equal(res.loyersEncaisses, 0);
});

test('bilan_comptable_du_mois : un mois mal formé retombe sur le mois en cours plutôt que de planter', async () => {
  const res = await runTool(fullCtx(), 'bilan_comptable_du_mois', { mois: 'pas-un-mois' });
  assert.equal(res.mois, new Date().toISOString().slice(0, 7));
});

test('soldes_proprietaires : jamais scopé agent (même pour un agent restreint), solde = encaissé - 0 % de commission', async () => {
  // Un agent restreint qui a malgré tout la permission « comptabilite » (les deux sont indépendantes) —
  // le solde séquestre reste, par décision produit déjà en place, jamais découpé par Bien géré.
  const ctx = { ...scopedCtx(), permissions: ['comptabilite'] };
  const res = await runTool(ctx, 'soldes_proprietaires', {});
  const owner = res.proprietaires.find((p) => p.nom === 'Propriétaire Test');
  assert.ok(owner, "le solde d'un propriétaire dont un Bien est hors de la portée de l'agent reste visible — décision produit existante");
  assert.equal(owner.soldeDetenu, 50000);
  assert.ok(res.proprietairesSansTauxDeCommission.includes('Propriétaire Test'));
});

test('point_des_charges : reste à charge du propriétaire correctement décomposé pour le mois du relevé', async () => {
  const res = await runTool(fullCtx(), 'point_des_charges', { mois: '2026-08' });
  const owner = res.proprietaires.find((p) => p.nom === 'Propriétaire Test');
  assert.ok(owner);
  assert.equal(owner.resteACharge, 60000); // 100 000 payés - 40 000 encaissés
  assert.equal(owner.releves[0].bien, 'GLT-002');
  assert.equal(owner.releves[0].statut, 'a_charge_proprietaire');
  assert.equal(res.resteAChargeTotalDesProprietaires, 60000);

  const scoped = await runTool(scopedCtx(), 'point_des_charges', { mois: '2026-08' });
  assert.equal(scoped.proprietaires.length, 1, "l'agent restreint ne voit que le point de son propre Bien");
});
