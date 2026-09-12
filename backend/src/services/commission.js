'use strict';

// Commission du cabinet sur les loyers encaissés pour le compte d'un
// propriétaire (`owners`). Calcul auditable, documenté fonction par fonction :
// aucune écriture n'est créée ici, seule une lecture agrégée est renvoyée —
// le versement réel au propriétaire reste une saisie manuelle indépendante
// (`owner_payouts`, étape 5).
//
// Règles métier (fixées avec l'utilisateur) :
//   1. Recette nette d'un Bien pour un mois = paiements de loyer de toutes
//      ses unités pour ce mois − dépenses rattachées à ce Bien pour ce mois
//      (dépenses « Bien » + dépenses d'une Unité précise de ce Bien).
//   2. Commission cabinet = Recette nette × (taux / 100). Part propriétaire
//      = Recette nette − Commission cabinet.
//   3. Le taux de commission est historisé par Propriétaire : chaque
//      modification clôture l'ancien taux (`ends_on`) et insère une nouvelle
//      ligne, jamais un UPDATE du taux existant — les recettes des mois
//      passés restent donc calculées avec le taux réellement en vigueur à
//      l'époque, même après un changement ultérieur.
//   4. Convention retenue pour « le taux du mois » quand il change en cours
//      de mois : le taux actif au **dernier jour** du mois (le mois est
//      calculé une fois clos, avec le taux en vigueur à cette date-là).

const { pool } = require('../config/db');

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Dernier jour calendaire d'un mois 'AAAA-MM', au format 'AAAA-MM-JJ'. */
function lastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Taux de commission d'un propriétaire VALIDE à une date précise (pas
 * forcément le taux actuel) : celui dont l'intervalle [starts_on, ends_on]
 * contient cette date (`ends_on IS NULL` = taux actif depuis `starts_on`,
 * sans fin). Renvoie `null` si aucun taux n'a jamais été défini à cette
 * date pour ce propriétaire.
 */
async function getActiveCommissionRate(tenantId, ownerId, atDate) {
  const [rows] = await pool.query(
    `SELECT rate, starts_on, ends_on FROM owner_commission_rates
     WHERE tenant_id = :tenantId AND owner_id = :ownerId
       AND starts_on <= :atDate AND (ends_on IS NULL OR ends_on >= :atDate)
     ORDER BY starts_on DESC LIMIT 1`,
    { tenantId, ownerId, atDate },
  );
  if (!rows[0]) return null;
  return { rate: Number(rows[0].rate), startsOn: isoDate(rows[0].starts_on), endsOn: isoDate(rows[0].ends_on) };
}

/**
 * Taux de commission actif pour un MOIS donné ('AAAA-MM') : le taux valide
 * au dernier jour de ce mois (cf. convention documentée en tête de fichier).
 */
async function getTauxCommissionActif(tenantId, ownerId, yearMonth) {
  return getActiveCommissionRate(tenantId, ownerId, lastDayOfMonth(yearMonth));
}

/**
 * Recette nette d'un Bien pour un mois donné : somme des paiements de loyer
 * de toutes ses unités (`rent_payments.covers_month = yearMonth`) moins la
 * somme des dépenses rattachées à ce Bien pour ce mois (`expenses.property_id`,
 * qu'elles visent le Bien entier ou une Unité précise en son sein).
 *
 * Deux requêtes d'agrégation strictement séparées (jamais un JOIN entre
 * paiements et dépenses, qui dupliquerait les montants sommés) :
 *   - paiements : `rent_payments → leases → property_units`, une chaîne de
 *     relations many-to-one (chaque paiement a EXACTEMENT un bail, chaque
 *     bail EXACTEMENT une unité) — aucun risque de doublon en sommant.
 *   - dépenses : lecture directe de `expenses.property_id`, sans jointure.
 */
async function getRecetteNetteMaison(tenantId, propertyId, yearMonth) {
  const [paymentRows] = await pool.query(
    `SELECT COALESCE(SUM(rp.amount), 0) AS total
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     WHERE rp.tenant_id = :tenantId AND u.property_id = :propertyId AND rp.covers_month = :yearMonth`,
    { tenantId, propertyId, yearMonth },
  );
  const [expenseRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE tenant_id = :tenantId AND property_id = :propertyId AND deleted_at IS NULL
       AND DATE_FORMAT(expense_date, '%Y-%m') = :yearMonth`,
    { tenantId, propertyId, yearMonth },
  );

  const totalPayments = Number(paymentRows[0].total);
  const totalExpenses = Number(expenseRows[0].total);
  return { totalPayments, totalExpenses, recetteNette: totalPayments - totalExpenses };
}

/**
 * Recette d'un Bien pour un mois, ventilée entre le cabinet et le
 * propriétaire : recette nette, taux appliqué (celui en vigueur ce mois-là),
 * commission cabinet, part propriétaire. Si aucun taux n'a jamais été défini
 * pour ce propriétaire, la commission est calculée à 0 % (`rateDefined:
 * false` dans la réponse, pour que l'écran invite explicitement le DG à en
 * définir un plutôt que de laisser croire à une part propriétaire de 100 %
 * volontaire).
 *
 * Lève une erreur si le Bien n'existe pas pour ce tenant (l'appelant doit
 * l'avoir déjà vérifié via `loadProperty`, mais on ne fait pas confiance à
 * un `ownerId` fourni par le client : on le relit ici).
 */
async function getRecetteProprietaire(tenantId, propertyId, yearMonth) {
  const [propertyRows] = await pool.query(
    'SELECT owner_id FROM properties WHERE id = :propertyId AND tenant_id = :tenantId LIMIT 1',
    { propertyId, tenantId },
  );
  if (!propertyRows[0]) {
    const err = new Error('Bien introuvable');
    err.status = 404;
    throw err;
  }
  const ownerId = propertyRows[0].owner_id;

  const { totalPayments, totalExpenses, recetteNette } = await getRecetteNetteMaison(tenantId, propertyId, yearMonth);
  const rateInfo = await getTauxCommissionActif(tenantId, ownerId, yearMonth);
  const rate = rateInfo ? rateInfo.rate : 0;

  const commissionCabinet = Math.round(recetteNette * (rate / 100));
  const partProprietaire = recetteNette - commissionCabinet;

  return {
    propertyId,
    ownerId,
    yearMonth,
    totalPayments,
    totalExpenses,
    recetteNette,
    rate,
    rateDefined: !!rateInfo,
    rateStartsOn: rateInfo?.startsOn ?? null,
    commissionCabinet,
    partProprietaire,
  };
}

module.exports = {
  lastDayOfMonth,
  getActiveCommissionRate,
  getTauxCommissionActif,
  getRecetteNetteMaison,
  getRecetteProprietaire,
};
