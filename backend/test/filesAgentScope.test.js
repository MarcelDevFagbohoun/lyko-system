'use strict';

/**
 * Audit sécurité (2026-10-30) : un agent restreint à un sous-ensemble du portefeuille ne doit pouvoir
 * télécharger AUCUN fichier (photo de Bien, état des lieux, plainte) rattaché à un Bien qui ne lui est
 * pas attribué, même en connaissant l'URL exacte — voir `routes/files.js`.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { pool, closePool } = require('../src/config/db');
const { createBareFixture, teardown } = require('./gl/fixtures');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/utils/jwt');

// PNG 1x1 valide (signature + IHDR minimal) — suffisant pour `detectFileType`/`sendFile`, pas besoin
// d'une vraie image pour ce test (on ne vérifie que l'autorisation d'accès, jamais le contenu).
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

let fx; let server; let base; let agentA; let agentB; let propertyB; let unitB; let leaseB; let complaintB;
const UPLOADS_ROOT = path.join(__dirname, '../uploads');
const tok = (id, role) => ({ Authorization: `Bearer ${signAccessToken({ sub: id, tenantId: fx.tenantId, role })}` });

async function writeFixtureFile(relPath) {
  const abs = path.join(UPLOADS_ROOT, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, PNG_1X1);
  return relPath;
}

before(async () => {
  fx = await createBareFixture();

  const [u1] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'A', :p, 'x')",
    { t: fx.tenantId, p: `04${Math.floor(Math.random() * 100000000)}` },
  );
  agentA = u1.insertId;
  const [u2] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'B', :p, 'x')",
    { t: fx.tenantId, p: `04${Math.floor(Math.random() * 100000000)}` },
  );
  agentB = u2.insertId;

  // Bien A (de la fixture) attribué à agentA.
  await pool.query('UPDATE properties SET agent_id = :a WHERE id = :id', { a: agentA, id: fx.propertyId });

  // Bien B, attribué à agentB, avec son unité, son bail et sa plainte.
  const [p] = await pool.query(
    "INSERT INTO properties (tenant_id, code, owner_id, address, agent_id, created_by) VALUES (:t, 'GLT-002', :o, 'Adresse B', :a, :by)",
    { t: fx.tenantId, o: fx.ownerId, a: agentB, by: fx.dgId },
  );
  propertyB = p.insertId;
  await pool.query(
    "INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on) VALUES (:t, :p, :o, '2020-01-01')",
    { t: fx.tenantId, p: propertyB, o: fx.ownerId },
  );
  const [u] = await pool.query(
    "INSERT INTO property_units (tenant_id, property_id, code, designation, status, monthly_rent, created_by) VALUES (:t, :p, 'U2', 'studio', 'loue', 50000, :by)",
    { t: fx.tenantId, p: propertyB, by: fx.dgId },
  );
  unitB = u.insertId;
  const [r] = await pool.query(
    "INSERT INTO renters (tenant_id, first_name, last_name, phone, created_by) VALUES (:t, 'Locataire', 'B', :ph, :by)",
    { t: fx.tenantId, ph: `05${Math.floor(Math.random() * 100000000)}`, by: fx.dgId },
  );
  const [l] = await pool.query(
    "INSERT INTO leases (tenant_id, renter_id, unit_id, start_date, monthly_rent, rent_due_day, deposit_amount, status, created_by) VALUES (:t, :r, :u, '2026-01-01', 50000, 5, 50000, 'active', :by)",
    { t: fx.tenantId, r: r.insertId, u: unitB, by: fx.dgId },
  );
  leaseB = l.insertId;
  const [c] = await pool.query(
    "INSERT INTO complaints (tenant_id, lease_id, code, title, reported_at, created_by) VALUES (:t, :l, 'PLT-002', 'Fuite', CURDATE(), :by)",
    { t: fx.tenantId, l: leaseB, by: fx.dgId },
  );
  complaintB = c.insertId;

  // Une plainte sur le bail A (de la fixture), pour tester l'accès autorisé côté agentA.
  await pool.query(
    "INSERT INTO complaints (tenant_id, lease_id, code, title, reported_at, created_by) VALUES (:t, :l, 'PLT-001', 'Robinet', CURDATE(), :by)",
    { t: fx.tenantId, l: fx.leaseId, by: fx.dgId },
  );
  const [[complaintA]] = await pool.query('SELECT id FROM complaints WHERE lease_id = :l LIMIT 1', { l: fx.leaseId });
  fx.complaintId = complaintA.id;

  await writeFixtureFile(`tenants/${fx.tenantId}/properties/${fx.propertyId}/photo-a.png`);
  await writeFixtureFile(`tenants/${fx.tenantId}/properties/${propertyB}/photo-b.png`);
  await writeFixtureFile(`tenants/${fx.tenantId}/inspections/${fx.leaseId}/edl-a.png`);
  await writeFixtureFile(`tenants/${fx.tenantId}/inspections/${leaseB}/edl-b.png`);
  await writeFixtureFile(`tenants/${fx.tenantId}/complaints/${fx.complaintId}/plainte-a.png`);
  await writeFixtureFile(`tenants/${fx.tenantId}/complaints/${complaintB}/plainte-b.png`);

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fs.rm(path.join(UPLOADS_ROOT, `tenants/${fx.tenantId}`), { recursive: true, force: true });
  await teardown(fx.tenantId);
  await closePool();
});

test('un agent restreint accède aux fichiers de SES Biens, jamais à ceux des autres', async () => {
  const get = (p, who) => fetch(`${base}/api/files/${p}`, { headers: tok(who, 'agent') });

  assert.equal((await get(`tenants/${fx.tenantId}/properties/${fx.propertyId}/photo-a.png`, agentA)).status, 200);
  assert.equal((await get(`tenants/${fx.tenantId}/properties/${propertyB}/photo-b.png`, agentA)).status, 404);

  assert.equal((await get(`tenants/${fx.tenantId}/inspections/${fx.leaseId}/edl-a.png`, agentA)).status, 200);
  assert.equal((await get(`tenants/${fx.tenantId}/inspections/${leaseB}/edl-b.png`, agentA)).status, 404);

  assert.equal((await get(`tenants/${fx.tenantId}/complaints/${fx.complaintId}/plainte-a.png`, agentA)).status, 200);
  assert.equal((await get(`tenants/${fx.tenantId}/complaints/${complaintB}/plainte-b.png`, agentA)).status, 404);

  // Symétrique pour agentB.
  assert.equal((await get(`tenants/${fx.tenantId}/properties/${propertyB}/photo-b.png`, agentB)).status, 200);
  assert.equal((await get(`tenants/${fx.tenantId}/properties/${fx.propertyId}/photo-a.png`, agentB)).status, 404);
});

test('le DG (accès complet) voit tous les Biens ; un agent sans portefeuille attribué aussi (comportement existant)', async () => {
  const get = (p, who, role) => fetch(`${base}/api/files/${p}`, { headers: tok(who, role) });

  assert.equal((await get(`tenants/${fx.tenantId}/properties/${fx.propertyId}/photo-a.png`, fx.dgId, 'dg')).status, 200);
  assert.equal((await get(`tenants/${fx.tenantId}/properties/${propertyB}/photo-b.png`, fx.dgId, 'dg')).status, 200);

  const [u3] = await pool.query(
    "INSERT INTO users (tenant_id, role, first_name, last_name, phone, password_hash) VALUES (:t, 'agent', 'Agent', 'Libre', :p, 'x')",
    { t: fx.tenantId, p: `04${Math.floor(Math.random() * 100000000)}` },
  );
  assert.equal((await get(`tenants/${fx.tenantId}/properties/${fx.propertyId}/photo-a.png`, u3.insertId, 'agent')).status, 200);
});

test('les catégories hors portefeuille (ex. inexistante) ne sont pas bloquées par le contrôle agent', async () => {
  // Chemin bien formé, catégorie non reconnue : pas d'erreur serveur, simplement 404 (fichier absent).
  const r = await fetch(`${base}/api/files/tenants/${fx.tenantId}/employees/${agentA}/avatar-x.png`, { headers: tok(agentA, 'agent') });
  assert.equal(r.status, 404);
});
