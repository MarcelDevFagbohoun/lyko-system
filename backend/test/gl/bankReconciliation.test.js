'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../../src/config/db');
const { genererEcriture } = require('../../src/services/gl/glPostingService');
const {
  getBankJournalAndAccount,
  startReconciliation,
  getReconciliationDetail,
  addLine,
  removeLine,
  finalizeReconciliation,
} = require('../../src/services/gl/glBankReconciliationService');
const { createFixture, createBareFixture, teardown } = require('./fixtures');

let fx;

before(async () => {
  fx = await createFixture();

  // Trois mouvements réels sur le compte banque (521) en janvier 2026 : un
  // loyer encaissé par virement (débit 521) et deux dépenses réglées par
  // virement/chèque (crédit 521) — de quoi tester pointage ET mouvements
  // non pointés. Aucun taux de commission défini : la ligne produit (706)
  // est omise, le tiers-propriétaire reçoit le montant plein (comportement
  // déjà validé ailleurs) — sans incidence ici, seul le compte 521 compte.
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'loyer_encaisse',
    entryDate: '2026-01-05',
    amount: 100000,
    paymentMethod: 'virement',
    narrationVars: { mois: '2026-01', locataire: 'Locataire Test' },
    sourceTable: 'rent_payments',
    sourceId: 1,
    createdBy: fx.dgId,
    context: { leaseId: fx.leaseId },
  });
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'depense_fournitures',
    entryDate: '2026-01-10',
    amount: 20000,
    paymentMethod: 'virement',
    narrationVars: { libelle: 'Fournitures bureau' },
    sourceTable: 'expenses',
    sourceId: 1,
    createdBy: fx.dgId,
  });
  await genererEcriture(pool, {
    tenantId: fx.tenantId,
    operationType: 'depense_entretien',
    entryDate: '2026-01-15',
    amount: 15000,
    paymentMethod: 'cheque',
    narrationVars: { libelle: 'Peinture' },
    sourceTable: 'expenses',
    sourceId: 2,
    createdBy: fx.dgId,
  });
});

after(async () => {
  await teardown(fx.tenantId);
  await closePool();
});

test("getBankJournalAndAccount refuse un tenant dont le plan comptable n'a jamais été initialisé", async () => {
  const bare = await createBareFixture();
  try {
    await assert.rejects(() => getBankJournalAndAccount(pool, bare.tenantId), /pas encore initialisé/);
  } finally {
    await teardown(bare.tenantId);
  }
});

test('startReconciliation calcule le solde comptable du compte banque (521) à la fin de la période', async () => {
  const { id } = await startReconciliation(pool, fx.tenantId, { period: '2026-01', statementBalance: 65000 });
  const detail = await getReconciliationDetail(pool, fx.tenantId, id);

  // +100000 (loyer, débit) − 20000 (fournitures) − 15000 (entretien) = 65000.
  assert.equal(detail.reconciliation.bookBalance, 65000);
  assert.equal(detail.reconciliation.statementBalance, 65000);
  assert.equal(detail.reconciliation.gap, 0);
  assert.equal(detail.reconciliation.status, 'en_cours');
  assert.equal(detail.unmatchedBookMovements.length, 3, 'les 3 mouvements ne sont pas encore pointés');
  assert.equal(detail.lines.length, 0);

  fx.reconciliationId = id;
  fx.movementIds = detail.unmatchedBookMovements.map((m) => m.entryLineId);
});

test('un second rapprochement pour la même période est refusé', async () => {
  await assert.rejects(
    () => startReconciliation(pool, fx.tenantId, { period: '2026-01', statementBalance: 65000 }),
    /existe déjà/,
  );
});

test('addLine pointe un mouvement comptable existant — il sort de la liste des non pointés', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  const lineId = await addLine(pool, fx.tenantId, fx.reconciliationId, { entryLineId: fx.movementIds[0] }, accountId);
  assert.ok(lineId);

  const detail = await getReconciliationDetail(pool, fx.tenantId, fx.reconciliationId);
  assert.equal(detail.unmatchedBookMovements.length, 2);
  assert.equal(detail.lines.length, 1);
  assert.equal(detail.lines[0].isMatched, true);
  assert.ok(detail.lines[0].entryLine);

  fx.firstLineId = lineId;
});

test('pointer deux fois le même mouvement est refusé', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  await assert.rejects(
    () => addLine(pool, fx.tenantId, fx.reconciliationId, { entryLineId: fx.movementIds[0] }, accountId),
    /déjà pointé/,
  );
});

test('addLine enregistre une ligne bancaire SANS écriture correspondante (ex. frais bancaires)', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  await addLine(
    pool,
    fx.tenantId,
    fx.reconciliationId,
    { bankReference: 'FRAIS TENUE COMPTE', bankAmount: 1500, bankDate: '2026-01-31' },
    accountId,
  );

  const detail = await getReconciliationDetail(pool, fx.tenantId, fx.reconciliationId);
  const bankOnly = detail.lines.find((l) => l.bankReference === 'FRAIS TENUE COMPTE');
  assert.ok(bankOnly);
  assert.equal(bankOnly.isMatched, false);
  assert.equal(bankOnly.entryLine, null);
  assert.equal(bankOnly.bankAmount, 1500);
  // N'affecte jamais les mouvements comptables non pointés : c'est une
  // catégorie distincte (vue sur le relevé, absente des comptes).
  assert.equal(detail.unmatchedBookMovements.length, 2);
});

test('finalizeReconciliation refuse tant que des mouvements restent non pointés, même avec un écart nul', async () => {
  await assert.rejects(
    () => finalizeReconciliation(pool, fx.tenantId, fx.reconciliationId, { userId: fx.dgId, force: false }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.details.unmatchedCount, 2);
      assert.equal(err.details.gap, 0);
      return true;
    },
  );
});

test('removeLine annule un pointage — le mouvement redevient non pointé', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  await removeLine(pool, fx.tenantId, fx.reconciliationId, fx.firstLineId);

  const detail = await getReconciliationDetail(pool, fx.tenantId, fx.reconciliationId);
  assert.equal(detail.unmatchedBookMovements.length, 3);

  // Repointé pour la suite du test.
  await addLine(pool, fx.tenantId, fx.reconciliationId, { entryLineId: fx.movementIds[0] }, accountId);
});

test('finalizeReconciliation réussit une fois tous les mouvements pointés et l\'écart nul', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  await addLine(pool, fx.tenantId, fx.reconciliationId, { entryLineId: fx.movementIds[1] }, accountId);
  await addLine(pool, fx.tenantId, fx.reconciliationId, { entryLineId: fx.movementIds[2] }, accountId);

  let detail = await getReconciliationDetail(pool, fx.tenantId, fx.reconciliationId);
  assert.equal(detail.unmatchedBookMovements.length, 0);

  await finalizeReconciliation(pool, fx.tenantId, fx.reconciliationId, { userId: fx.dgId, force: false });

  detail = await getReconciliationDetail(pool, fx.tenantId, fx.reconciliationId);
  assert.equal(detail.reconciliation.status, 'rapproche');
  assert.ok(detail.reconciliation.reconciledAt);
});

test('un rapprochement clôturé refuse toute nouvelle modification', async () => {
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);
  await assert.rejects(
    () => addLine(pool, fx.tenantId, fx.reconciliationId, { bankAmount: 100, bankDate: '2026-01-31' }, accountId),
    /déjà clôturé/,
  );
  await assert.rejects(
    () => finalizeReconciliation(pool, fx.tenantId, fx.reconciliationId, { userId: fx.dgId, force: false }),
    /déjà clôturé/,
  );
});

test('un écart non nul bloque la clôture sauf confirmation explicite (force)', async () => {
  const { id } = await startReconciliation(pool, fx.tenantId, { period: '2026-02', statementBalance: 999999 });
  const { accountId } = await getBankJournalAndAccount(pool, fx.tenantId);

  // Aucun NOUVEAU mouvement en février dans cette fixture : 0 mouvement non
  // pointé, mais le solde comptable reste le solde CUMULÉ depuis janvier
  // (65000, mouvements déjà pointés dans le rapprochement précédent) — le
  // solde saisi (999999) ne correspond à rien -> écart non nul (934999).
  const detail = await getReconciliationDetail(pool, fx.tenantId, id);
  assert.equal(detail.unmatchedBookMovements.length, 0);
  assert.equal(detail.reconciliation.bookBalance, 65000);
  assert.equal(detail.reconciliation.gap, 934999);

  await assert.rejects(
    () => finalizeReconciliation(pool, fx.tenantId, id, { userId: fx.dgId, force: false }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.details.gap, 934999);
      return true;
    },
  );

  await finalizeReconciliation(pool, fx.tenantId, id, { userId: fx.dgId, force: true });
  const after = await getReconciliationDetail(pool, fx.tenantId, id);
  assert.equal(after.reconciliation.status, 'rapproche');
});
