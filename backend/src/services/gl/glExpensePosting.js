'use strict';

const { resolveOwnerAtDate } = require('../commission');

/**
 * Comment comptabiliser une dépense : une dépense imputée à un BIEN est une avance faite pour le compte du
 * propriétaire en vigueur à la date (règle `depense_bien_proprietaire`, 4671) ; sans Bien, c'est une charge du
 * cabinet (règle propre à la catégorie). Voir db/seedGeneralLedger.js pour le détail comptable.
 * Renvoie `{ operationType, context }` (le `context` à fusionner avec ceux du fournisseur).
 */
async function resolveExpensePosting(conn, { tenantId, propertyId, category, entryDate, categoryOperationType }) {
  if (!propertyId) return { operationType: categoryOperationType, context: {} };
  const ownerId =
    (await resolveOwnerAtDate(tenantId, propertyId, entryDate, conn)) ??
    (await conn.query('SELECT owner_id FROM properties WHERE id = :propertyId AND tenant_id = :tenantId', { propertyId, tenantId }))[0][0]?.owner_id;
  if (!ownerId) return { operationType: categoryOperationType, context: {} };
  return { operationType: 'depense_bien_proprietaire', context: { ownerId } };
}

module.exports = { resolveExpensePosting };
