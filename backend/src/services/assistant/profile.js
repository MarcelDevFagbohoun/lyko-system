'use strict';

const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');

/**
 * Profil mémorisé de l'utilisateur pour l'assistant : nom d'usage + fonction. Privé (un par utilisateur),
 * conservé jusqu'à ce que la personne l'efface. Ces deux textes sont saisis par un humain ET réinjectés
 * dans la consigne du modèle : on les normalise strictement (une ligne, longueur bornée, pas de caractère
 * de contrôle) — un libellé, jamais une instruction.
 */

const NAME_MAX = 60;
const TITLE_MAX = 80;
const MIN = 2;

/** Une seule ligne, espaces compactés, sans caractère de contrôle. */
function normalize(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validate({ displayName, jobTitle }) {
  const name = normalize(displayName);
  const title = normalize(jobTitle);
  const details = {};
  if (name.length < MIN) details.displayName = ['Nom trop court'];
  else if (name.length > NAME_MAX) details.displayName = [`Nom trop long (${NAME_MAX} caractères maximum)`];
  if (title.length < MIN) details.jobTitle = ['Fonction trop courte'];
  else if (title.length > TITLE_MAX) details.jobTitle = [`Fonction trop longue (${TITLE_MAX} caractères maximum)`];
  if (Object.keys(details).length > 0) throw new ApiError(400, 'Profil invalide', details);
  return { name, title };
}

async function getProfile(tenantId, userId, db = pool) {
  const [[row]] = await db.query(
    'SELECT display_name, job_title, updated_at FROM assistant_profiles WHERE user_id = :userId AND tenant_id = :tenantId LIMIT 1',
    { userId, tenantId },
  );
  return row ? { displayName: row.display_name, jobTitle: row.job_title, updatedAt: row.updated_at } : null;
}

async function saveProfile(tenantId, userId, input) {
  const { name, title } = validate(input);
  await pool.query(
    `INSERT INTO assistant_profiles (user_id, tenant_id, display_name, job_title)
     VALUES (:userId, :tenantId, :name, :title)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), job_title = VALUES(job_title)`,
    { userId, tenantId, name, title },
  );
  return getProfile(tenantId, userId);
}

async function deleteProfile(tenantId, userId) {
  await pool.query('DELETE FROM assistant_profiles WHERE user_id = :userId AND tenant_id = :tenantId', { userId, tenantId });
}

module.exports = { getProfile, saveProfile, deleteProfile, normalize, NAME_MAX, TITLE_MAX };
