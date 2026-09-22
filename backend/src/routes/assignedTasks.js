'use strict';

// Tâches à délai assignées par le DG à un employé précis (demande directe
// de l'utilisateur) — distinct du tableau de bord agrégé « Mes tâches »
// (routes/tasks.js, calculé à la volée depuis d'autres modules) : ici, une
// vraie ligne en base, créée et attribuée explicitement par la direction,
// avec une date limite. Tant qu'elle n'est pas marquée terminée, elle
// s'affiche à l'employé assigné avec un décompte (aujourd'hui / reste N
// jour(s) / en retard) — voir `GET /api/tasks` (agrégation) qui l'inclut.

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createTaskSchema, updateTaskSchema } = require('../validators/assignedTasks');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function toPublicTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: isoDate(row.due_date),
    completedAt: row.completed_at,
    assignedTo: { id: row.assigned_to, firstName: row.assignee_first_name, lastName: row.assignee_last_name },
    createdBy: { firstName: row.creator_first_name, lastName: row.creator_last_name },
    createdAt: row.created_at,
  };
}

const TASK_SELECT = `
  t.id, t.title, t.description, t.due_date, t.completed_at, t.assigned_to, t.created_at,
  au.first_name AS assignee_first_name, au.last_name AS assignee_last_name,
  cu.first_name AS creator_first_name, cu.last_name AS creator_last_name
`;
const TASK_JOINS = `
  FROM tasks_assigned t
  JOIN users au ON au.id = t.assigned_to
  JOIN users cu ON cu.id = t.created_by
`;

/** Vérifie que `assignedTo` désigne bien un employé (comptable/agent) de CE tenant. */
async function assertAssigneeInTenant(tenantId, assignedTo) {
  const [rows] = await pool.query(
    `SELECT id FROM users WHERE id = :assignedTo AND tenant_id = :tenantId AND role IN ('comptable', 'agent') LIMIT 1`,
    { assignedTo, tenantId },
  );
  if (!rows[0]) throw new ApiError(400, 'Employé introuvable', { assignedTo: ['Employé introuvable'] });
}

/** Charge une tâche de CE tenant, ou lève 404. */
async function loadTask(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = :id AND t.tenant_id = :tenantId LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Tâche introuvable');
  return rows[0];
}

// GET /api/tasks/assigned — le DG voit toutes les tâches du cabinet ;
// un employé ne voit que les siennes (celles qui lui sont assignées).
router.get('/', async (req, res, next) => {
  try {
    const scopeClause = req.user.role === 'dg' ? '' : 'AND t.assigned_to = :userId';
    const [rows] = await pool.query(
      `SELECT ${TASK_SELECT} ${TASK_JOINS}
       WHERE t.tenant_id = :tenantId ${scopeClause}
       ORDER BY (t.completed_at IS NOT NULL), t.due_date ASC`,
      { tenantId: req.user.tenantId, userId: req.user.id },
    );
    res.json({ tasks: rows.map(toPublicTask) });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/assigned — DG uniquement.
router.post('/', requireRole('dg'), async (req, res, next) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    await assertAssigneeInTenant(req.user.tenantId, data.assignedTo);

    const [result] = await pool.query(
      `INSERT INTO tasks_assigned (tenant_id, title, description, assigned_to, due_date, created_by)
       VALUES (:tenantId, :title, :description, :assignedTo, :dueDate, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        title: data.title,
        description: data.description,
        assignedTo: data.assignedTo,
        dueDate: data.dueDate,
        createdBy: req.user.id,
      },
    );
    logger.info('Tâche assignée créée', { tenantId: req.user.tenantId, taskId: result.insertId, by: req.user.id });
    const row = await loadTask(req.user.tenantId, result.insertId);
    res.status(201).json({ task: toPublicTask(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/assigned/:id — DG uniquement.
router.patch('/:id', requireRole('dg'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    await loadTask(req.user.tenantId, id);
    if (data.assignedTo !== undefined) await assertAssigneeInTenant(req.user.tenantId, data.assignedTo);

    const fields = [];
    const params = { id };
    if (data.title !== undefined) { fields.push('title = :title'); params.title = data.title; }
    if (data.description !== undefined) { fields.push('description = :description'); params.description = data.description; }
    if (data.assignedTo !== undefined) { fields.push('assigned_to = :assignedTo'); params.assignedTo = data.assignedTo; }
    if (data.dueDate !== undefined) { fields.push('due_date = :dueDate'); params.dueDate = data.dueDate; }

    if (fields.length > 0) {
      await pool.query(`UPDATE tasks_assigned SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    logger.info('Tâche assignée modifiée', { tenantId: req.user.tenantId, taskId: id, by: req.user.id });
    const row = await loadTask(req.user.tenantId, id);
    res.json({ task: toPublicTask(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/assigned/:id/complete — le DG, ou l'employé à qui elle est assignée.
router.patch('/:id/complete', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const task = await loadTask(req.user.tenantId, id);
    if (req.user.role !== 'dg' && task.assigned_to !== req.user.id) {
      throw new ApiError(403, "Cette tâche n'est pas assignée à votre compte");
    }
    await pool.query(
      'UPDATE tasks_assigned SET completed_at = NOW(), completed_by = :by WHERE id = :id',
      { by: req.user.id, id },
    );
    logger.info('Tâche assignée terminée', { tenantId: req.user.tenantId, taskId: id, by: req.user.id });
    const row = await loadTask(req.user.tenantId, id);
    res.json({ task: toPublicTask(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/assigned/:id/reopen — annule une tâche marquée terminée par erreur.
router.patch('/:id/reopen', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const task = await loadTask(req.user.tenantId, id);
    if (req.user.role !== 'dg' && task.assigned_to !== req.user.id) {
      throw new ApiError(403, "Cette tâche n'est pas assignée à votre compte");
    }
    await pool.query('UPDATE tasks_assigned SET completed_at = NULL, completed_by = NULL WHERE id = :id', { id });
    const row = await loadTask(req.user.tenantId, id);
    res.json({ task: toPublicTask(row) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/assigned/:id — DG uniquement.
router.delete('/:id', requireRole('dg'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    await loadTask(req.user.tenantId, id);
    await pool.query('DELETE FROM tasks_assigned WHERE id = :id', { id });
    logger.info('Tâche assignée supprimée', { tenantId: req.user.tenantId, taskId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
