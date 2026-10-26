'use strict';

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createEmployeeSchema, updateEmployeeSchema, assignPropertiesSchema } = require('../validators/employee');
const { getPermissionsBulk } = require('../services/permissions');
const { PERMISSIONS, DEFAULT_PERMISSIONS_BY_ROLE } = require('../constants/permissions');
const { DEFAULT_JOB_TITLES } = require('../constants/jobTitles');
const logger = require('../utils/logger');
const employees = require('../services/employees');

const router = Router();

// Écran « Gestion des employés » : réservé au DG (section 5).
router.use(requireAuth, requireRole('dg'));

function toPublicEmployee(row, permissions) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    identifier: row.identifier,
    email: row.email,
    role: row.role,
    jobTitle: row.job_title ?? null,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    permissions,
    // Nombre de Biens attribués (étape 14) — visible seulement pour un agent ;
    // toujours 0 pour un comptable (aucune ligne `properties.agent_id` possible).
    // Affiché sur la liste pour qu'une attribution reste vérifiable sans ouvrir
    // la fiche de chaque agent un par un.
    managedPropertiesCount: row.managed_properties_count != null ? Number(row.managed_properties_count) : 0,
    createdAt: row.created_at,
  };
}

// GET /api/employees/permissions — catalogue pour construire le formulaire.
router.get('/permissions', (_req, res) => {
  res.json({ permissions: PERMISSIONS, defaultsByRole: DEFAULT_PERMISSIONS_BY_ROLE });
});

// GET /api/employees/job-titles — suggestions de postes : liste par défaut + postes ajoutés par l'entreprise.
router.get('/job-titles', async (req, res, next) => {
  try {
    res.json({ defaults: DEFAULT_JOB_TITLES, custom: await employees.listCustomJobTitles(req.user.tenantId) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees — liste des comptes comptable/agent de l'entreprise (isolation par tenant).
router.get('/', async (req, res, next) => {
  try {
    const rows = await employees.listEmployees(req.user.tenantId);
    const permsByUser = await getPermissionsBulk(rows.map((r) => r.id));
    res.json({ employees: rows.map((r) => toPublicEmployee(r, permsByUser.get(r.id) || [])) });
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id — fiche d'un employé (isolation par tenant).
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const row = await employees.findEmployee(req.user.tenantId, id);
    if (!row) throw new ApiError(404, 'Employé introuvable');
    const permsByUser = await getPermissionsBulk([id]);
    // Biens gérés : uniquement pertinent pour un agent (un comptable ne gère
    // pas de portefeuille de Biens) — toujours [] pour un comptable.
    const managedProperties = row.role === 'agent' ? await employees.loadManagedProperties(req.user.tenantId, id) : [];
    res.json({
      employee: toPublicEmployee({ ...row, managed_properties_count: managedProperties.length }, permsByUser.get(id) || []),
      managedProperties,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/properties — attribuer un ou plusieurs Biens à cet agent en une fois
// (étape 14). Un seul agent par Bien : réattribuer un Bien déjà géré par un autre agent le lui
// retire silencieusement (décision produit — pas d'ambiguïté possible sur qui gère quoi).
router.post('/:id/properties', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = assignPropertiesSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { propertyIds } = parsed.data;

  try {
    await employees.assignProperties(req.user.tenantId, id, propertyIds);
    logger.info('Biens attribués à un agent', {
      tenantId: req.user.tenantId,
      agentId: id,
      propertyIds,
      by: req.user.id,
    });
    res.status(200).json({ managedProperties: await employees.loadManagedProperties(req.user.tenantId, id) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/properties/:propertyId — retirer un Bien du
// portefeuille de cet agent (redevient non attribué, jamais supprimé).
router.delete('/:id/properties/:propertyId', async (req, res, next) => {
  const id = Number(req.params.id);
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(id) || !Number.isInteger(propertyId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    await employees.unassignProperty(req.user.tenantId, id, propertyId);
    logger.info('Bien retiré du portefeuille d\'un agent', {
      tenantId: req.user.tenantId,
      agentId: id,
      propertyId,
      by: req.user.id,
    });
    res.json({ managedProperties: await employees.loadManagedProperties(req.user.tenantId, id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees — création (section 5).
router.post('/', async (req, res, next) => {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const created = await employees.createEmployee(req.user.tenantId, req.user.id, data);
    logger.info('Employé créé', { tenantId: req.user.tenantId, employeeId: created.userId, role: data.role, by: req.user.id });

    res.status(201).json({
      employee: toPublicEmployee(
        {
          id: created.userId,
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone,
          identifier: created.identifier,
          email: data.email,
          role: data.role,
          job_title: created.jobTitle,
          status: 'active',
          must_change_password: 1,
          created_at: new Date(),
        },
        created.permissions,
      ),
      // Renvoyé UNE SEULE FOIS : seul le hash du mot de passe est conservé ensuite.
      temporaryPassword: created.temporaryPassword,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/employees/:id — modification / désactivation / permissions.
router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  if (id === req.user.id) {
    return next(new ApiError(400, 'Utilisez les paramètres de votre propre profil'));
  }

  const parsed = updateEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const { row, permissions } = await employees.updateEmployee(req.user.tenantId, req.user.id, id, parsed.data);
    logger.info('Employé modifié', { tenantId: req.user.tenantId, employeeId: id, by: req.user.id });
    res.json({ employee: toPublicEmployee(row, permissions) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id — suppression définitive (révoque aussi ses sessions par cascade FK).
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  if (id === req.user.id) return next(new ApiError(400, 'Action impossible sur votre propre compte'));

  try {
    await employees.deleteEmployee(req.user.tenantId, id);
    logger.info('Employé supprimé', { tenantId: req.user.tenantId, employeeId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
