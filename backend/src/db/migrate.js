'use strict';

/**
 * Runner de migrations SQL minimal et sans dépendance.
 *
 *   node src/db/migrate.js up       → applique les migrations en attente
 *   node src/db/migrate.js status   → liste l'état des migrations
 *
 * Convention : un fichier .sql par migration dans src/db/migrations/,
 * nommé `NNN_description.sql` (ordre lexicographique = ordre d'exécution).
 * Chaque fichier est exécuté dans une transaction ; les instructions sont
 * séparées par des `;` en fin de ligne.
 */

const fs = require('fs');
const path = require('path');
const { pool, closePool } = require('../config/db');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function splitStatements(sql) {
  // Retire les lignes 100% commentaire AVANT de découper, sinon un commentaire
  // d'en-tête ferait passer toute la première instruction pour un commentaire.
  const withoutCommentLines = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return withoutCommentLines
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function getApplied(conn) {
  const [rows] = await conn.query('SELECT filename FROM _migrations ORDER BY filename');
  return new Set(rows.map((r) => r.filename));
}

async function up() {
  const conn = await pool.getConnection();
  try {
    await ensureMigrationsTable(conn);
    const applied = await getApplied(conn);
    const pending = listMigrationFiles().filter((f) => !applied.has(f));

    if (pending.length === 0) {
      logger.info('Aucune migration en attente.');
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const statements = splitStatements(sql);
      logger.info(`Application de ${file} (${statements.length} instruction(s))`);
      await conn.beginTransaction();
      try {
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query('INSERT INTO _migrations (filename) VALUES (?)', [file]);
        await conn.commit();
        logger.info(`✔ ${file}`);
      } catch (err) {
        await conn.rollback();
        throw new Error(`Échec de la migration ${file} : ${err.message}`);
      }
    }
  } finally {
    conn.release();
  }
}

async function status() {
  const conn = await pool.getConnection();
  try {
    await ensureMigrationsTable(conn);
    const applied = await getApplied(conn);
    const files = listMigrationFiles();
    if (files.length === 0) {
      logger.info('Aucun fichier de migration.');
      return;
    }
    for (const file of files) {
      process.stdout.write(`${applied.has(file) ? '[x]' : '[ ]'} ${file}\n`);
    }
  } finally {
    conn.release();
  }
}

async function main() {
  const cmd = process.argv[2] || 'up';
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'status') await status();
    else {
      process.stderr.write(`Commande inconnue : ${cmd}\nUsage : node src/db/migrate.js [up|status]\n`);
      process.exitCode = 2;
    }
  } catch (err) {
    logger.error('Migration interrompue', { error: err.message });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
