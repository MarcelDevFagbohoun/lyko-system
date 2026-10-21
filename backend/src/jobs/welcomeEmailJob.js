'use strict';

/**
 * Email de bienvenue (demande utilisateur, 2026-10-18) : envoyé ~2 minutes après la
 * vérification d'email d'un DG (`welcome_email_due_at`, posé par `POST /api/auth/verify-email`).
 * Un `setTimeout` ne survivrait pas à un redémarrage du serveur — cette tâche balaie TOUS les
 * tenants à chaque exécution (fréquente, voir `jobs/scheduler.js`) et envoie dès que l'échéance
 * est passée, peu importe combien de temps le serveur était éteint entre-temps.
 */

const { pool } = require('../config/db');
const { sendWelcomeEmail } = require('../services/email/sendEmail');
const logger = require('../utils/logger');

// `tenantIds` : uniquement pour les tests (cibler des cabinets jetables) — le planificateur
// l'appelle sans argument : tous les comptes dus, tous cabinets confondus.
async function runWelcomeEmailJob({ tenantIds = null } = {}) {
  const params = {};
  let where = "u.role = 'dg' AND u.welcome_email_due_at IS NOT NULL AND u.welcome_email_due_at <= NOW() AND u.welcome_email_sent_at IS NULL";
  if (tenantIds) {
    where += ' AND u.tenant_id IN (:tenantIds)';
    params.tenantIds = tenantIds;
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.first_name, t.company_name
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE ${where}`,
    params,
  );

  for (const row of rows) {
    try {
      await sendWelcomeEmail({ to: row.email, dgName: row.first_name, companyName: row.company_name });
      await pool.query('UPDATE users SET welcome_email_sent_at = NOW() WHERE id = :id', { id: row.id });
    } catch (err) {
      logger.error("Échec de l'envoi de l'email de bienvenue", { userId: row.id, error: err.message });
    }
  }
}

module.exports = { runWelcomeEmailJob };
