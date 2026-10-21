'use strict';

/**
 * « Biens à vendre » (demande utilisateur, 2026-10-18) — catalogue interne des biens (maisons,
 * terrains) que le cabinet est chargé de vendre, séparé des Biens locatifs. Permission dédiée
 * `biens_a_vendre`, jamais accordée par défaut. Voir routes/saleProperties.js.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { createBareFixture, createFixture, teardown } = require('./gl/fixtures');

let fx;
let server;
let baseUrl;

// En-tête PNG minimal (`detectFileType`, utils/uploads.js) — même fixture que monthClosingAudit.test.js.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

before(async () => {
  fx = await createBareFixture();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :t)', { t: fx.tenantId });
  await pool.query('DELETE FROM sale_properties WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

const bearer = (id, tenantId, role = 'dg') => ({
  Authorization: `Bearer ${signAccessToken({ sub: id, tenantId, role })}`,
});
const jsonHeaders = (id, tenantId, role) => ({ ...bearer(id, tenantId, role), 'Content-Type': 'application/json' });

async function makeUser(tenantId, role, permissions = []) {
  const [r] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, :role, 'Awa', 'Kpakpo', :phone, 'x')",
    { t: tenantId, role, phone: `05${Math.floor(Math.random() * 100000000)}` },
  );
  for (const key of permissions) {
    await pool.query('INSERT INTO user_permissions (user_id, permission_key) VALUES (:u, :k)', { u: r.insertId, k: key });
  }
  return r.insertId;
}

test('POST /api/sale-properties — refusé (403) sans la permission biens_a_vendre, même pour un comptable/agent', async () => {
  const comptableId = await makeUser(fx.tenantId, 'comptable', ['comptabilite']);
  const res = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(comptableId, fx.tenantId, 'comptable'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain Test', price: 10000000 }),
  });
  assert.equal(res.status, 403);
});

test('POST /api/sale-properties — le DG a toujours accès, même sans permission explicite', async () => {
  const res = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain DG', price: 5000000 }),
  });
  assert.equal(res.status, 201);
});

test('POST /api/sale-properties — création minimale (sans propriétaire), statut par défaut "en_vente", aucune photo', async () => {
  const res = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain sans propriétaire', address: 'Zogbo, Cotonou', price: 15000000, surfaceM2: 500 }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.saleProperty.status, 'en_vente');
  assert.equal(body.saleProperty.owner, null);
  assert.deepEqual(body.saleProperty.photoUrls, []);
  assert.equal(body.saleProperty.price, 15000000);
  assert.equal(body.saleProperty.surfaceM2, 500);
  assert.equal(body.saleProperty.typeLabel, 'Terrain');
});

test('POST /api/sale-properties — propriétaire lié correctement renvoyé ; propriétaire inexistant → 404', async () => {
  const ok = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'villa', title: 'Villa à vendre', price: 45000000, ownerId: fx.ownerId }),
  });
  assert.equal(ok.status, 201);
  const okBody = await ok.json();
  assert.equal(okBody.saleProperty.owner.id, fx.ownerId);
  assert.equal(okBody.saleProperty.owner.name, 'Propriétaire Test');

  const bad = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'villa', title: 'Villa orpheline', price: 1000, ownerId: 999999 }),
  });
  assert.equal(bad.status, 404);
});

test('GET /api/sale-properties — liste, filtre par statut et par recherche texte', async () => {
  const list = await fetch(`${baseUrl}/api/sale-properties`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.ok(body.saleProperties.length >= 3);

  const byStatus = await fetch(`${baseUrl}/api/sale-properties?status=en_vente`, { headers: bearer(fx.dgId, fx.tenantId) });
  const byStatusBody = await byStatus.json();
  assert.ok(byStatusBody.saleProperties.every((s) => s.status === 'en_vente'));

  const byQuery = await fetch(`${baseUrl}/api/sale-properties?q=Zogbo`, { headers: bearer(fx.dgId, fx.tenantId) });
  const byQueryBody = await byQuery.json();
  assert.ok(byQueryBody.saleProperties.length >= 1);
  assert.ok(byQueryBody.saleProperties.every((s) => s.address?.includes('Zogbo')));
});

test('PATCH /api/sale-properties/:id — mise à jour partielle (prix, statut), updatedBy/updatedAt renseignés', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'maison_simple', title: 'À corriger', price: 1000000 }),
  });
  const { saleProperty } = await created.json();
  assert.equal(saleProperty.updatedBy, null);

  const patched = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ price: 1200000, status: 'en_negociation' }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = await patched.json();
  assert.equal(patchedBody.saleProperty.price, 1200000);
  assert.equal(patchedBody.saleProperty.status, 'en_negociation');
  assert.equal(patchedBody.saleProperty.title, 'À corriger', 'titre inchangé, non envoyé dans ce PATCH');
  assert.ok(patchedBody.saleProperty.updatedBy, 'updatedBy doit maintenant être renseigné');
  assert.ok(patchedBody.saleProperty.updatedAt);
});

test('Photos — ajout (jusqu’au plafond), retrait par index, fichier réellement supprimé du disque', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Avec photos', price: 2000000 }),
  });
  const { saleProperty } = await created.json();

  const form = new FormData();
  form.append('photos', new Blob([PNG_BYTES], { type: 'image/png' }), 'p1.png');
  form.append('photos', new Blob([PNG_BYTES], { type: 'image/png' }), 'p2.png');
  const uploaded = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/photos`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId, 'dg'),
    body: form,
  });
  assert.equal(uploaded.status, 200);
  const uploadedBody = await uploaded.json();
  assert.equal(uploadedBody.saleProperty.photoUrls.length, 2);
  assert.ok(uploadedBody.saleProperty.photoUrls[0].startsWith('/api/files/'));

  // Plafond : 6 déjà + 1 de plus dépasserait MAX_PHOTOS=6 — ici 2 présentes, 5 de plus tiennent tout
  // juste (7 total refusé).
  const tooMany = new FormData();
  for (let i = 0; i < 5; i += 1) tooMany.append('photos', new Blob([PNG_BYTES], { type: 'image/png' }), `extra-${i}.png`);
  const overLimit = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/photos`, {
    method: 'POST',
    headers: bearer(fx.dgId, fx.tenantId, 'dg'),
    body: tooMany,
  });
  // 2 déjà + 5 = 7 > 6 → refusé.
  assert.equal(overLimit.status, 400);

  // Retrait de la première photo — vérifie que le FICHIER physique disparaît vraiment.
  const path = require('path');
  const fs = require('fs/promises');
  const firstRel = uploadedBody.saleProperty.photoUrls[0].replace('/api/files/', '');
  const firstAbsPath = path.join(__dirname, '../uploads', firstRel);
  await fs.access(firstAbsPath); // n'échoue pas : le fichier existe bien avant suppression

  const removed = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/photos/0`, {
    method: 'DELETE',
    headers: bearer(fx.dgId, fx.tenantId, 'dg'),
  });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.equal(removedBody.saleProperty.photoUrls.length, 1);

  await assert.rejects(() => fs.access(firstAbsPath), 'le fichier doit avoir été supprimé du disque');
});

test('DELETE /api/sale-properties/:id — suppression logique avec motif obligatoire ; disparaît ensuite de la liste/fiche', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'autre', title: 'Fiche créée par erreur', price: 999 }),
  });
  const { saleProperty } = await created.json();

  const tooShort = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}`, {
    method: 'DELETE',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ reason: 'x' }),
  });
  assert.equal(tooShort.status, 400);

  const ok = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}`, {
    method: 'DELETE',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ reason: 'Doublon de saisie' }),
  });
  assert.equal(ok.status, 204);

  const getAfter = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}`, { headers: bearer(fx.dgId, fx.tenantId) });
  assert.equal(getAfter.status, 404);

  const list = await fetch(`${baseUrl}/api/sale-properties`, { headers: bearer(fx.dgId, fx.tenantId) });
  const listBody = await list.json();
  assert.ok(!listBody.saleProperties.some((s) => s.id === saleProperty.id));

  const [rows] = await pool.query('SELECT deleted_reason FROM sale_properties WHERE id = :id', { id: saleProperty.id });
  assert.equal(rows[0].deleted_reason, 'Doublon de saisie', 'la trace reste en base, jamais effacée');
});

/**
 * Bouton « Vendu » (demande utilisateur, 2026-10-18) : prix final, pourcentage de commission,
 * mode de règlement — le montant de la commission doit toujours être calculé côté serveur.
 */
test('POST /api/sale-properties/:id/mark-sold — enregistre la vente, calcule la commission côté serveur, fige le statut', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'villa', title: 'Villa à vendre (mark-sold)', price: 50000000 }),
  });
  const { saleProperty } = await created.json();

  const res = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({
      finalPrice: 48000000,
      commissionPercent: 5,
      paymentMethod: 'mobile_money',
      soldAt: '2026-06-15',
      idempotencyKey: 'mark-sold-test-key-0001',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.saleProperty.status, 'vendu');
  assert.ok(body.saleProperty.sale);
  assert.equal(body.saleProperty.sale.finalPrice, 48000000);
  assert.equal(body.saleProperty.sale.commissionPercent, 5);
  assert.equal(body.saleProperty.sale.commissionAmount, 2400000, 'calculé côté serveur : 48 000 000 × 5 %');
  assert.equal(body.saleProperty.sale.paymentMethod, 'mobile_money');
  assert.equal(body.saleProperty.sale.soldAt, '2026-06-15');
  assert.ok(body.saleProperty.sale.soldBy);
});

test('POST /api/sale-properties/:id/mark-sold — refusé (409) si déjà vendu ; PATCH refusé (409) une fois vendu', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain déjà vendu', price: 9000000 }),
  });
  const { saleProperty } = await created.json();

  const sold = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ finalPrice: 9000000, commissionPercent: 10, paymentMethod: 'especes', idempotencyKey: 'mark-sold-test-key-0002' }),
  });
  assert.equal(sold.status, 200);

  const retry = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ finalPrice: 9500000, commissionPercent: 10, paymentMethod: 'especes', idempotencyKey: 'mark-sold-test-key-0003' }),
  });
  assert.equal(retry.status, 409, 'une fiche déjà vendue ne peut pas être revendue');

  const patch = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}`, {
    method: 'PATCH',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ price: 10000000 }),
  });
  assert.equal(patch.status, 409, 'une fiche vendue est figée — plus aucun PATCH possible');
});

test('POST /api/sale-properties/:id/mark-sold — refuse un montant/pourcentage invalide (zod)', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain formulaire invalide', price: 1000000 }),
  });
  const { saleProperty } = await created.json();

  const badPercent = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ finalPrice: 1000000, commissionPercent: 150, paymentMethod: 'especes', idempotencyKey: 'mark-sold-test-key-0004' }),
  });
  assert.equal(badPercent.status, 400);

  const badPrice = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ finalPrice: 0, commissionPercent: 5, paymentMethod: 'especes', idempotencyKey: 'mark-sold-test-key-0005' }),
  });
  assert.equal(badPrice.status, 400);
});

test('POST /api/sale-properties/:id/mark-sold — refusé (403) si la période de la vente est déjà clôturée', async () => {
  const created = await fetch(`${baseUrl}/api/sale-properties`, {
    method: 'POST',
    headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
    body: JSON.stringify({ type: 'terrain', title: 'Terrain période close', price: 3000000 }),
  });
  const { saleProperty } = await created.json();

  await pool.query(
    "INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, closed_by) VALUES (:t, '2025-03', '2025-03-01', '2025-03-31', :by)",
    { t: fx.tenantId, by: fx.dgId },
  );
  try {
    const res = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
      method: 'POST',
      headers: jsonHeaders(fx.dgId, fx.tenantId, 'dg'),
      body: JSON.stringify({
        finalPrice: 3000000,
        commissionPercent: 5,
        paymentMethod: 'especes',
        soldAt: '2025-03-15',
        idempotencyKey: 'mark-sold-test-key-0006',
      }),
    });
    assert.equal(res.status, 403);
    const [[row]] = await pool.query('SELECT status FROM sale_properties WHERE id = :id', { id: saleProperty.id });
    assert.equal(row.status, 'en_vente', 'aucune modification ne doit avoir eu lieu');
  } finally {
    await pool.query("DELETE FROM accounting_periods WHERE tenant_id = :t AND period = '2025-03'", { t: fx.tenantId });
  }
});

/**
 * Comptabilité avancée (SYSCOHADA) : quand le module est actif, la commission sur vente doit
 * générer une écriture équilibrée (`vente_bien_commission_encaissee`) ; quand il est inactif
 * (cas du tenant `fx` ci-dessus, jamais activé), aucune écriture n'est générée — seule la vente
 * elle-même est enregistrée dans `sale_properties`.
 */
test('POST /api/sale-properties/:id/mark-sold — comptabilité avancée active : écriture GL équilibrée générée ; inactive : aucune écriture', async () => {
  const [[noGlEntries]] = await pool.query(
    `SELECT COUNT(*) AS n FROM gl_entries WHERE tenant_id = :t AND source_operation_type = 'vente_bien_commission_encaissee'`,
    { t: fx.tenantId },
  );
  assert.equal(Number(noGlEntries.n), 0, 'le tenant de ce fichier (fx) n\'a jamais activé la comptabilité avancée');

  const glFx = await createFixture();
  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :t', { t: glFx.tenantId });
  try {
    const created = await fetch(`${baseUrl}/api/sale-properties`, {
      method: 'POST',
      headers: jsonHeaders(glFx.dgId, glFx.tenantId, 'dg'),
      body: JSON.stringify({ type: 'villa', title: 'Villa GL active', price: 20000000 }),
    });
    const { saleProperty } = await created.json();

    const res = await fetch(`${baseUrl}/api/sale-properties/${saleProperty.id}/mark-sold`, {
      method: 'POST',
      headers: jsonHeaders(glFx.dgId, glFx.tenantId, 'dg'),
      body: JSON.stringify({
        finalPrice: 20000000,
        commissionPercent: 7,
        paymentMethod: 'virement',
        soldAt: '2026-03-10',
        idempotencyKey: 'mark-sold-test-key-gl-0001',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saleProperty.sale.commissionAmount, 1400000);

    const [[entry]] = await pool.query(
      `SELECT id, narration FROM gl_entries
       WHERE tenant_id = :t AND source_operation_type = 'vente_bien_commission_encaissee' AND source_id = :saleId LIMIT 1`,
      { t: glFx.tenantId, saleId: saleProperty.id },
    );
    assert.ok(entry, 'une écriture comptable doit avoir été générée');
    assert.match(entry.narration, /Villa GL active/);

    const [lines] = await pool.query('SELECT side, amount FROM gl_entry_lines WHERE entry_id = :id', { id: entry.id });
    const debit = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + Number(l.amount), 0);
    const credit = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + Number(l.amount), 0);
    assert.equal(debit, 1400000);
    assert.equal(credit, 1400000);
  } finally {
    await pool.query('DELETE FROM sale_properties WHERE tenant_id = :t', { t: glFx.tenantId });
    await teardown(glFx.tenantId);
  }
});
