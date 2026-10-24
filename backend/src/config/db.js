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
 * Garde anti-injection « par objet » : avec `query()` (requêtes préparées côté client), mysql2 transforme un
 * paramètre qui est un OBJET en `colonne = valeur` (ex. { "id": 1 } → `id` = 1). Un JSON `{"id":{"a":1}}` non
 * validé pourrait donc modifier la requête. Aucun appel légitime de l'application ne passe d'objet simple :
 * toute valeur qui n'est pas un scalaire, une date, un tampon ou une liste de scalaires est refusée ici, pour
 * TOUTES les requêtes, même si une route oublie de valider son entrée.
 */
function isScalar(v) {
  return v === null || v === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof v) || v instanceof Date || Buffer.isBuffer(v);
}
function assertSafeSqlParams(params) {
  if (params === undefined || params === null) return;
  const values = Array.isArray(params) ? params : typeof params === 'object' ? Object.values(params) : [];
  for (const v of values) {
    if (isScalar(v)) continue;
    if (Array.isArray(v) && v.every((x) => isScalar(x) || (Array.isArray(x) && x.every(isScalar)))) continue;
    const err = new Error('Paramètre de requête invalide.');
    err.status = 400;
    throw err;
  }
}
function guardQueryMethod(target) {
  for (const name of ['query', 'execute']) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function guarded(sql, params, ...rest) {
      try {
        assertSafeSqlParams(typeof sql === 'object' && sql !== null ? sql.values : params);
      } catch (err) {
        return Promise.reject(err);
      }
      return original.call(this, sql, params, ...rest);
    };
  }
}
guardQueryMethod(pool);
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async function guardedGetConnection(...args) {
  const conn = await originalGetConnection(...args);
  if (!conn.__sqlGuarded) {
    guardQueryMethod(conn);
    conn.__sqlGuarded = true;
  }
  return conn;
};

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
