'use strict';

/**
 * Tâches planifiées (node-cron) — section 6 du cahier des charges. Démarré
 * UNE FOIS au lancement du serveur (voir server.js). Sûr en mono-instance
 * uniquement (confirmé : `compose.prod.yml` n'a pas de `replicas`, comme les
 * migrations au démarrage du conteneur, étape 12b) — sur plusieurs instances,
 * chaque processus déclencherait son propre cron, dupliquant notifications et
 * écritures. Si le déploiement passe un jour à plusieurs instances, ce
 * scheduler devra être déplacé vers un processus dédié unique.
 *
 * Heures choisies en Afrique/Porto-Novo = UTC toute l'année (pas de
 * changement d'heure au Bénin) — le serveur tourne en UTC (voir mémoire
 * projet : "DB is WAT but mislabeled UTC"), donc une heure UTC ici correspond
 * directement à l'heure locale réelle.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { runMonthlyRentDigest } = require('./monthlyRentDigest');
const { runDailyArrearsDigest } = require('./dailyArrearsDigest');
const { runBalanceAlertJob } = require('./balanceAlertJob');
const { runClosingReminderJob } = require('./closingReminderJob');
const { runUtilityAlertsJob } = require('./utilityAlertsJob');

function runSafely(label, fn) {
  return async () => {
    const startedAt = Date.now();
    try {
      await fn();
      logger.info(`Tâche planifiée terminée : ${label}`, { durationMs: Date.now() - startedAt });
    } catch (err) {
      logger.error(`Tâche planifiée en échec : ${label}`, { error: err.message, stack: err.stack });
    }
  };
}

let started = false;

function startScheduler() {
  if (started) return; // idempotent : un seul appel doit réellement programmer les tâches.
  started = true;

  // 07h05, le 1er de chaque mois — loyers attendus.
  cron.schedule('5 7 1 * *', runSafely('résumé mensuel des loyers attendus', runMonthlyRentDigest));
  // 07h00 chaque jour — relances impayés.
  cron.schedule('0 7 * * *', runSafely('liste quotidienne des relances', runDailyArrearsDigest));
  // 06h00 chaque jour — filet de sécurité balance.
  cron.schedule('0 6 * * *', runSafely('alerte de balance déséquilibrée', runBalanceAlertJob));
  // 07h10 chaque jour — rappel de clôture mensuelle.
  cron.schedule('10 7 * * *', runSafely('rappel de clôture mensuelle', runClosingReminderJob));
  // 07h20 chaque jour — alertes du suivi des charges SONEB/SBEE.
  cron.schedule('20 7 * * *', runSafely('alertes du suivi des charges SONEB/SBEE', runUtilityAlertsJob));

  logger.info('Tâches planifiées (node-cron) démarrées : 5 tâches actives');
}

module.exports = { startScheduler };
