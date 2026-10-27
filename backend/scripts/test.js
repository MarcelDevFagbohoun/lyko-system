'use strict';

/**
 * Lance les tests sur une base DÉDIÉE (`<DB_NAME>_test`), jamais sur la base de développement :
 * crée la base si besoin, applique les migrations, puis exécute `node --test`.
 *   npm test                         → toute la suite
 *   npm test -- test/billing.test.js → un fichier
 */
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '..');
const base = process.env.DB_NAME || 'lyko_system';
const testDb = base.endsWith('_test') ? base : `${base}_test`;
// Les tests supposent l'abonnement non imposé (les fichiers qui testent l'abonnement l'activent eux-mêmes) :
// un SUBSCRIPTIONS_ENFORCED=true dans le .env local ferait échouer des dizaines de tests en 402.
const env = { ...process.env, DB_NAME: testDb, NODE_ENV: 'test', SUBSCRIPTIONS_ENFORCED: 'false' };

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${testDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  const mig = spawnSync('node', ['src/db/migrate.js', 'up'], { cwd: root, env, stdio: 'inherit' });
  if (mig.status !== 0) process.exit(mig.status || 1);
  const args = process.argv.slice(2);
  const run = spawnSync('node', ['--test', '--test-concurrency=1', ...args], { cwd: root, env, stdio: 'inherit' });
  process.exit(run.status ?? 1);
})().catch((e) => {
  console.error('Préparation de la base de test impossible :', e.message);
  process.exit(1);
});
