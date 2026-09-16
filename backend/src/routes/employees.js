'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createEmployeeSchema, updateEmployeeSchema, assignPropertiesSchema } = require('../validators/employee');
const { hashPassword, generateTemporaryPassword } = require('../utils/password');
const { generateIdentifier } = require('../utils/identifier');
const { getPermissionsBulk } = require('../services/permissions');
const { PERMISSIONS, DEFAULT_PERMISSIONS_BY_ROLE } = require('../constants/permissions');
const logger = require('../utils/logger');

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

/** Génère un identifiant de connexion garanti unique (quelques tentatives suffisent en pratique). */
async function generateUniqueIdentifier(conn) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateIdentifier();
    const [rows] = await conn.query('SELECT id FROM users WHERE identifier = :id LIMIT 1', {
      id: candidate,
    });
    if (rows.length === 0) return candidate;
  }
  throw new ApiError(500, "Impossible de générer un identifiant unique, réessayez.");
}

// GET /api/employees/permissions — catalogue pour construire le formulaire.
router.get('/permissions', (_req, res) => {
  res.json({ permissions: PERMISSIONS, defaultsByRole: DEFAULT_PERMISSIONS_BY_ROLE });
});

// GET /api/employees — liste des comptes comptable/agent de l'entreprise (isolation par tenant).
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.*, mp.managed_properties_count
       FROM users u
       LEFT JOIN (
         SELECT agent_id, COUNT(*) AS managed_properties_count
         FROM properties WHERE tenant_id = :tenantId AND agent_id IS NOT NULL
         GROUP BY agent_id
       ) mp ON mp.agent_id = u.id
       WHERE u.tenant_id = :tenantId AND u.role IN ('comptable','agent')
       ORDER BY u.created_at DESC`,
      { tenantId: req.user.tenantId },
    );
    const permsByUser = await getPermissionsBulk(rows.map((r) => r.id));
    res.json({ employees: rows.map((r) => toPublicEmployee(r, permsByUser.get(r.id) || [])) });
  } catch (err) {
    next(err);
  }
});

/** Biens actuellement attribués à un agent (étape 14), pour sa fiche. */
async function loadManagedProperties(tenantId, agentId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.address, p.agent_assigned_at, o.name AS owner_name
     FROM properties p JOIN owners o ON o.id = p.owner_id
     WHERE p.tenant_id = :tenantId AND p.agent_id = :agentId
     ORDER BY p.code`,
    { tenantId, agentId },
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    address: r.address,
    ownerName: r.owner_name,
    assignedAt: r.agent_assigned_at,
  }));
}

// GET /api/employees/:id — fiche d'un employé (isolation par tenant).
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE id = :id AND tenant_id = :tenantId AND role IN ('comptable','agent') LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Employé introuvable');
    const permsByUser = await getPermissionsBulk([id]);
    // Biens gérés : uniquement pertinent pour un agent (un comptable ne gère
    // pas de portefeuille de Biens) — toujours [] pour un comptable.
    const managedProperties = rows[0].role === 'agent' ? await loadManagedProperties(req.user.tenantId, id) : [];
    res.json({
      employee: toPublicEmployee({ ...rows[0], managed_properties_count: managedProperties.length }, permsByUser.get(id) || []),
      managedProperties,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/properties — attribuer un ou plusieurs Biens à cet
// agent en une fois (« ajouter un nombre donné de Biens à un agent pour la
// gestion », étape 14). Un seul agent par Bien : réattribuer un Bien déjà
// géré par un autre agent le lui retire silencieusement (décision produit —
// pas d'ambiguïté possible sur qui gère quoi).
router.post('/:id/properties', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = assignPropertiesSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const { propertyIds } = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [empRows] = await conn.query(
      `SELECT id FROM users WHERE id = :id AND tenant_id = :tenantId AND role = 'agent' LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!empRows[0]) throw new ApiError(404, "Agent introuvable (seul un agent peut recevoir des Biens attribués)");

    const placeholders = propertyIds.map(() => '?').join(',');
    const [propRows] = await conn.query(
      `SELECT id FROM properties WHERE tenant_id = ? AND id IN (${placeholders})`,
      [req.user.tenantId, ...propertyIds],
    );
    if (propRows.length !== propertyIds.length) {
      throw new ApiError(404, 'Un ou plusieurs Biens sont introuvables');
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE properties SET agent_id = ?, agent_assigned_at = NOW() WHERE tenant_id = ? AND id IN (${placeholders})`,
      [id, req.user.tenantId, ...propertyIds],
    );
    await conn.commit();

    logger.info('Biens attribués à un agent', {
      tenantId: req.user.tenantId,
      agentId: id,
      propertyIds,
      by: req.user.id,
    });
    res.status(200).json({ managedProperties: await loadManagedProperties(req.user.tenantId, id) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
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
    const [result] = await pool.query(
      `UPDATE properties SET agent_id = NULL, agent_assigned_at = NULL
       WHERE id = :propertyId AND tenant_id = :tenantId AND agent_id = :agentId`,
      { propertyId, tenantId: req.user.tenantId, agentId: id },
    );
    if (result.affectedRows === 0) throw new ApiError(404, 'Ce Bien n\'est pas géré par cet agent');

    logger.info('Bien retiré du portefeuille d\'un agent', {
      tenantId: req.user.tenantId,
      agentId: id,
      propertyId,
      by: req.user.id,
    });
    res.json({ managedProperties: await loadManagedProperties(req.user.tenantId, id) });
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

  const conn = await pool.getConnection();
  try {
    const [existingPhone] = await conn.query('SELECT id FROM users WHERE phone = :phone LIMIT 1', {
      phone: data.phone,
    });
    if (existingPhone.length > 0) throw new ApiError(409, 'Ce numéro est déjà associé à un compte');

    if (data.email) {
      const [existingEmail] = await conn.query('SELECT id FROM users WHERE email = :email LIMIT 1', {
        email: data.email,
      });
      if (existingEmail.length > 0) throw new ApiError(409, 'Cet email est déjà associé à un compte');
    }

    // Identifiant de connexion et mot de passe temporaire : toujours générés
    // automatiquement (le DG ne les saisit pas).
    const identifier = await generateUniqueIdentifier(conn);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    // Respecter exactement le choix du DG, y compris « aucune permission »
    // délibérément décochée. Le formulaire pré-coche déjà les permissions par
    // défaut du rôle côté frontend (voir PermissionPicker) : `data.permissions`
    // reflète donc toujours son intention réelle. Retomber sur les valeurs
    // par défaut ici écraserait silencieusement un choix explicite de tout
    // décocher — c'était le bug : un agent créé sans aucune permission
    // recevait quand même `locataires` par défaut.
    const permissions = data.permissions;

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO users (tenant_id, first_name, last_name, phone, identifier, email, password_hash, role, must_change_password)
       VALUES (:tenantId, :firstName, :lastName, :phone, :identifier, :email, :passwordHash, :role, 1)`,
      {
        tenantId: req.user.tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        identifier,
        email: data.email,
        passwordHash,
        role: data.role,
      },
    );
    const userId = result.insertId;

    for (const key of permissions) {
      await conn.query('INSERT INTO user_permissions (user_id, permission_key) VALUES (:userId, :key)', {
        userId,
        key,
      });
    }

    await conn.commit();

    logger.info('Employé créé', { tenantId: req.user.tenantId, employeeId: userId, role: data.role, by: req.user.id });

    res.status(201).json({
      employee: toPublicEmployee(
        {
          id: userId,
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone,
          identifier,
          email: data.email,
          role: data.role,
          status: 'active',
          must_change_password: 1,
          created_at: new Date(),
        },
        permissions,
      ),
      // Renvoyé UNE SEULE FOIS : seul le hash du mot de passe est conservé ensuite.
      temporaryPassword,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
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
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT * FROM users WHERE id = :id AND tenant_id = :tenantId AND role IN ('comptable','agent') LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Employé introuvable');

    if (data.email) {
      const [dupe] = await conn.query('SELECT id FROM users WHERE email = :email AND id != :id LIMIT 1', {
        email: data.email,
        id,
      });
      if (dupe.length > 0) throw new ApiError(409, 'Cet email est déjà associé à un compte');
    }

    await conn.beginTransaction();

    const fields = [];
    const params = { id };
    if (data.firstName !== undefined) {
      fields.push('first_name = :firstName');
      params.firstName = data.firstName;
    }
    if (data.lastName !== undefined) {
      fields.push('last_name = :lastName');
      params.lastName = data.lastName;
    }
    if (data.email !== undefined) {
      fields.push('email = :email');
      params.email = data.email;
    }
    if (data.role !== undefined) {
      fields.push('role = :role');
      params.role = data.role;
    }
    if (data.status !== undefined) {
      fields.push('status = :status');
      params.status = data.status;
    }
    if (fields.length > 0) {
      await conn.query(`UPDATE users SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    if (data.permissions !== undefined) {
      await conn.query('DELETE FROM user_permissions WHERE user_id = :id', { id });
      for (const key of data.permissions) {
        await conn.query('INSERT INTO user_permissions (user_id, permission_key) VALUES (:id, :key)', {
          id,
          key,
        });
      }
    }

    // Désactivation : révoque immédiatement toutes les sessions en cours.
    if (data.status === 'disabled') {
      await conn.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = :id AND revoked_at IS NULL',
        { id },
      );
    }

    await conn.commit();

    const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = :id', { id });
    const [permRows] = await pool.query(
      'SELECT permission_key FROM user_permissions WHERE user_id = :id',
      { id },
    );

    logger.info('Employé modifié', { tenantId: req.user.tenantId, employeeId: id, by: req.user.id });
    res.json({ employee: toPublicEmployee(updatedRows[0], permRows.map((p) => p.permission_key)) });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/employees/:id — suppression définitive (révoque aussi ses sessions par cascade FK).
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  if (id === req.user.id) return next(new ApiError(400, 'Action impossible sur votre propre compte'));

  try {
    const [result] = await pool.query(
      `DELETE FROM users WHERE id = :id AND tenant_id = :tenantId AND role IN ('comptable','agent')`,
      { id, tenantId: req.user.tenantId },
    );
    if (result.affectedRows === 0) throw new ApiError(404, 'Employé introuvable');
    logger.info('Employé supprimé', { tenantId: req.user.tenantId, employeeId: id, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
