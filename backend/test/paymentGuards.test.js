'use strict';

/**
 * Étape 36 — garde-fous anti-doublon des paiements de loyer : clé d'idempotence
 * et heuristique héritée (désormais comparée au MONTANT). Cas réel à l'origine :
 * payer le reste d'un mois partiel juste après un premier versement (même mode,
 * même jour) était refusé à tort comme « paiement identique ».
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { ApiError } = require('../src/middleware/error');
const { claimIdempotencyKey, hasRecentIdenticalRentPayment } = require('../src/services/paymentGuards');
const { createBareFixture } = require('./gl/fixtures');

let fx;

before(async () => {
  fx = await createBareFixture();
});

after(async () => {
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM request_idempotency_keys WHERE tenant_id = :tenantId', p);
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

test('claimIdempotencyKey — une clé ne sert qu\'une fois ; refus 409 « duplicate_request » ; autre clé ou autre portée acceptée', async () => {
  const key = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
  await claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key);
  await assert.rejects(
    () => claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key),
    (e) => e instanceof ApiError && e.status === 409 && e.details.code[0] === 'duplicate_request',
  );
  await claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', 'f1b2c3d4-e5f6-4789-a012-3456789abcde'); // autre clé
  await claimIdempotencyKey(pool, fx.tenantId, 'autre_portee', key); // même clé, autre portée
});

test('claimIdempotencyKey — la clé n\'est PAS consommée si le paiement échoue (insertion annulée avec la transaction)', async () => {
  const key = 'b1b2c3d4-e5f6-4789-a012-3456789abcde';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await claimIdempotencyKey(conn, fx.tenantId, 'rent_payment', key);
    await conn.rollback(); // le paiement a échoué : rien n'est conservé
  } finally {
    conn.release();
  }
  await claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key); // réessayer avec la même clé fonctionne
  await assert.rejects(() => claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key), (e) => e.status === 409);
});

test('claimIdempotencyKey — deux réclamations simultanées de la même clé : exactement une réussit', async () => {
  const key = 'c1b2c3d4-e5f6-4789-a012-3456789abcde';
  const results = await Promise.allSettled([
    claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key),
    claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key),
    claimIdempotencyKey(pool, fx.tenantId, 'rent_payment', key),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 2);
});

test('hasRecentIdenticalRentPayment — compare mois, date, mode ET montant ; le reste d\'un mois partiel n\'est jamais un doublon', async () => {
  // Premier versement partiel : 30 000 sur septembre, le 25/09, en espèces.
  await pool.query(
    `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, amount, payment_method, paid_at, recorded_by)
     VALUES (:t, :l, '2026-09', 30000, 'especes', '2026-09-25', :by)`,
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const base = { leaseId: fx.leaseId, coversMonth: '2026-09', paidAt: '2026-09-25', paymentMethod: 'especes', amount: 30000 };

  assert.equal(await hasRecentIdenticalRentPayment(pool, base), true, 'strictement identique → doublon probable');
  // Le cas signalé : payer le RESTE (45 000) juste après, même mois, même date, même mode.
  assert.equal(await hasRecentIdenticalRentPayment(pool, { ...base, amount: 45000 }), false, 'montant différent → pas un doublon');
  assert.equal(await hasRecentIdenticalRentPayment(pool, { ...base, paymentMethod: 'virement' }), false, 'autre mode');
  assert.equal(await hasRecentIdenticalRentPayment(pool, { ...base, paidAt: '2026-09-26' }), false, 'autre date');
  assert.equal(await hasRecentIdenticalRentPayment(pool, { ...base, coversMonth: '2026-10' }), false, 'autre mois');

  // Au-delà de 2 minutes : plus considéré comme un doublon.
  await pool.query("UPDATE rent_payments SET created_at = NOW() - INTERVAL 3 MINUTE WHERE lease_id = :l", { l: fx.leaseId });
  assert.equal(await hasRecentIdenticalRentPayment(pool, base), false);

  // Un paiement annulé (suppression logique) ne compte pas.
  await pool.query("UPDATE rent_payments SET created_at = NOW(), deleted_at = NOW(), deleted_by = :by, deleted_reason = 'test' WHERE lease_id = :l", { l: fx.leaseId, by: fx.dgId });
  assert.equal(await hasRecentIdenticalRentPayment(pool, base), false);
});
