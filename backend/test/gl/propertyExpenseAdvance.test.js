'use strict';
/**
 * Alignement du 21/10/2026 : une dépense imputée à un Bien est une AVANCE pour le propriétaire (débit 4671,
 * moins la part de commission non perçue en 706), pas une charge du cabinet. Le solde 4671 et la commission
 * 706 du grand livre doivent donc retomber exactement sur le séquestre et la commission de la comptabilité simple.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const { resolveExpensePosting } = require('../../src/services/gl/glExpensePosting');
const { getEscrowBalances, getCabinetRevenue } = require('../../src/services/commission');
const { createFixture, setCommissionRate, teardown } = require('./fixtures');

let fx;
before(async () => {
  fx = await createFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10);
});
after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

async function glNet(code, side) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = :side THEN el.amount ELSE -el.amount END), 0) AS net
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :t AND a.code = :code`,
    { t: fx.tenantId, code, side },
  );
  return Number(r.net);
}

test('loyer 100 000 puis réparation du Bien 20 000 : 4671 et 706 du grand livre = séquestre et commission simples', async () => {
  const T = fx.tenantId;
  await pool.query(
    "INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by) VALUES (:T,:l,'2026-09','2026-09-01',100000,'virement','2026-09-10',:by)",
    { T, l: fx.leaseId, by: fx.dgId },
  );
  const [exp] = await pool.query(
    "INSERT INTO expenses (tenant_id, category, property_id, label, amount, expense_date, payment_status, paid_at, payment_method, recorded_by) VALUES (:T,'entretien',:p,'Plomberie',20000,'2026-09-15','paid','2026-09-15','especes',:by)",
    { T, p: fx.propertyId, by: fx.dgId },
  );
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await genererEcriture(conn, { tenantId: T, operationType: 'loyer_encaisse', entryDate: '2026-09-10', amount: 100000, paymentMethod: 'virement', narrationVars: { mois: '2026-09', locataire: 'x' }, createdBy: fx.dgId, context: { leaseId: fx.leaseId } });
    const posting = await resolveExpensePosting(conn, { tenantId: T, propertyId: fx.propertyId, entryDate: '2026-09-15', categoryOperationType: 'depense_entretien' });
    assert.equal(posting.operationType, 'depense_bien_proprietaire');
    await genererEcriture(conn, { tenantId: T, operationType: posting.operationType, entryDate: '2026-09-15', amount: 20000, paymentMethod: 'especes', narrationVars: { libelle: 'Plomberie' }, sourceTable: 'expenses', sourceId: exp.insertId, createdBy: fx.dgId, context: posting.context });
    await conn.commit();
  } finally {
    conn.release();
  }

  const simple = (await getEscrowBalances(T)).get(fx.ownerId);
  assert.equal(simple.balance, 72000); // (100 000 − 20 000) × 90 %
  assert.equal(await glNet('4671', 'credit'), simple.balance, 'solde mandant GL = séquestre simple');
  const revenue = await getCabinetRevenue(T, '2026-09');
  assert.equal(revenue.breakdown.commission, 8000);
  assert.equal(await glNet('706', 'credit'), revenue.breakdown.commission, 'commission GL = commission simple');
  assert.equal(await glNet('624', 'debit'), 0, 'la réparation du Bien n’est plus une charge du cabinet');
});
