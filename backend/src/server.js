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
// Filet de sécurité multi-entreprise : certaines bibliothèques tierces (le
// décodeur PNG utilisé par PDFKit pour insérer une image dans un PDF, par ex.
// une signature ou un cachet corrompu) font échouer leur décompression via le
// callback ASYNCHRONE de zlib — cette erreur échappe à tout try/catch
// synchrone autour de `doc.image()` et devient une exception non capturée.
// Sans ce filet, UNE requête avec un fichier corrompu arrêterait l'API pour
// TOUTES les entreprises. On journalise et on continue : ce process HTTP n'a
// pas d'état mémoire partagé entre requêtes (hors le pool MySQL, qui se
// reconnecte seul), donc poursuivre est plus sûr ici que redémarrer à chaud.
process.on('uncaughtException', (err) => {
  logger.error('Exception non capturée — API maintenue en ligne', { error: err.message, stack: err.stack });
});

module.exports = server;
