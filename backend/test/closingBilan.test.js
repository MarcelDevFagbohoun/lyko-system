'use strict';

/**
 * Bilan de clôture (demande utilisateur, 2026-10-18) : « une clôture nous devons avoir tous les
 * détails, les propriétaires reversé et non, les recettes du mois, les points essentiels du
 * mois, les charges — une sorte de bilan du mois ». Voir `services/commission.js`
 * `getOwnerPayoutStatusAsOf` et `routes/accounting.js` `GET /rent-month/:month/bilan`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { getOwnerPayoutStatusAsOf } = require('../src/services/commission');
const { createBareFixture, setCommissionRate, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

before(async () => {
  fx = await createBareFixture();
  await setCommissionRate(fx.tenantId, fx.ownerId, fx.dgId, 10); // 10 %
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const p = { tenantId: fx.tenantId };
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = :tenantId', p);
  await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :tenantId', p);
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
});

test(
  "getOwnerPayoutStatusAsOf — reconstruction historique (option B) : un versement POSTÉRIEUR à la date ne doit jamais " +
    'rendre « reversé » un propriétaire qui ne l\'était pas encore à cette date',
  async () => {
    // Janvier : 100 000 encaissés, commission 10% → 90 000 dus au propriétaire. Versement complet fin janvier.
    await pool.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :l, '2026-01', '2026-01-01', 100000, 'virement', '2026-01-05', :by)`,
      { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
    );
    await pool.query(
      `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
       VALUES (:t, :o, 90000, 'Janvier', '2026-01-31', 'virement', :by)`,
      { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
    );

    const statusEndJan = await getOwnerPayoutStatusAsOf(fx.tenantId, '2026-01-31');
    assert.ok(statusEndJan.reversed.some((o) => o.ownerId === fx.ownerId), 'soldé à zéro à la fin janvier');
    assert.ok(!statusEndJan.notReversed.some((o) => o.ownerId === fx.ownerId));

    // Février : nouvelle recette (90 000 dus), mais le versement correspondant n'arrive qu'en MARS.
    await pool.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :l, '2026-02', '2026-02-01', 100000, 'virement', '2026-02-05', :by)`,
      { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
    );
    const statusEndFeb = await getOwnerPayoutStatusAsOf(fx.tenantId, '2026-02-28');
    assert.ok(
      statusEndFeb.notReversed.some((o) => o.ownerId === fx.ownerId && o.balance === 90000),
      'encore dû à la fin février : pas encore reversé à CETTE date, peu importe ce qui se passera en mars',
    );
    assert.ok(!statusEndFeb.reversed.some((o) => o.ownerId === fx.ownerId));

    // Le versement de mars règle février — mais ne doit JAMAIS changer rétroactivement le statut
    // déjà calculé pour la fin février (reconstruction figée dans le temps, pas une vue mutable).
    await pool.query(
      `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
       VALUES (:t, :o, 90000, 'Février', '2026-03-10', 'virement', :by)`,
      { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
    );
    const statusEndFebAgain = await getOwnerPayoutStatusAsOf(fx.tenantId, '2026-02-28');
    assert.ok(
      statusEndFebAgain.notReversed.some((o) => o.ownerId === fx.ownerId && o.balance === 90000),
      'le passé reste le passé : un versement de mars ne doit jamais réécrire le solde de février',
    );

    const statusEndMarch = await getOwnerPayoutStatusAsOf(fx.tenantId, '2026-03-31');
    assert.ok(statusEndMarch.reversed.some((o) => o.ownerId === fx.ownerId), 'soldé une fois le versement de mars pris en compte');
  },
);

// Réutilise délibérément l'état laissé par le test précédent (loyer de janvier + versement de
// janvier déjà enregistrés sur fx.leaseId/fx.ownerId) plutôt que de recréer un scénario — ce test
// vérifie la ROUTE HTTP (permissions, forme de la réponse), pas le calcul lui-même déjà couvert
// ci-dessus ; doit donc s'exécuter APRÈS lui (fichier exécuté avec --test-concurrency=1).
test('GET /api/accounting/rent-month/:month/bilan — recettes/dépenses du mois + statut des propriétaires, réservé à la permission comptabilité', async () => {
  const [comptableNoPerm] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'comptable', 'Awa', 'Kpakpo', :phone, 'x')",
    { t: fx.tenantId, phone: `09${Math.floor(Math.random() * 100000000)}` },
  );
  const forbidden = await fetch(`${baseUrl}/api/accounting/rent-month/2026-01/bilan`, {
    headers: bearer(comptableNoPerm.insertId, fx.tenantId, 'comptable'),
  });
  assert.equal(forbidden.status, 403);

  const res = await fetch(`${baseUrl}/api/accounting/rent-month/2026-01/bilan`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.month, '2026-01');
  assert.equal(body.dashboard.period.from, '2026-01-01');
  assert.equal(body.dashboard.period.to, '2026-01-31');
  assert.equal(body.dashboard.totals.rentCollected, 100000, 'recette du mois, même calcul que le tableau de bord comptable');
  assert.ok(body.owners.reversed.some((o) => o.ownerId === fx.ownerId), 'propriétaire soldé à la fin janvier (versement déjà enregistré)');

  assert.equal((await fetch(`${baseUrl}/api/accounting/rent-month/bad-month/bilan`, { headers: bearer(fx.dgId, fx.tenantId) })).status, 400);
});
