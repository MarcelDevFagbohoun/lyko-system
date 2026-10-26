'use strict';

/**
 * Comptes employés (comptable / agent) d'une entreprise : toutes les requêtes SQL de la route
 * `/api/employees` vivent ici. La route ne garde que le HTTP (validation du corps, statuts, journal).
 * Chaque fonction est isolée par `tenantId`.
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { hashPassword, generateTemporaryPassword } = require('../utils/password');
const { generateIdentifier } = require('../utils/identifier');
const { DEFAULT_JOB_TITLES } = require('../constants/jobTitles');
const { assertWithinLimit } = require('./entitlements');

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

/** Mémorise un poste nouveau (insensible à la casse) pour qu'il soit proposé ensuite ; renvoie l'intitulé canonique. */
async function rememberJobTitle(conn, tenantId, userId, label) {
  const known = DEFAULT_JOB_TITLES.find((t) => t.toLowerCase() === label.toLowerCase());
  if (known) return known;
  const [existing] = await conn.query('SELECT label FROM tenant_job_titles WHERE tenant_id = :tenantId AND label = :label LIMIT 1', { tenantId, label });
  if (existing[0]) return existing[0].label; // collation insensible à la casse : renvoie la forme déjà enregistrée
  await conn.query('INSERT INTO tenant_job_titles (tenant_id, label, created_by) VALUES (:tenantId, :label, :userId)', { tenantId, label, userId });
  return label;
}

/** Postes ajoutés par l'entreprise (en plus de la liste par défaut). */
async function listCustomJobTitles(tenantId) {
  const [rows] = await pool.query('SELECT label FROM tenant_job_titles WHERE tenant_id = :tenantId ORDER BY label', { tenantId });
  return rows.map((r) => r.label);
}

/** Comptes comptable/agent de l'entreprise, avec le nombre de Biens gérés par chacun. */
async function listEmployees(tenantId) {
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
    { tenantId },
  );
  return rows;
}

/** Une ligne `users` (comptable/agent) de l'entreprise, ou null. */
async function findEmployee(tenantId, id, db = pool) {
  const [rows] = await db.query(
    `SELECT * FROM users WHERE id = :id AND tenant_id = :tenantId AND role IN ('comptable','agent') LIMIT 1`,
    { id, tenantId },
  );
  return rows[0] || null;
}

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

/**
 * Attribue plusieurs Biens à un agent en une fois. Un seul agent par Bien : réattribuer un Bien déjà
 * géré par un autre agent le lui retire silencieusement (décision produit).
 */
async function assignProperties(tenantId, agentId, propertyIds) {
  const conn = await pool.getConnection();
  try {
    const [empRows] = await conn.query(
      `SELECT id FROM users WHERE id = :id AND tenant_id = :tenantId AND role = 'agent' LIMIT 1`,
      { id: agentId, tenantId },
    );
    if (!empRows[0]) throw new ApiError(404, "Agent introuvable (seul un agent peut recevoir des Biens attribués)");

    const placeholders = propertyIds.map(() => '?').join(',');
    const [propRows] = await conn.query(
      `SELECT id FROM properties WHERE tenant_id = ? AND id IN (${placeholders})`,
      [tenantId, ...propertyIds],
    );
    if (propRows.length !== propertyIds.length) {
      throw new ApiError(404, 'Un ou plusieurs Biens sont introuvables');
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE properties SET agent_id = ?, agent_assigned_at = NOW() WHERE tenant_id = ? AND id IN (${placeholders})`,
      [agentId, tenantId, ...propertyIds],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Retire un Bien du portefeuille de l'agent (redevient non attribué, jamais supprimé). */
async function unassignProperty(tenantId, agentId, propertyId) {
  const [result] = await pool.query(
    `UPDATE properties SET agent_id = NULL, agent_assigned_at = NULL
     WHERE id = :propertyId AND tenant_id = :tenantId AND agent_id = :agentId`,
    { propertyId, tenantId, agentId },
  );
  if (result.affectedRows === 0) throw new ApiError(404, 'Ce Bien n\'est pas géré par cet agent');
}

/**
 * Crée un employé. L'identifiant de connexion et le mot de passe temporaire sont toujours générés
 * automatiquement ; les permissions sont celles choisies par le DG, sans valeur par défaut de repli
 * (un choix « aucune permission » est respecté).
 */
async function createEmployee(tenantId, createdBy, data) {
  const conn = await pool.getConnection();
  try {
    const [existingPhone] = await conn.query('SELECT id FROM users WHERE phone = :phone LIMIT 1', {
      phone: data.phone,
    });
    if (existingPhone.length > 0) throw new ApiError(409, 'Ce numéro est déjà associé à un compte');

    if (data.email) {
      // Scopé à l'entreprise courante : l'email n'est jamais utilisé pour se connecter (seul le téléphone
      // l'est, unique globalement ci-dessus) — une vérification globale laisserait un DG sonder si un email
      // appartient à un employé d'une AUTRE entreprise cliente (audit sécurité).
      const [existingEmail] = await conn.query(
        'SELECT id FROM users WHERE email = :email AND tenant_id = :tenantId LIMIT 1',
        { email: data.email, tenantId },
      );
      if (existingEmail.length > 0) throw new ApiError(409, 'Cet email est déjà associé à un compte');
    }

    const identifier = await generateUniqueIdentifier(conn);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    // Respecter exactement le choix du DG, y compris « aucune permission » délibérément décochée :
    // retomber sur les valeurs par défaut écraserait silencieusement ce choix (bug historique).
    const permissions = data.permissions;

    await conn.beginTransaction();
    await assertWithinLimit(tenantId, 'users', conn);
    const jobTitle = await rememberJobTitle(conn, tenantId, createdBy, data.jobTitle);

    const [result] = await conn.query(
      `INSERT INTO users (tenant_id, first_name, last_name, phone, identifier, email, password_hash, role, job_title, must_change_password)
       VALUES (:tenantId, :firstName, :lastName, :phone, :identifier, :email, :passwordHash, :role, :jobTitle, 1)`,
      {
        jobTitle,
        tenantId,
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
    return { userId, identifier, temporaryPassword, jobTitle, permissions };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Modifie / désactive un employé et ses permissions ; renvoie la ligne à jour et ses clés de permission. */
async function updateEmployee(tenantId, updatedBy, id, data) {
  const conn = await pool.getConnection();
  try {
    if (!(await findEmployee(tenantId, id, conn))) throw new ApiError(404, 'Employé introuvable');

    if (data.email) {
      // Scopé à l'entreprise courante — même raison que la création.
      const [dupe] = await conn.query(
        'SELECT id FROM users WHERE email = :email AND tenant_id = :tenantId AND id != :id LIMIT 1',
        { email: data.email, tenantId, id },
      );
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
    if (data.jobTitle !== undefined) {
      fields.push('job_title = :jobTitle');
      params.jobTitle = await rememberJobTitle(conn, tenantId, updatedBy, data.jobTitle);
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
    return { row: updatedRows[0], permissions: permRows.map((p) => p.permission_key) };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Suppression définitive (révoque aussi ses sessions par cascade FK). */
async function deleteEmployee(tenantId, id) {
  const [result] = await pool.query(
    `DELETE FROM users WHERE id = :id AND tenant_id = :tenantId AND role IN ('comptable','agent')`,
    { id, tenantId },
  );
  if (result.affectedRows === 0) throw new ApiError(404, 'Employé introuvable');
}

module.exports = {
  listCustomJobTitles,
  listEmployees,
  findEmployee,
  loadManagedProperties,
  assignProperties,
  unassignProperty,
  createEmployee,
  updateEmployee,
  deleteEmployee,
};
