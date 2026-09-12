'use strict';

const { createApp } = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');
const { pingDatabase, closePool } = require('./config/db');

const app = createApp();

const server = app.listen(config.port, async () => {
  logger.info(`API Lyko System démarrée`, { port: config.port, env: config.nodeEnv });
  try {
    const diag = await pingDatabase();
    logger.info('Connexion MySQL OK', {
      database: diag.database,
      serverVersion: diag.serverVersion,
      latencyMs: diag.latencyMs,
    });
  } catch (err) {
    logger.warn('Connexion MySQL indisponible au démarrage', { error: err.message, code: err.code });
    logger.warn('→ Vérifiez backend/.env puis lancez `npm run db:check`. L\'API reste en ligne.');
  }
});

async function shutdown(signal) {
  logger.info(`Signal ${signal} reçu — arrêt en cours`);
  server.close(async () => {
    try {
      await closePool();
    } finally {
      process.exit(0);
    }
  });
  // Filet de sécurité si close() traîne.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Rejet de promesse non géré', { reason: String(reason) });
});

module.exports = server;
