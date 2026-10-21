'use strict';

const mysql = require('mysql2/promise');
const config = require('./env');
const logger = require('../utils/logger');

// Garde-fou : un test ne tourne JAMAIS sur la base de développement (`npm test` utilise `<DB_NAME>_test`).
if (process.env.NODE_TEST_CONTEXT && !String(config.db.database).endsWith('_test') && process.env.ALLOW_TESTS_ON_DEV_DB !== '1') {
  throw new Error(`Test refusé sur la base « ${config.db.database} » : lancez « npm test » (base dédiée *_test).`);
}

/**
 * Pool de connexions MySQL partagé par toute l'application.
 * `namedPlaceholders` permet d'écrire des requêtes avec :param.
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  namedPlaceholders: true,
  charset: 'utf8mb4',
  timezone: 'Z',
  // Empêche l'exécution de plusieurs requêtes dans un même appel (anti-injection).
  multipleStatements: false,
});

/**
 * Vérifie que la base répond. Renvoie un objet de diagnostic
 * (utilisé par la route /api/health/db et le script db:check).
 */
async function pingDatabase() {
  const started = Date.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db, NOW() AS now');
    return {
      ok: true,
      latencyMs: Date.now() - started,
      serverVersion: rows[0].version,
      database: rows[0].db,
      serverTime: rows[0].now,
    };
  } finally {
    conn.release();
  }
}

async function closePool() {
  await pool.end();
  logger.info('Pool MySQL fermé');
}

module.exports = { pool, pingDatabase, closePool };
