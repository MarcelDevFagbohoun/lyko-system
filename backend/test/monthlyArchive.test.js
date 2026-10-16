'use strict';

/**
 * Demande explicite de l'utilisateur (16/10/2026) : à la clôture d'un mois, archiver pour chaque
 * locataire concerné "le point du mois" complet (loyer, charges SONEB/SBEE, pénalités de retard,
 * note) — consultable (vue portefeuille par mois) mais jamais modifiable — et repartir avec une
 * note vide pour le mois qui vient de s'ouvrir. Ce test exerce le vrai flux HTTP de bout en bout :
 * préparer un mois (loyer partiel, charge impayée, pénalité partiellement réglée, note), le
 * clôturer via la vraie route, puis lire l'archive.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Pas nettoyé par `teardown()` (voir sa documentation) : `accounting_periods.closed_by` référence
  // `users` en ON DELETE RESTRICT, et resterait sinon en travers de la suppression du DG de test.
  await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

test(
  "Clôture d'un mois — archive complète (loyer/charges/pénalités/note) créée, consultable, et la " +
    "note du locataire repart à zéro pour le mois suivant",
  async () => {
    const period = '2026-03';

    // Note vivante AVANT la clôture.
    const notesRes = await fetch(`${baseUrl}/api/renters/${fx.renterId}/notes`, {
      method: 'PATCH',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ notes: 'Paie toujours en retard, contacter le soir.' }),
    });
    assert.equal(notesRes.status, 200);

    // Loyer partiel : 20 000 payés sur 50 000 dus en mars.
    await pool.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :l, :period, STR_TO_DATE(CONCAT(:period, '-01'), '%Y-%m-%d'), 20000, 'especes', '2026-03-10', :by)`,
      { t: fx.tenantId, l: fx.leaseId, period, by: fx.dgId },
    );

    // Charge SONEB impayée, facturée en mars.
    const [chargeResult] = await pool.query(
      `INSERT INTO utility_charges
         (tenant_id, lease_id, utility_type, period_start, period_end, reading_start, reading_end,
          unit_price, amount, loss_share_amount, billed_at, status, recorded_by)
       VALUES (:t, :l, 'soneb', '2026-03-01', '2026-03-31', 0, 50, 100, 5000, 0, '2026-03-20', 'impayee', :by)`,
      { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
    );
    const chargeId = chargeResult.insertId;

    // Pénalité de retard, partiellement réglée (1 000 sur 2 000).
    const [lateFeeResult] = await pool.query(
      `INSERT INTO late_fees (tenant_id, lease_id, amount, applied_at, reason, applied_by)
       VALUES (:t, :l, 2000, '2026-03-12', 'Retard de paiement', :by)`,
      { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
    );
    const lateFeeId = lateFeeResult.insertId;
    await pool.query(
      `INSERT INTO late_fee_payments (tenant_id, late_fee_id, amount, payment_method, paid_at, recorded_by)
       VALUES (:t, :lf, 1000, 'especes', '2026-03-15', :by)`,
      { t: fx.tenantId, lf: lateFeeId, by: fx.dgId },
    );

    // L'archive n'existe pas avant la clôture.
    const beforeClose = await fetch(`${baseUrl}/api/accounting/periods/${period}/archive`, {
      headers: bearer(fx.dgId, fx.tenantId),
    });
    assert.equal(beforeClose.status, 404);

    // Clôture réelle du mois (force: true pour ignorer la marge de sécurité des échéances — non
    // pertinente ici, seul le déclenchement de l'archive nous intéresse).
    const closeRes = await fetch(`${baseUrl}/api/accounting/periods`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({ period, force: true }),
    });
    assert.equal(closeRes.status, 201);

    const archiveRes = await fetch(`${baseUrl}/api/accounting/periods/${period}/archive`, {
      headers: bearer(fx.dgId, fx.tenantId),
    });
    assert.equal(archiveRes.status, 200);
    const archiveBody = await archiveRes.json();
    assert.equal(archiveBody.period, period);
    assert.equal(archiveBody.renters.length, 1);

    const entry = archiveBody.renters[0];
    assert.equal(entry.leaseId, fx.leaseId);
    assert.equal(entry.renterId, fx.renterId);
    assert.equal(entry.notesSnapshot, 'Paie toujours en retard, contacter le soir.');

    assert.equal(entry.rent.status, 'partiel');
    assert.equal(entry.rent.due, 50000);
    assert.equal(entry.rent.paid, 20000);
    assert.equal(entry.rent.remaining, 30000);

    assert.equal(entry.charges.length, 1);
    assert.equal(entry.charges[0].id, chargeId);
    assert.equal(entry.charges[0].amount, 5000);
    assert.equal(entry.charges[0].status, 'impayee');

    assert.equal(entry.lateFees.length, 1);
    assert.equal(entry.lateFees[0].id, lateFeeId);
    assert.equal(entry.lateFees[0].amount, 2000);
    assert.equal(entry.lateFees[0].paid, 1000);
    assert.equal(entry.lateFees[0].status, 'partielle');

    // La note vivante repart à zéro pour le mois qui vient de s'ouvrir.
    const [[renterRow]] = await pool.query('SELECT notes, notes_updated_by, notes_updated_at FROM renters WHERE id = :id', {
      id: fx.renterId,
    });
    assert.equal(renterRow.notes, null);
    assert.equal(renterRow.notes_updated_by, null);
    assert.equal(renterRow.notes_updated_at, null);
  },
);

test("GET .../periods/:period/archive — un mois jamais clôturé n'a pas d'archive (404)", async () => {
  const res = await fetch(`${baseUrl}/api/accounting/periods/2026-04/archive`, {
    headers: bearer(fx.dgId, fx.tenantId),
  });
  assert.equal(res.status, 404);
});
