'use strict';

const { pool } = require('../config/db');

/** Permissions d'un utilisateur (le DG a un tableau vide : son accès total vient du rôle). */
async function getPermissions(userId, role) {
  if (role === 'dg') return [];
  const [rows] = await pool.query('SELECT permission_key FROM user_permissions WHERE user_id = :id', {
    id: userId,
  });
  return rows.map((r) => r.permission_key);
}

/** Variante « en masse » pour une liste d'employés (évite N requêtes dans /api/employees). */
async function getPermissionsBulk(userIds) {
  const map = new Map();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT user_id, permission_key FROM user_permissions WHERE user_id IN (${placeholders})`,
    userIds,
  );
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(row.permission_key);
  }
  return map;
}

module.exports = { getPermissions, getPermissionsBulk };
