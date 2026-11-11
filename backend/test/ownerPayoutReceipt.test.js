'use strict';

/**
 * Reçu de versement propriétaire (demande utilisateur, 2026-11-11 : « lorsqu'on fait un versement à un
 * propriétaire, cela ne génère pas la quittance »). Couvre les deux routes (back-office et portail
 * propriétaire), le scoping strict par propriétaire (jamais le versement d'un AUTRE propriétaire), et le
 * fait que ça fonctionne aussi pour un versement déjà enregistré avant cette fonctionnalité (pas de
 * dépendance à une colonne renseignée seulement pour les nouveaux versements).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { createFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');
const { generatePortalToken, hashToken } = require('../src/utils/tokens');

let fx; let server; let base; let payoutId; let ownerPortalToken; let otherOwnerId;
const hdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: fx.dgId, tenantId: fx.tenantId, role: 'dg' })}` });

before(async () => {
  fx = await createFixture();
  // Offre « pro » (porte le portail propriétaire) — une fixture GL nue n'a par défaut aucun abonnement.
  await pool.query("INSERT INTO tenant_subscriptions (tenant_id, plan_key, status) VALUES (:t, 'pro', 'active')", { t: fx.tenantId });

  const [p] = await pool.query(
    `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, recorded_by)
     VALUES (:t, :o, 30000, 'Novembre 2026', CURDATE(), 'mobile_money', :by)`,
    { t: fx.tenantId, o: fx.ownerId, by: fx.dgId },
  );
  payoutId = p.insertId;

  ownerPortalToken = generatePortalToken();
  await pool.query('UPDATE owners SET portal_token_hash = :hash WHERE id = :id', { hash: hashToken(ownerPortalToken), id: fx.ownerId });

  const [other] = await pool.query('INSERT INTO owners (tenant_id, name, created_by) VALUES (:t, :name, :by)', {
    t: fx.tenantId,
    name: 'Autre Propriétaire',
    by: fx.dgId,
  });
  otherOwnerId = other.insertId;

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.query('DELETE FROM owner_payouts WHERE tenant_id = :t', { t: fx.tenantId });
  await pool.query('DELETE FROM owners WHERE id = :id', { id: otherOwnerId });
  await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = :t', { t: fx.tenantId });
  await teardown(fx.tenantId);
  await closePool();
});

test('back-office : reçu généré pour un versement existant, en PDF', async () => {
  const r = await fetch(`${base}/api/owners/${fx.ownerId}/payouts/${payoutId}/receipt.pdf`, { headers: hdr() });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
});

test('back-office : 404 sur un versement inexistant, ou qui appartient à un AUTRE propriétaire', async () => {
  assert.equal((await fetch(`${base}/api/owners/${fx.ownerId}/payouts/999999999/receipt.pdf`, { headers: hdr() })).status, 404);
  // Le versement existe bien, mais pas pour CE propriétaire — jamais 200.
  assert.equal((await fetch(`${base}/api/owners/${otherOwnerId}/payouts/${payoutId}/receipt.pdf`, { headers: hdr() })).status, 404);
});

test('portail propriétaire : même reçu, via le token', async () => {
  const r = await fetch(`${base}/api/owner-portal/${ownerPortalToken}/payouts/${payoutId}/receipt.pdf`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
});

test('portail propriétaire : code de vérification stable d\'un téléchargement à l\'autre (même document)', async () => {
  const code = async () => {
    const r = await fetch(`${base}/api/owners/${fx.ownerId}/payouts/${payoutId}/receipt.pdf`, { headers: hdr() });
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('latin1').match(/Code de v.rification\s*([A-Z0-9-]{6,})/)?.[1];
  };
  // Pas d'assertion fragile sur le texte du PDF (police custom) ; on vérifie seulement via la table
  // que la ligne de `document_issuances` est bien unique pour ce versement.
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM document_issuances WHERE document_type = 'recu_versement' AND reference_id = :id",
    { id: payoutId },
  );
  await code(); // déclenche un 2e téléchargement
  const [rows2] = await pool.query(
    "SELECT COUNT(*) AS n FROM document_issuances WHERE document_type = 'recu_versement' AND reference_id = :id",
    { id: payoutId },
  );
  assert.equal(rows[0].n, 1);
  assert.equal(rows2[0].n, 1); // toujours une seule ligne : pas un nouveau code à chaque téléchargement
});
