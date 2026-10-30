'use strict';

/**
 * Audit sécurité (2026-10-30, point 6) : le ralentisseur de connexion par compte doit survivre à un
 * redémarrage du process — vérifié ici en le pilotant directement (pas de process à relancer dans un
 * test), par un contrôle plus fort : la table `login_throttle` elle-même contient l'état attendu entre
 * deux appels, jamais une variable JS du process courant.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, closePool } = require('../src/config/db');
const { assertNotLocked, recordFailure, recordSuccess } = require('../src/middleware/loginThrottle');

const KEY = `test:loginThrottle:${Date.now()}:${Math.random()}`;

after(async () => {
  await pool.query('DELETE FROM login_throttle WHERE throttle_key = :key', { key: KEY });
  await closePool();
});

test('persisté en base (pas en mémoire du process) : une ligne apparaît dans login_throttle', async () => {
  await recordFailure(KEY);
  const [rows] = await pool.query('SELECT failures FROM login_throttle WHERE throttle_key = :key', { key: KEY });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].failures, 1);
});

test('8 échecs rapprochés verrouillent le compte (429), un succès le réinitialise', async () => {
  const key = `${KEY}:lock`;
  await assertNotLocked(key); // pas encore d'échec : rien ne doit lever

  for (let i = 0; i < 7; i += 1) await recordFailure(key);
  await assertNotLocked(key); // 7 échecs : toujours sous le seuil

  await recordFailure(key); // 8e échec : verrouille
  await assert.rejects(() => assertNotLocked(key), (err) => {
    assert.equal(err.status, 429);
    return true;
  });

  // Le verrou vit en base, visible même « depuis un autre process » : une nouvelle lecture le voit aussi.
  const [rows] = await pool.query('SELECT locked_until FROM login_throttle WHERE throttle_key = :key', { key });
  assert.ok(rows[0].locked_until, 'locked_until doit être posé en base');
  assert.ok(new Date(rows[0].locked_until).getTime() > Date.now());

  // Une connexion réussie (après déblocage par exemple) efface complètement la ligne.
  await recordSuccess(key);
  const [after1] = await pool.query('SELECT * FROM login_throttle WHERE throttle_key = :key', { key });
  assert.equal(after1.length, 0);
  await assertNotLocked(key); // ne doit plus lever
});
