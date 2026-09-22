'use strict';

// Étape 18 (demande directe de l'utilisateur : « quelle fonctionnalité pour
// les comptables et les agents ») — Tableau de bord « Mes tâches » :
// contrairement à `routes/dashboard.js` (réservé au DG), cette route
// s'adresse au comptable et à l'agent — les informations existent déjà
// éparpillées sur plusieurs écrans (Relances, Plaintes, Comptabilité,
// Relevés, État des lieux) ; ici on les rassemble en un seul endroit, sans
// dupliquer le calcul métier (réutilise les services déjà existants).
// Jamais pour le DG : il a son propre tableau de bord complet
// (`/espace/tableau-de-bord`) ; chaque section ne se remplit que si
// l'utilisateur a la permission correspondante (comptabilite / locataires).

const { Router } = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getPermissions } = require('../services/permissions');
const { resolvePropertyScope } = require('../services/scope');
const { listPortfolioArrears, listPredictiveLateAlerts } = require('../services/rentTracking');
const { getPeriodClosability, isPeriodClosed } = require('../services/accountingPeriods');

const router = Router();
router.use(requireAuth);

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

/** Plaintes ouvertes/en cours, dans la portée de l'agent restreint le cas échéant. */
async function listOpenComplaints(tenantId, scopeAgentId) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.title, c.priority, c.status, c.reported_at, r.first_name, r.last_name
     FROM complaints c
     JOIN leases l ON l.id = c.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN renters r ON r.id = l.renter_id
     WHERE c.tenant_id = :tenantId AND c.status IN ('ouverte', 'en_cours') ${scopeClause}
     ORDER BY c.priority = 'urgente' DESC, c.reported_at ASC
     LIMIT 20`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    priority: r.priority,
    status: r.status,
    reportedAt: isoDate(r.reported_at),
    renterName: `${r.first_name} ${r.last_name}`,
  }));
}

/** États des lieux (entrée + sortie) en brouillon, non finalisés — étape 15. */
async function listDraftInspections(tenantId, scopeAgentId) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const baseSelect = (table) => `
    SELECT t.lease_id, t.conducted_at, r.id AS renter_id, r.first_name, r.last_name, un.code AS unit_code
    FROM ${table} t
    JOIN leases l ON l.id = t.lease_id
    JOIN renters r ON r.id = l.renter_id
    JOIN property_units un ON un.id = l.unit_id
    JOIN properties p ON p.id = un.property_id
    WHERE t.tenant_id = :tenantId AND t.status = 'draft' ${scopeClause}
  `;
  const [moveIns] = await pool.query(baseSelect('move_in_reports'), params);
  const [moveOuts] = await pool.query(baseSelect('move_out_reports'), params);
  return [
    ...moveIns.map((r) => ({
      leaseId: r.lease_id,
      renterId: r.renter_id,
      kind: 'move-in',
      renterName: `${r.first_name} ${r.last_name}`,
      unitCode: r.unit_code,
      conductedAt: isoDate(r.conducted_at),
    })),
    ...moveOuts.map((r) => ({
      leaseId: r.lease_id,
      renterId: r.renter_id,
      kind: 'move-out',
      renterName: `${r.first_name} ${r.last_name}`,
      unitCode: r.unit_code,
      conductedAt: isoDate(r.conducted_at),
    })),
  ];
}

/** Relevés SONEB/SBEE en brouillon, en attente de validation — étape 9bis. */
async function listPendingBatches(tenantId) {
  const [rows] = await pool.query(
    `SELECT ub.id, ub.utility_type, ub.period_start, ub.period_end, p.code AS property_code
     FROM utility_reading_batches ub
     JOIN properties p ON p.id = ub.property_id
     WHERE ub.tenant_id = :tenantId AND ub.status = 'brouillon'
     ORDER BY ub.created_at ASC
     LIMIT 20`,
    { tenantId },
  );
  return rows.map((r) => ({
    id: r.id,
    utilityType: r.utility_type,
    periodStart: isoDate(r.period_start),
    periodEnd: isoDate(r.period_end),
    propertyCode: r.property_code,
  }));
}

/** Dépenses (non supprimées) sans justificatif joint — étape 8. */
async function listExpensesWithoutReceipt(tenantId) {
  const [rows] = await pool.query(
    `SELECT id, label, amount, expense_date
     FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND receipt_path IS NULL
     ORDER BY expense_date DESC
     LIMIT 20`,
    { tenantId },
  );
  return rows.map((r) => ({ id: r.id, label: r.label, amount: Number(r.amount), expenseDate: isoDate(r.expense_date) }));
}

/**
 * Tâches à délai assignées à CET utilisateur par le DG (nouveau — voir
 * routes/assignedTasks.js), non terminées, triées par échéance la plus
 * proche. Indépendant des permissions locataires/comptabilité : une tâche
 * libre peut porter sur n'importe quoi.
 */
async function listAssignedTasksFor(tenantId, userId) {
  const [rows] = await pool.query(
    `SELECT id, title, description, due_date
     FROM tasks_assigned
     WHERE tenant_id = :tenantId AND assigned_to = :userId AND completed_at IS NULL
     ORDER BY due_date ASC
     LIMIT 20`,
    { tenantId, userId },
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    dueDate: isoDate(r.due_date),
  }));
}

// GET /api/tasks — jamais pour le DG (son propre tableau de bord existe déjà) ;
// chaque section se remplit selon les permissions réelles de l'utilisateur.
router.get('/', async (req, res, next) => {
  try {
    const { tenantId } = req.user;
    // `req.user` (payload du JWT) ne porte pas les permissions — celles-ci
    // vivent dans `user_permissions`, jamais recopiées dans le token pour
    // rester à jour immédiatement si le DG les change (voir `requirePermission`).
    const permissions = await getPermissions(req.user.id, req.user.role);
    const hasLocataires = permissions.includes('locataires');
    const hasComptabilite = permissions.includes('comptabilite');

    let agent = null;
    if (hasLocataires) {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const [lateRenters, predictiveAlerts, openComplaints, draftInspections] = await Promise.all([
        listPortfolioArrears(tenantId, scopeAgentId),
        listPredictiveLateAlerts(tenantId, scopeAgentId),
        listOpenComplaints(tenantId, scopeAgentId),
        listDraftInspections(tenantId, scopeAgentId),
      ]);
      agent = { lateRenters, predictiveAlerts, openComplaints, draftInspections };
    }

    let accountant = null;
    if (hasComptabilite) {
      const period = currentPeriod();
      const [pendingBatches, expensesWithoutReceipt, alreadyClosed] = await Promise.all([
        listPendingBatches(tenantId),
        listExpensesWithoutReceipt(tenantId),
        isPeriodClosed(tenantId, `${period}-01`),
      ]);
      const currentMonthClosability = alreadyClosed
        ? null
        : await getPeriodClosability(tenantId, period).then((c) => ({ period, isClosable: c.isClosable }));
      accountant = { pendingBatches, expensesWithoutReceipt, currentMonthClosability };
    }

    const assignedTasks = await listAssignedTasksFor(tenantId, req.user.id);

    res.json({ agent, accountant, assignedTasks });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
