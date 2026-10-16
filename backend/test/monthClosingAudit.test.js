'use strict';

/**
 * Audit « fermeture du mois » (16/10/2026) — suite distincte de l'audit « comptabilité avancée »
 * (SYSCOHADA, `gl_fiscal_years`) : ici, c'est le mécanisme SIMPLE (`accounting_periods`,
 * `assertPeriodOpen`/`assertPeriodOpenLocked`) qui est vérifié, indépendant du module GL. Chaque
 * section ci-dessous correspond à un point numéroté de cet audit, traité un par un.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { cloneMasterZones } = require('../src/services/inspection');
const { snapshotLeaseBalances } = require('../src/services/rentTracking');
const { getPeriodClosability } = require('../src/services/accountingPeriods');
const { createBareFixture, createFixture, teardown } = require('./gl/fixtures');
const { insertBatch } = require('./utilityFixtures');

// En-tête PNG minimal (`detectFileType`, utils/uploads.js) : signatures acceptées uniquement en image.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
function fakeSignatureForm(extra) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  form.set('tenantSignature', new Blob([PNG_BYTES], { type: 'image/png' }), 'sig-locataire.png');
  form.set('agentSignature', new Blob([PNG_BYTES], { type: 'image/png' }), 'sig-agent.png');
  return form;
}

/** Fiche de sortie prête à finaliser : toutes les conditions à 'BE' (aucune retenue) — le scénario le
 * plus simple pour tester la vérification de clôture, indépendant de la logique de facturation. */
async function insertDraftMoveOutReport({ tenantId, leaseId, depositAmount, conductedAt, dgId }) {
  const zones = cloneMasterZones();
  for (const zone of zones) for (const item of zone.items) item.condition = 'BE';
  const [result] = await pool.query(
    `INSERT INTO move_out_reports (tenant_id, lease_id, conducted_at, items, status, deposit_amount, total_deductions, net_refund, conducted_by)
     VALUES (:t, :l, :conductedAt, :items, 'draft', :depositAmount, 0, :depositAmount, :by)`,
    { t: tenantId, l: leaseId, conductedAt, items: JSON.stringify({ zones }), depositAmount, by: dgId },
  );
  return result.insertId;
}

let fx;
let server;
let baseUrl;
let freeUnitId;

before(async () => {
  fx = await createBareFixture(); // tenant + propriétaire/bien/bail déjà occupés — pas de GL nécessaire ici
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'libre', 40000, :by)",
    { t: fx.tenantId, p: fx.propertyId, by: fx.dgId },
  );
  freeUnitId = unit.insertId;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
  'Content-Type': 'application/json',
});

// Toujours exactement 8 chiffres après le préfixe (10 au total, format béninois attendu) — un nombre
// aléatoire non complété par des zéros produit parfois moins de 8 chiffres et échoue la validation.
const randomPhone = (prefix) => `${prefix}${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;

async function closePeriod(period) {
  // Refonte de la clôture (étape 1/5, 2026-10-16) : `period_start`/`period_end` sont désormais
  // NOT NULL (voir migration 084) — ce raccourci de test doit les fournir, comme le fait la vraie
  // route pour un tenant resté en rythme calendaire (1er au dernier jour du mois).
  const [y, m] = period.split('-').map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  await pool.query(
    'INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, :period, :periodStart, :periodEnd, :by)',
    { t: fx.tenantId, period, periodStart, periodEnd, by: fx.dgId },
  );
}

async function reopenPeriod(period) {
  await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: fx.tenantId, period });
}

// ───────────────────────── Point 1 : caution / frais d'agence / prorata / cautions supplémentaires ─────────────────────────

test(
  "POST /api/renters — une caution datée dans un mois déjà clôturé est refusée (403), aucun bail ni " +
    "aucune caution ne sont créés (jamais une création partielle)",
  async () => {
    await closePeriod('2026-06');
    try {
      const res = await fetch(`${baseUrl}/api/renters`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Cloture1',
          phone: randomPhone('07'),
          unitId: freeUnitId,
          depositAmount: 50000,
          depositPaymentMethod: 'especes',
          depositPaidAt: '2026-06-15', // mois clôturé
          rentDueDay: 5,
          startDate: '2026-06-15',
        }),
      });
      assert.equal(res.status, 403);

      const [[renterCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM renters WHERE tenant_id = :t AND last_name = 'Cloture1'",
        { t: fx.tenantId },
      );
      assert.equal(Number(renterCount.n), 0, 'aucun locataire ne doit être créé si la caution est refusée');
    } finally {
      await reopenPeriod('2026-06');
    }
  },
);

test(
  "POST /api/renters — une caution datée APRÈS la clôture (mois ouvert) est acceptée normalement, " +
    "comportement inchangé pour le cas courant",
  async () => {
    const res = await fetch(`${baseUrl}/api/renters`, {
      method: 'POST',
      headers: bearer(fx.dgId, fx.tenantId),
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Cloture2',
        phone: randomPhone('07'),
        unitId: freeUnitId,
        depositAmount: 50000,
        depositPaymentMethod: 'especes',
        depositPaidAt: '2026-07-15',
        rentDueDay: 5,
        startDate: '2026-07-15',
      }),
    });
    assert.equal(res.status, 201);

    // Nettoyage : libère l'unité pour ne pas gêner d'autres tests de ce fichier.
    const body = await res.json();
    await pool.query('DELETE FROM leases WHERE id = :id', { id: body.leaseId });
    await pool.query('DELETE FROM renters WHERE id = :id', { id: body.renterId });
    await pool.query("UPDATE property_units SET status = 'libre' WHERE id = :id", { id: freeUnitId });
  },
);

test(
  "POST /api/renters — la caution est dans un mois OUVERT mais les frais d'agence sont datés dans un " +
    "mois FERMÉ : refusé (chaque montant a sa PROPRE date, jamais seulement celle de la caution)",
  async () => {
    await closePeriod('2026-06');
    try {
      const res = await fetch(`${baseUrl}/api/renters`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Cloture3',
          phone: randomPhone('07'),
          unitId: freeUnitId,
          depositAmount: 50000,
          depositPaymentMethod: 'especes',
          depositPaidAt: '2026-07-15', // ouvert
          entryFeeAmount: 10000,
          entryFeePaymentMethod: 'especes',
          entryFeePaidAt: '2026-06-20', // fermé
          rentDueDay: 5,
          startDate: '2026-07-15',
        }),
      });
      assert.equal(res.status, 403);
      const [[renterCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM renters WHERE tenant_id = :t AND last_name = 'Cloture3'",
        { t: fx.tenantId },
      );
      assert.equal(Number(renterCount.n), 0);
    } finally {
      await reopenPeriod('2026-06');
    }
  },
);

// ───────────────────────── Point 2 : finalisation / réouverture d'un état des lieux de sortie ─────────────────────────

async function insertActiveLease({ tenantId, propertyId, dgId }, { unitCode, depositAmount }) {
  const [unit] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, :code, 'studio', 'loue', 40000, :by)",
    { t: tenantId, p: propertyId, code: unitCode, by: dgId },
  );
  const [renter] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Sortie', 'Test', :phone, :by)",
    { t: tenantId, phone: randomPhone('08'), by: dgId },
  );
  const [lease] = await pool.query(
    `INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by)
     VALUES (:t, :r, :u, '2026-01-01', 40000, 5, :depositAmount, 'active', :by)`,
    { t: tenantId, r: renter.insertId, u: unit.insertId, depositAmount, by: dgId },
  );
  return { leaseId: lease.insertId, unitId: unit.insertId, renterId: renter.insertId };
}

test(
  "POST /:leaseId/move-out-report/finalize — un état des lieux conduit dans un mois déjà clôturé est " +
    "refusé (403), le bail reste actif et l'unité reste occupée",
  async () => {
    const { leaseId } = await insertActiveLease(fx, { unitCode: 'U3', depositAmount: 50000 });
    await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 50000, conductedAt: '2026-06-20', dgId: fx.dgId });

    await closePeriod('2026-06');
    try {
      const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
        method: 'POST',
        headers: { Authorization: bearer(fx.dgId, fx.tenantId).Authorization },
        body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
      });
      assert.equal(res.status, 403);

      const [[lease]] = await pool.query('SELECT status FROM leases WHERE id = :id', { id: leaseId });
      assert.equal(lease.status, 'active', 'le bail ne doit pas être terminé si la finalisation est refusée');
      const [[report]] = await pool.query("SELECT status FROM move_out_reports WHERE lease_id = :id", { id: leaseId });
      assert.equal(report.status, 'draft');
    } finally {
      await reopenPeriod('2026-06');
    }
  },
);

test(
  "POST /:leaseId/move-out-report/finalize — conduit dans un mois OUVERT : accepté normalement, " +
    "comportement inchangé pour le cas courant",
  async () => {
    const { leaseId } = await insertActiveLease(fx, { unitCode: 'U4', depositAmount: 50000 });
    await insertDraftMoveOutReport({ tenantId: fx.tenantId, leaseId, depositAmount: 50000, conductedAt: '2026-07-20', dgId: fx.dgId });

    const res = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
      method: 'POST',
      headers: { Authorization: bearer(fx.dgId, fx.tenantId).Authorization },
      body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
    });
    assert.equal(res.status, 200);
    const [[lease]] = await pool.query('SELECT status FROM leases WHERE id = :id', { id: leaseId });
    assert.equal(lease.status, 'ended');
  },
);

test(
  "POST /:leaseId/move-out-report/reopen — une extourne datée d'AUJOURD'HUI est refusée si le mois en " +
    "cours est déjà clôturé, alors même que l'état des lieux original date d'un mois toujours ouvert",
  async () => {
    const glFx = await createFixture();
    await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
    const today = new Date().toISOString().slice(0, 7);
    try {
      const { leaseId } = await insertActiveLease(glFx, { unitCode: 'U5', depositAmount: 50000 });
      await insertDraftMoveOutReport({
        tenantId: glFx.tenantId,
        leaseId,
        depositAmount: 50000,
        conductedAt: '2026-03-20', // mois largement passé, toujours ouvert — pas la cause du refus
        dgId: glFx.dgId,
      });

      const finalizeRes = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/finalize`, {
        method: 'POST',
        headers: { Authorization: bearer(glFx.dgId, glFx.tenantId).Authorization },
        body: fakeSignatureForm({ refundPaymentMethod: 'especes' }),
      });
      assert.equal(finalizeRes.status, 200, "la finalisation elle-même doit réussir (mois d'origine ouvert)");

      const [[entry]] = await pool.query(
        "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'move_out_reports' AND status = 'validee' LIMIT 1",
        { t: glFx.tenantId },
      );
      assert.ok(entry, 'la restitution de caution doit avoir généré une écriture GL validée');

      // Clôture le mois EN COURS (celui de l'extourne, pas celui de l'état des lieux) : le bug ne
      // portait QUE sur l'absence de vérification d'AUJOURD'HUI.
      // Refonte de la clôture (étape 1/5, 2026-10-16) : `period_start`/`period_end` sont désormais
      // NOT NULL (migration 084) — fournis ici comme le ferait la vraie route en rythme calendaire.
      {
        const [ty, tm] = today.split('-').map(Number);
        await pool.query(
          'INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, :period, :periodStart, :periodEnd, :by)',
          {
            t: glFx.tenantId,
            period: today,
            periodStart: `${today}-01`,
            periodEnd: new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10),
            by: glFx.dgId,
          },
        );
      }

      const reopenRes = await fetch(`${baseUrl}/api/leases/${leaseId}/move-out-report/reopen`, {
        method: 'POST',
        headers: bearer(glFx.dgId, glFx.tenantId),
        body: JSON.stringify({ reason: 'Correction test audit fermeture du mois' }),
      });
      assert.equal(reopenRes.status, 403);

      const [[entryAfter]] = await pool.query('SELECT status FROM gl_entries WHERE id = :id', { id: entry.id });
      assert.equal(entryAfter.status, 'validee', "l'écriture ne doit PAS avoir été extournée");
      const [[reportAfter]] = await pool.query('SELECT status FROM move_out_reports WHERE lease_id = :id', { id: leaseId });
      assert.equal(reportAfter.status, 'finalized', 'la fiche doit rester finalisée, pas repasser en brouillon');
    } finally {
      await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: glFx.tenantId, period: today });
      await teardown(glFx.tenantId);
    }
  },
);

// ───────────────────────── Point 4 : validation d'un relevé de charges vérifie la mauvaise date ─────────────────────────

test(
  "POST /utility-batches/:id/validate — bug corrigé : vérifiait `period_end` (ouvert) au lieu de la " +
    "date RÉELLE d'écriture (`billed_at = CURDATE()`) — refusé si AUJOURD'HUI est clôturé, même si " +
    "`period_end` est dans un mois ouvert",
  async () => {
    const batchId = await insertBatch(fx, {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31', // largement ouvert — ne doit PAS être la raison d'un refus ou d'une acceptation
      mainReadingStart: 0,
      mainReadingEnd: 1000,
      mainInvoice: 100000,
      status: 'brouillon',
    });
    await pool.query(
      `INSERT INTO utility_readings (tenant_id, batch_id, unit_id, lease_id, reading_start, reading_end, amount)
       VALUES (:t, :b, :u, :l, 0, 50, 10000)`,
      { t: fx.tenantId, b: batchId, u: fx.unitId, l: fx.leaseId },
    );

    const today = new Date().toISOString().slice(0, 7);
    await closePeriod(today);
    try {
      const res = await fetch(`${baseUrl}/api/utility-batches/${batchId}/validate`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: '{}',
      });
      assert.equal(res.status, 403, "doit être refusé : AUJOURD'HUI (date réelle d'écriture) est clôturé");

      const [[batch]] = await pool.query('SELECT status FROM utility_reading_batches WHERE id = :id', { id: batchId });
      assert.equal(batch.status, 'brouillon', 'le relevé ne doit pas être validé si la charge est refusée');
      const [[chargeCount]] = await pool.query(
        "SELECT COUNT(*) AS n FROM utility_charges WHERE tenant_id = :t AND lease_id = :l AND period_start = '2026-03-01'",
        { t: fx.tenantId, l: fx.leaseId },
      );
      assert.equal(Number(chargeCount.n), 0, 'aucune charge ne doit être créée');
    } finally {
      await reopenPeriod(today);
    }
  },
);

test(
  "POST /utility-batches/:id/validate — AUJOURD'HUI ouvert : accepté normalement, même si `period_end` " +
    "appartient à un mois par ailleurs déjà clôturé (comportement inchangé pour le cas courant)",
  async () => {
    await closePeriod('2026-02'); // le mois de la PÉRIODE DE CONSOMMATION — ne doit plus être ce qui compte
    try {
      const batchId = await insertBatch(fx, {
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28', // dans un mois clôturé — ne doit PLUS bloquer la validation
        mainReadingStart: 1000,
        mainReadingEnd: 2000,
        mainInvoice: 100000,
        status: 'brouillon',
      });
      await pool.query(
        `INSERT INTO utility_readings (tenant_id, batch_id, unit_id, lease_id, reading_start, reading_end, amount)
         VALUES (:t, :b, :u, :l, 1000, 1050, 10000)`,
        { t: fx.tenantId, b: batchId, u: fx.unitId, l: fx.leaseId },
      );

      const res = await fetch(`${baseUrl}/api/utility-batches/${batchId}/validate`, {
        method: 'POST',
        headers: bearer(fx.dgId, fx.tenantId),
        body: '{}',
      });
      assert.equal(res.status, 200);
      const [[charge]] = await pool.query(
        "SELECT billed_at FROM utility_charges WHERE tenant_id = :t AND lease_id = :l AND period_start = '2026-02-01'",
        { t: fx.tenantId, l: fx.leaseId },
      );
      assert.ok(charge, 'la charge doit avoir été créée');
    } finally {
      await reopenPeriod('2026-02');
    }
  },
);

// ───────────────────────── Point 5 : extournes automatiques datées d'aujourd'hui ─────────────────────────

test(
  "DELETE /:leaseId/payments/:paymentId — l'extourne GL (datée d'AUJOURD'HUI) est refusée si le mois " +
    "en cours est déjà clôturé, même si le paiement original date d'un mois toujours ouvert",
  async () => {
    const glFx = await createFixture();
    await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
    const today = new Date().toISOString().slice(0, 7);
    try {
      const payRes = await fetch(`${baseUrl}/api/leases/${glFx.leaseId}/payments`, {
        method: 'POST',
        headers: bearer(glFx.dgId, glFx.tenantId),
        body: JSON.stringify({ amount: 50000, paymentMethod: 'especes', paidAt: '2026-03-05' }),
      });
      assert.equal(payRes.status, 201);
      const { paymentId } = await payRes.json();

      const [[entry]] = await pool.query(
        "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'rent_payments' AND source_id = :p AND status = 'validee'",
        { t: glFx.tenantId, p: paymentId },
      );
      assert.ok(entry, 'le paiement doit avoir généré une écriture GL validée');

      // Refonte de la clôture (étape 1/5, 2026-10-16) : `period_start`/`period_end` sont désormais
      // NOT NULL (migration 084) — fournis ici comme le ferait la vraie route en rythme calendaire.
      {
        const [ty, tm] = today.split('-').map(Number);
        await pool.query(
          'INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, :period, :periodStart, :periodEnd, :by)',
          {
            t: glFx.tenantId,
            period: today,
            periodStart: `${today}-01`,
            periodEnd: new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10),
            by: glFx.dgId,
          },
        );
      }

      const delRes = await fetch(`${baseUrl}/api/leases/${glFx.leaseId}/payments/${paymentId}`, {
        method: 'DELETE',
        headers: bearer(glFx.dgId, glFx.tenantId),
        body: JSON.stringify({ reason: 'Test audit fermeture du mois, point 5' }),
      });
      assert.equal(delRes.status, 403);

      const [[paymentAfter]] = await pool.query('SELECT deleted_at FROM rent_payments WHERE id = :id', { id: paymentId });
      assert.equal(paymentAfter.deleted_at, null, 'le paiement ne doit pas être annulé si l’extourne est refusée');
      const [[entryAfter]] = await pool.query('SELECT status FROM gl_entries WHERE id = :id', { id: entry.id });
      assert.equal(entryAfter.status, 'validee');
    } finally {
      await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: glFx.tenantId, period: today });
      await teardown(glFx.tenantId);
    }
  },
);

test(
  "DELETE /expenses/:id — l'extourne GL (datée d'AUJOURD'HUI) est refusée si le mois en cours est " +
    "déjà clôturé, même si la dépense originale date d'un mois toujours ouvert",
  async () => {
    const glFx = await createFixture();
    await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
    const today = new Date().toISOString().slice(0, 7);
    try {
      const expRes = await fetch(`${baseUrl}/api/accounting/expenses`, {
        method: 'POST',
        headers: bearer(glFx.dgId, glFx.tenantId),
        body: JSON.stringify({
          category: 'fournitures',
          label: 'Papeterie test audit',
          amount: 8000,
          expenseDate: '2026-03-10',
          paymentStatus: 'paid',
          paymentMethod: 'especes',
        }),
      });
      assert.equal(expRes.status, 201);
      const { expenseId } = await expRes.json();

      const [[entry]] = await pool.query(
        "SELECT id FROM gl_entries WHERE tenant_id = :t AND source_table = 'expenses' AND source_id = :e AND status = 'validee'",
        { t: glFx.tenantId, e: expenseId },
      );
      assert.ok(entry, 'la dépense doit avoir généré une écriture GL validée');

      // Refonte de la clôture (étape 1/5, 2026-10-16) : `period_start`/`period_end` sont désormais
      // NOT NULL (migration 084) — fournis ici comme le ferait la vraie route en rythme calendaire.
      {
        const [ty, tm] = today.split('-').map(Number);
        await pool.query(
          'INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, :period, :periodStart, :periodEnd, :by)',
          {
            t: glFx.tenantId,
            period: today,
            periodStart: `${today}-01`,
            periodEnd: new Date(Date.UTC(ty, tm, 0)).toISOString().slice(0, 10),
            by: glFx.dgId,
          },
        );
      }

      const delRes = await fetch(`${baseUrl}/api/accounting/expenses/${expenseId}`, {
        method: 'DELETE',
        headers: bearer(glFx.dgId, glFx.tenantId),
        body: JSON.stringify({ reason: 'Test audit fermeture du mois, point 5' }),
      });
      assert.equal(delRes.status, 403);

      const [[expenseAfter]] = await pool.query('SELECT deleted_at FROM expenses WHERE id = :id', { id: expenseId });
      assert.equal(expenseAfter.deleted_at, null);
      const [[entryAfter]] = await pool.query('SELECT status FROM gl_entries WHERE id = :id', { id: entry.id });
      assert.equal(entryAfter.status, 'validee');
    } finally {
      await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t AND period = :period', { t: glFx.tenantId, period: today });
      await teardown(glFx.tenantId);
    }
  },
);

// ───────────────────────── Point 6 : snapshotLeaseBalances calculait l'arriéré par rapport à AUJOURD'HUI ─────────────────────────

test(
  "snapshotLeaseBalances — l'arriéré figé répond à « que devait-il à la FIN DU MOIS FERMÉ », jamais " +
    "« que doit-il aujourd'hui » (clôture tardive d'un mois ancien)",
  async () => {
    const { leaseId } = await insertActiveLease(fx, { unitCode: 'U6', depositAmount: 0 });
    // Bail suivi depuis janvier 2026, AUCUN paiement jamais enregistré — jamais réglé un seul mois.
    // `created_at` recule manuellement : sans ça, `baselineMonthOf` plafonnerait le suivi au mois de
    // CRÉATION de ce test (aujourd'hui), pas à `start_date` — voir `services/rentTracking.js`.
    await pool.query(
      "UPDATE leases SET start_date = '2026-01-01', rent_due_day = 5, created_at = '2026-01-01 08:00:00' WHERE id = :id",
      { id: leaseId },
    );

    // Clôture un mois ANCIEN (août), bien avant aujourd'hui — simule une clôture tardive (rien n'exige
    // de clôturer les mois dans l'ordre ni promptement, voir le point 9 du même audit).
    // Refonte de la clôture (étape 2/5) : signature généralisée (tenantId, rhythm, periodStart, periodEnd).
    await snapshotLeaseBalances(fx.tenantId, { mode: 'calendaire' }, '2026-08-01', '2026-08-31');

    const [[row]] = await pool.query(
      'SELECT amount_due FROM lease_balance_snapshots WHERE tenant_id = :t AND period = :p AND lease_id = :l',
      { t: fx.tenantId, p: '2026-08', l: leaseId },
    );
    assert.ok(row, 'un instantané doit avoir été créé');
    // 8 mois dus (janvier à août inclus) × 40000 FCFA (voir `insertActiveLease`) = 320000. Avant le
    // correctif, le calcul utilisait le mois RÉEL actuel comme borne haute au lieu d'août — un nombre de
    // mois strictement supérieur à 8 (et donc un montant > 320000) aurait révélé le bug.
    assert.equal(Number(row.amount_due), 320000);

    await pool.query('DELETE FROM lease_balance_snapshots WHERE tenant_id = :t AND lease_id = :l', { t: fx.tenantId, l: leaseId });
  },
);

// ───────────────────────── Points 7 et 8 : getPeriodClosability (calcul « mois clôturable sans risque ») ─────────────────────────


// `getPeriodClosability` n'a AUCUN filtre de statut (un bail déjà terminé compte aussi, voir son
// commentaire de fonction) — le tenant PARTAGÉ `fx` accumule des baux de tous les tests précédents de
// ce fichier, qui fausseraient `maxDueDate`. Une fixture ISOLÉE (un seul bail connu) est la seule façon
// de tester ce calcul précisément.

test(
  "getPeriodClosability — un bail à TERME ÉCHU n'est considéré clôturable qu'APRÈS son échéance du " +
    "mois SUIVANT, jamais celle (trop tôt) du mois même qu'on ferme",
  async () => {
    const iso = await createBareFixture(); // un seul bail connu : iso.leaseId, rent_due_day=5
    try {
      await pool.query("UPDATE leases SET rent_due_day = 5, rent_timing = 'terme_echu' WHERE id = :id", { id: iso.leaseId });

      const result = await getPeriodClosability(iso.tenantId, '2026-03');
      // Avant le correctif : échéance calculée au 5 mars (trop tôt, un bail à terme échu paie en MARS
      // le loyer de FÉVRIER, jamais celui de mars) — `closableFrom` aurait ignoré ce bail dès le 10
      // mars (5 + marge de 5 jours), alors que son loyer de mars n'est même pas encore exigible.
      assert.equal(result.closableFrom, '2026-04-10', 'échéance réelle : 5 avril (terme échu) + 5 jours de marge');
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

test(
  "getPeriodClosability — un jour d'échéance 31 dans un mois de 28 jours résout vers une VRAIE date " +
    "(3 mars), jamais une date fictive « 31 février »",
  async () => {
    const iso = await createBareFixture();
    try {
      await pool.query("UPDATE leases SET rent_due_day = 31, rent_timing = 'avance' WHERE id = :id", { id: iso.leaseId });

      const result = await getPeriodClosability(iso.tenantId, '2026-02'); // 2026 : février a 28 jours
      // 31 février n'existe pas — Date.UTC résout naturellement vers le 3 mars (28 + 3 = 31ᵉ jour après
      // le 1er février), + 5 jours de marge = 8 mars.
      assert.equal(result.closableFrom, '2026-03-08');
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

test(
  "getPeriodClosability — parmi plusieurs baux, celui dont l'échéance RÉELLE tombe le plus tard " +
    "l'emporte, même si son jour du mois est numériquement plus PETIT (terme échu vs avance)",
  async () => {
    const iso = await createBareFixture(); // bail A (déjà présent) : jour 5 par défaut
    try {
      const leaseB = await insertActiveLease(iso, { unitCode: 'U2', depositAmount: 0 });
      // A : avance, jour 25 (échéance réelle : 25 mars). B : terme échu, jour 5 (échéance réelle : 5
      // AVRIL — pourtant "5" < "25"). B doit l'emporter malgré son jour numériquement plus petit.
      await pool.query("UPDATE leases SET rent_due_day = 25, rent_timing = 'avance' WHERE id = :id", { id: iso.leaseId });
      await pool.query("UPDATE leases SET rent_due_day = 5, rent_timing = 'terme_echu' WHERE id = :id", { id: leaseB.leaseId });

      const result = await getPeriodClosability(iso.tenantId, '2026-03');
      assert.equal(result.closableFrom, '2026-04-10'); // 5 avril + 5 jours, pas 25 mars + 5 jours (30 mars)
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

// ───────────────────────── Point 9 : clôture d'un mois FUTUR (même avec `force`) ─────────────────────────

test(
  "POST /api/accounting/periods — refuse de clôturer un mois futur, MÊME avec force:true (aucune " +
    "réouverture n'existe : une clôture par erreur bloquerait définitivement un mois qui n'a pas commencé)",
  async () => {
    const iso = await createBareFixture();
    try {
      const future = new Date();
      future.setUTCFullYear(future.getUTCFullYear() + 1);
      const futurePeriod = future.toISOString().slice(0, 7);

      const res = await fetch(`${baseUrl}/api/accounting/periods`, {
        method: 'POST',
        headers: bearer(iso.dgId, iso.tenantId),
        body: JSON.stringify({ period: futurePeriod, force: true }),
      });
      assert.equal(res.status, 400);

      const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM accounting_periods WHERE tenant_id = :t AND period = :p', {
        t: iso.tenantId,
        p: futurePeriod,
      });
      assert.equal(Number(row.n), 0);
    } finally {
      await teardown(iso.tenantId);
    }
  },
);

test('POST /api/accounting/periods — un mois déjà passé reste fermable normalement (comportement inchangé)', async () => {
  const iso = await createBareFixture();
  try {
    const res = await fetch(`${baseUrl}/api/accounting/periods`, {
      method: 'POST',
      headers: bearer(iso.dgId, iso.tenantId),
      body: JSON.stringify({ period: '2026-01', force: true }),
    });
    assert.equal(res.status, 201);
  } finally {
    // `teardown` (fixtures.js) ne nettoie pas `accounting_periods`/`lease_balance_snapshots` — jamais
    // exercé par un autre test de ce fichier jusqu'ici (celui-ci est le premier à clôturer un mois
    // pour de vrai). Sans ce nettoyage explicite, la suppression de l'utilisateur DG échoue (clé
    // étrangère `closed_by`).
    await pool.query('DELETE FROM lease_balance_snapshots WHERE tenant_id = :t', { t: iso.tenantId });
    await pool.query('DELETE FROM accounting_periods WHERE tenant_id = :t', { t: iso.tenantId });
    await teardown(iso.tenantId);
  }
});
