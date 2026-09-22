'use strict';

/**
 * Numérotation continue et sans trou des écritures — voir le commentaire de
 * `gl_entry_number_counters` (migration 040). DOIT être appelé DANS la
 * transaction de l'écriture, avec `conn` (jamais `pool` directement) : si la
 * transaction échoue ensuite, le `ROLLBACK` annule aussi l'incrément
 * ci-dessous, donc jamais de numéro « brûlé » ni de trou dans la suite.
 */
async function nextEntryNumber(conn, tenantId) {
  // Assure l'existence de la ligne (1 = premier numéro jamais attribué),
  // sans écraser un compteur déjà initialisé.
  await conn.query(
    'INSERT IGNORE INTO gl_entry_number_counters (tenant_id, next_number) VALUES (:tenantId, 1)',
    { tenantId },
  );
  // Verrouille la ligne pour toute la durée de la transaction — une écriture
  // concurrente sur le même tenant attend son tour au lieu de lire la même
  // valeur en même temps.
  const [rows] = await conn.query(
    'SELECT next_number FROM gl_entry_number_counters WHERE tenant_id = :tenantId FOR UPDATE',
    { tenantId },
  );
  const assigned = rows[0].next_number;
  await conn.query(
    'UPDATE gl_entry_number_counters SET next_number = next_number + 1 WHERE tenant_id = :tenantId',
    { tenantId },
  );
  return assigned;
}

module.exports = { nextEntryNumber };
