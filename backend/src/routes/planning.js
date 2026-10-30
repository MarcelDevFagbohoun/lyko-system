'use strict';

/**
 * Planning : objectifs (OKR), tâches (Kanban + calendrier).
 * Visibilité : propriétaire OU créateur uniquement. Seul le DG peut confier du travail à quelqu'un d'autre ;
 * un employé planifie pour lui-même. Le créateur a tous les droits ; un propriétaire qui n'est pas le créateur
 * (travail confié par le DG) peut seulement avancer le statut / la valeur des résultats clés.
 */
const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth } = require('../middleware/auth');
const { isoDate } = require('../utils/dates');
const {
  createTaskSchema, updateTaskSchema, createObjectiveSchema, updateObjectiveSchema, createKeyResultSchema, updateKeyResultSchema,
} = require('../validators/planning');

const router = Router();
router.use(requireAuth);

const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(400, 'Formulaire invalide', r.error.flatten().fieldErrors);
  return r.data;
};
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'Identifiant invalide');
  return n;
};
const ROLE_LABEL = { dg: 'Directeur général', comptable: 'Comptable', agent: 'Agent' };

const USER_JOIN = `
  JOIN users ou ON ou.id = x.owner_id
  JOIN users cu ON cu.id = x.created_by`;
const USER_COLS = 'ou.first_name AS owner_first, ou.last_name AS owner_last, cu.first_name AS creator_first, cu.last_name AS creator_last';

const person = (id, first, last) => ({ id, name: `${first} ${last}`.trim() });

function toTask(r, meId) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    startDate: isoDate(r.start_date),
    dueDate: isoDate(r.due_date),
    completedAt: r.completed_at,
    objectiveId: r.objective_id,
    objectiveTitle: r.objective_title || null,
    owner: person(r.owner_id, r.owner_first, r.owner_last),
    createdBy: person(r.created_by, r.creator_first, r.creator_last),
    canEdit: r.created_by === meId,
    assignedByOther: r.created_by !== r.owner_id,
    createdAt: r.created_at,
  };
}

/** Le propriétaire demandé doit être un utilisateur actif de CE tenant ; hors DG, c'est forcément soi-même. */
async function resolveOwner(req, ownerId) {
  const owner = ownerId ?? req.user.id;
  if (owner === req.user.id) return owner;
  if (req.user.role !== 'dg') throw new ApiError(403, 'Seule la direction peut confier du travail à un collègue');
  const [rows] = await pool.query("SELECT id FROM users WHERE id = :id AND tenant_id = :t AND status = 'active' LIMIT 1", { id: owner, t: req.user.tenantId });
  if (!rows[0]) throw new ApiError(400, 'Collègue introuvable', { ownerId: ['Collègue introuvable'] });
  return owner;
}

async function assertObjectiveUsable(req, objectiveId, ownerId) {
  if (!objectiveId) return;
  const [rows] = await pool.query(
    'SELECT id, owner_id, created_by FROM planning_objectives WHERE id = :id AND tenant_id = :t LIMIT 1',
    { id: objectiveId, t: req.user.tenantId },
  );
  const o = rows[0];
  const visible = o && (o.owner_id === req.user.id || o.created_by === req.user.id);
  if (!visible) throw new ApiError(400, 'Objectif introuvable', { objectiveId: ['Objectif introuvable'] });
  if (o.owner_id !== ownerId) throw new ApiError(400, 'Cet objectif appartient à une autre personne', { objectiveId: ['Cet objectif appartient à une autre personne'] });
}

// ---------- Personnes ----------
router.get('/people', async (req, res, next) => {
  try {
    const [rows] = req.user.role === 'dg'
      ? await pool.query("SELECT id, first_name, last_name, role FROM users WHERE tenant_id = :t AND status = 'active' ORDER BY (id = :me) DESC, first_name", { t: req.user.tenantId, me: req.user.id })
      : await pool.query('SELECT id, first_name, last_name, role FROM users WHERE id = :me', { me: req.user.id });
    res.json({ people: rows.map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`.trim(), roleLabel: ROLE_LABEL[u.role], me: u.id === req.user.id })), canAssign: req.user.role === 'dg' });
  } catch (err) { next(err); }
});

// ---------- Tâches ----------
const TASK_SQL = `SELECT x.*, ${USER_COLS}, ob.title AS objective_title FROM planning_tasks x ${USER_JOIN}
  LEFT JOIN planning_objectives ob ON ob.id = x.objective_id`;

async function loadTask(req, id) {
  const [rows] = await pool.query(
    `${TASK_SQL} WHERE x.id = :id AND x.tenant_id = :t AND (x.owner_id = :me OR x.created_by = :me) LIMIT 1`,
    { id, t: req.user.tenantId, me: req.user.id },
  );
  if (!rows[0]) throw new ApiError(404, 'Tâche introuvable');
  return rows[0];
}

router.get('/tasks', async (req, res, next) => {
  try {
    const where = ['x.tenant_id = :t', '(x.owner_id = :me OR x.created_by = :me)'];
    const p = { t: req.user.tenantId, me: req.user.id };
    if (req.query.ownerId) { where.push('x.owner_id = :owner'); p.owner = idParam(req.query.ownerId); }
    if (req.query.objectiveId) { where.push('x.objective_id = :obj'); p.obj = idParam(req.query.objectiveId); }
    const [rows] = await pool.query(`${TASK_SQL} WHERE ${where.join(' AND ')} ORDER BY (x.due_date IS NULL), x.due_date, x.id LIMIT 1000`, p);
    res.json({ tasks: rows.map((r) => toTask(r, req.user.id)) });
  } catch (err) { next(err); }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const d = parse(createTaskSchema, req.body);
    const owner = await resolveOwner(req, d.ownerId);
    await assertObjectiveUsable(req, d.objectiveId, owner);
    const [ins] = await pool.query(
      `INSERT INTO planning_tasks (tenant_id, owner_id, created_by, objective_id, title, description, status, priority, start_date, due_date, completed_at)
       VALUES (:t, :owner, :me, :obj, :title, :desc, :status, :prio, :start, :due, ${d.status === 'termine' ? 'UTC_TIMESTAMP()' : 'NULL'})`,
      { t: req.user.tenantId, owner, me: req.user.id, obj: d.objectiveId || null, title: d.title, desc: d.description || null, status: d.status, prio: d.priority, start: d.startDate || null, due: d.dueDate || null },
    );
    res.status(201).json({ task: toTask(await loadTask(req, ins.insertId), req.user.id) });
  } catch (err) { next(err); }
});

router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const cur = await loadTask(req, id);
    const d = parse(updateTaskSchema, req.body);
    const isCreator = cur.created_by === req.user.id;
    if (!isCreator && Object.keys(d).some((k) => k !== 'status')) throw new ApiError(403, 'Vous pouvez seulement changer l\'avancement d\'une tâche confiée par la direction');

    const sets = []; const p = { id };
    const map = { title: 'title', description: 'description', priority: 'priority', startDate: 'start_date', dueDate: 'due_date' };
    for (const [k, col] of Object.entries(map)) {
      if (d[k] !== undefined) { sets.push(`${col} = :${k}`); p[k] = d[k] === '' ? null : d[k]; }
    }
    let owner = cur.owner_id;
    if (d.ownerId !== undefined) { owner = await resolveOwner(req, d.ownerId); sets.push('owner_id = :owner'); p.owner = owner; }
    if (d.objectiveId !== undefined || d.ownerId !== undefined) {
      const obj = d.objectiveId !== undefined ? d.objectiveId : cur.objective_id;
      await assertObjectiveUsable(req, obj, owner);
      sets.push('objective_id = :obj'); p.obj = obj || null;
    }
    if (d.status !== undefined) {
      sets.push('status = :status', d.status === 'termine' ? 'completed_at = COALESCE(completed_at, UTC_TIMESTAMP())' : 'completed_at = NULL');
      p.status = d.status;
    }
    // Cohérence des dates avec l'existant quand une seule borne change.
    const start = d.startDate !== undefined ? d.startDate : isoDate(cur.start_date);
    const due = d.dueDate !== undefined ? d.dueDate : isoDate(cur.due_date);
    if (start && due && start > due) throw new ApiError(400, 'Formulaire invalide', { dueDate: ['L\'échéance doit suivre la date de début'] });
    if (sets.length) await pool.query(`UPDATE planning_tasks SET ${sets.join(', ')} WHERE id = :id`, p);
    res.json({ task: toTask(await loadTask(req, id), req.user.id) });
  } catch (err) { next(err); }
});

router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const cur = await loadTask(req, idParam(req.params.id));
    if (cur.created_by !== req.user.id) throw new ApiError(403, 'Seul le créateur peut supprimer cette tâche');
    await pool.query('DELETE FROM planning_tasks WHERE id = :id', { id: cur.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Objectifs (OKR) ----------
const OBJ_SQL = `SELECT x.*, ${USER_COLS} FROM planning_objectives x ${USER_JOIN}`;

async function loadObjective(req, id) {
  const [rows] = await pool.query(
    `${OBJ_SQL} WHERE x.id = :id AND x.tenant_id = :t AND (x.owner_id = :me OR x.created_by = :me) LIMIT 1`,
    { id, t: req.user.tenantId, me: req.user.id },
  );
  if (!rows[0]) throw new ApiError(404, 'Objectif introuvable');
  return rows[0];
}

/** Avancement : moyenne des résultats clés (plafonnée à 100 %), à défaut part des tâches terminées. */
async function presentObjectives(req, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [krs] = await pool.query('SELECT * FROM planning_key_results WHERE objective_id IN (:ids) ORDER BY id', { ids });
  const [counts] = await pool.query(
    "SELECT objective_id, COUNT(*) AS total, SUM(status = 'termine') AS done FROM planning_tasks WHERE objective_id IN (:ids) GROUP BY objective_id",
    { ids },
  );
  return rows.map((r) => {
    const keyResults = krs.filter((k) => k.objective_id === r.id).map((k) => ({
      id: k.id, title: k.title, unit: k.unit, targetValue: Number(k.target_value), currentValue: Number(k.current_value),
      progress: Math.min(100, Math.round((Number(k.current_value) / Number(k.target_value)) * 100)),
    }));
    const c = counts.find((x) => x.objective_id === r.id);
    const tasksTotal = Number(c?.total || 0); const tasksDone = Number(c?.done || 0);
    const progress = keyResults.length
      ? Math.round(keyResults.reduce((s, k) => s + k.progress, 0) / keyResults.length)
      : (tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0);
    return {
      id: r.id, title: r.title, description: r.description, startDate: isoDate(r.start_date), endDate: isoDate(r.end_date),
      owner: person(r.owner_id, r.owner_first, r.owner_last), createdBy: person(r.created_by, r.creator_first, r.creator_last),
      canEdit: r.created_by === req.user.id, keyResults, tasksTotal, tasksDone, progress,
    };
  });
}

router.get('/objectives', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `${OBJ_SQL} WHERE x.tenant_id = :t AND (x.owner_id = :me OR x.created_by = :me) ORDER BY x.end_date DESC, x.id DESC LIMIT 200`,
      { t: req.user.tenantId, me: req.user.id },
    );
    res.json({ objectives: await presentObjectives(req, rows) });
  } catch (err) { next(err); }
});

router.post('/objectives', async (req, res, next) => {
  try {
    const d = parse(createObjectiveSchema, req.body);
    const owner = await resolveOwner(req, d.ownerId);
    const [ins] = await pool.query(
      'INSERT INTO planning_objectives (tenant_id, owner_id, created_by, title, description, start_date, end_date) VALUES (:t, :owner, :me, :title, :desc, :s, :e)',
      { t: req.user.tenantId, owner, me: req.user.id, title: d.title, desc: d.description || null, s: d.startDate, e: d.endDate },
    );
    res.status(201).json({ objective: (await presentObjectives(req, [await loadObjective(req, ins.insertId)]))[0] });
  } catch (err) { next(err); }
});

router.patch('/objectives/:id', async (req, res, next) => {
  try {
    const cur = await loadObjective(req, idParam(req.params.id));
    if (cur.created_by !== req.user.id) throw new ApiError(403, 'Seul le créateur peut modifier cet objectif');
    const d = parse(updateObjectiveSchema, req.body);
    const s = d.startDate ?? isoDate(cur.start_date); const e = d.endDate ?? isoDate(cur.end_date);
    if (s > e) throw new ApiError(400, 'Formulaire invalide', { endDate: ['La fin doit suivre le début'] });
    const sets = []; const p = { id: cur.id };
    for (const [k, col] of Object.entries({ title: 'title', description: 'description', startDate: 'start_date', endDate: 'end_date' })) {
      if (d[k] !== undefined) { sets.push(`${col} = :${k}`); p[k] = d[k] === '' ? null : d[k]; }
    }
    if (d.ownerId !== undefined && d.ownerId !== cur.owner_id) {
      const owner = await resolveOwner(req, d.ownerId);
      sets.push('owner_id = :owner'); p.owner = owner;
      // Les tâches rattachées suivent le nouveau propriétaire pour rester cohérentes.
      await pool.query('UPDATE planning_tasks SET objective_id = NULL WHERE objective_id = :id AND owner_id <> :owner', { id: cur.id, owner });
    }
    if (sets.length) await pool.query(`UPDATE planning_objectives SET ${sets.join(', ')} WHERE id = :id`, p);
    res.json({ objective: (await presentObjectives(req, [await loadObjective(req, cur.id)]))[0] });
  } catch (err) { next(err); }
});

router.delete('/objectives/:id', async (req, res, next) => {
  try {
    const cur = await loadObjective(req, idParam(req.params.id));
    if (cur.created_by !== req.user.id) throw new ApiError(403, 'Seul le créateur peut supprimer cet objectif');
    await pool.query('DELETE FROM planning_objectives WHERE id = :id', { id: cur.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Résultats clés ----------
router.post('/objectives/:id/key-results', async (req, res, next) => {
  try {
    const obj = await loadObjective(req, idParam(req.params.id));
    if (obj.created_by !== req.user.id) throw new ApiError(403, 'Seul le créateur peut ajouter un résultat clé');
    const d = parse(createKeyResultSchema, req.body);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM planning_key_results WHERE objective_id = :id', { id: obj.id });
    if (n >= 10) throw new ApiError(400, 'Dix résultats clés maximum par objectif');
    await pool.query(
      'INSERT INTO planning_key_results (tenant_id, objective_id, title, unit, target_value, current_value) VALUES (:t, :o, :title, :unit, :target, :cur)',
      { t: req.user.tenantId, o: obj.id, title: d.title, unit: d.unit || null, target: d.targetValue, cur: d.currentValue ?? 0 },
    );
    res.status(201).json({ objective: (await presentObjectives(req, [await loadObjective(req, obj.id)]))[0] });
  } catch (err) { next(err); }
});

async function loadKeyResult(req) {
  const [rows] = await pool.query('SELECT * FROM planning_key_results WHERE id = :id AND tenant_id = :t LIMIT 1', { id: idParam(req.params.id), t: req.user.tenantId });
  if (!rows[0]) throw new ApiError(404, 'Résultat clé introuvable');
  return { kr: rows[0], obj: await loadObjective(req, rows[0].objective_id) };
}

router.patch('/key-results/:id', async (req, res, next) => {
  try {
    const { kr, obj } = await loadKeyResult(req);
    const d = parse(updateKeyResultSchema, req.body);
    const isCreator = obj.created_by === req.user.id;
    if (!isCreator && Object.keys(d).some((k) => k !== 'currentValue')) throw new ApiError(403, 'Vous pouvez seulement mettre à jour la valeur actuelle');
    const sets = []; const p = { id: kr.id };
    for (const [k, col] of Object.entries({ title: 'title', unit: 'unit', targetValue: 'target_value', currentValue: 'current_value' })) {
      if (d[k] !== undefined) { sets.push(`${col} = :${k}`); p[k] = d[k] === '' ? null : d[k]; }
    }
    if (sets.length) await pool.query(`UPDATE planning_key_results SET ${sets.join(', ')} WHERE id = :id`, p);
    res.json({ objective: (await presentObjectives(req, [await loadObjective(req, obj.id)]))[0] });
  } catch (err) { next(err); }
});

router.delete('/key-results/:id', async (req, res, next) => {
  try {
    const { kr, obj } = await loadKeyResult(req);
    if (obj.created_by !== req.user.id) throw new ApiError(403, 'Seul le créateur peut supprimer un résultat clé');
    await pool.query('DELETE FROM planning_key_results WHERE id = :id', { id: kr.id });
    res.json({ objective: (await presentObjectives(req, [await loadObjective(req, obj.id)]))[0] });
  } catch (err) { next(err); }
});

module.exports = router;
