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

/**
 * Solde séquestre par propriétaire (mandat) : part propriétaire cumulée de
 * TOUS ses Biens depuis toujours (même calcul mois par mois que
 * `getRecetteProprietaire` ci-dessus, sommé sur l'historique complet) moins
 * les versements déjà effectués (`owner_payouts`) — combien le cabinet
 * détient ACTUELLEMENT pour son compte, jamais encore reversé. Calculé pour
 * TOUS les propriétaires du tenant en 4 requêtes agrégées (jamais une
 * boucle par propriétaire) : réutilisé par la fiche propriétaire ET le
 * total portefeuille du tableau de bord comptable.
 *
 * Volontairement PAS filtré par la portée agent (`services/scope.js`) : un
 * solde séquestre est par nature une vue de bout en bout d'un propriétaire
 * (tous ses Biens, même hors de la portée d'un agent restreint) — comme les
 * versements et l'historique de commission déjà affichés sans filtre sur la
 * fiche propriétaire (`routes/owners.js`). Pour cette raison, jamais exposé
 * sur la LISTE des propriétaires (qui, elle, scope ses agrégats par agent) :
 * un montant partiel y serait trompeur, puisque les versements couvrent
 * l'ensemble des Biens d'un propriétaire, pas seulement ceux visibles par
 * un agent restreint.
 */
async function getEscrowBalances(tenantId) {
  const [paymentRows] = await pool.query(
    `SELECT p.owner_id, rp.covers_month AS ym, SUM(rp.amount) AS total
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE rp.tenant_id = :tenantId
     GROUP BY p.owner_id, rp.covers_month`,
    { tenantId },
  );
  const [expenseRows] = await pool.query(
    `SELECT p.owner_id, DATE_FORMAT(e.expense_date, '%Y-%m') AS ym, SUM(e.amount) AS total
     FROM expenses e
     JOIN properties p ON p.id = e.property_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.property_id IS NOT NULL
     GROUP BY p.owner_id, ym`,
    { tenantId },
  );
  const [rateRows] = await pool.query(
    `SELECT owner_id, rate, starts_on, ends_on FROM owner_commission_rates
     WHERE tenant_id = :tenantId ORDER BY owner_id, starts_on`,
    { tenantId },
  );
  const [payoutRows] = await pool.query(
    `SELECT owner_id, COALESCE(SUM(amount), 0) AS total FROM owner_payouts WHERE tenant_id = :tenantId GROUP BY owner_id`,
    { tenantId },
  );

  // (owner_id -> (mois -> { payments, expenses })) : les deux agrégats ne
  // se recoupent jamais sur la même ligne (requêtes séparées, voir
  // `getRecetteNetteMaison`), on les fusionne ici cellule par cellule.
  const byOwnerMonth = new Map();
  function cell(ownerId, ym) {
    if (!byOwnerMonth.has(ownerId)) byOwnerMonth.set(ownerId, new Map());
    const monthMap = byOwnerMonth.get(ownerId);
    if (!monthMap.has(ym)) monthMap.set(ym, { payments: 0, expenses: 0 });
    return monthMap.get(ym);
  }
  for (const r of paymentRows) cell(r.owner_id, r.ym).payments = Number(r.total);
  for (const r of expenseRows) cell(r.owner_id, r.ym).expenses = Number(r.total);

  const ratesByOwner = new Map();
  for (const r of rateRows) {
    if (!ratesByOwner.has(r.owner_id)) ratesByOwner.set(r.owner_id, []);
    ratesByOwner.get(r.owner_id).push({ rate: Number(r.rate), startsOn: isoDate(r.starts_on), endsOn: isoDate(r.ends_on) });
  }
  // Même convention que `getTauxCommissionActif` : le taux en vigueur au
  // dernier jour du mois concerné.
  function rateAt(ownerId, atDate) {
    const rates = ratesByOwner.get(ownerId) || [];
    const match = rates.find((r) => r.startsOn <= atDate && (!r.endsOn || r.endsOn >= atDate));
    return match ? match.rate : 0;
  }

  const payoutsByOwner = new Map(payoutRows.map((r) => [r.owner_id, Number(r.total)]));

  const balances = new Map();
  for (const [ownerId, months] of byOwnerMonth) {
    let totalCollected = 0;
    for (const [ym, { payments, expenses }] of months) {
      const recetteNette = payments - expenses;
      const rate = rateAt(ownerId, lastDayOfMonth(ym));
      const commissionCabinet = Math.round(recetteNette * (rate / 100));
      totalCollected += recetteNette - commissionCabinet;
    }
    const totalPayouts = payoutsByOwner.get(ownerId) ?? 0;
    balances.set(ownerId, { totalCollected, totalPayouts, balance: totalCollected - totalPayouts });
  }
  // Un propriétaire sans aucune recette mais avec un versement déjà
  // enregistré (situation anormale, ne doit jamais faire planter le calcul) :
  // inclus quand même, avec un solde négatif explicite plutôt qu'absent.
  for (const [ownerId, totalPayouts] of payoutsByOwner) {
    if (!balances.has(ownerId)) balances.set(ownerId, { totalCollected: 0, totalPayouts, balance: -totalPayouts });
  }
  return balances;
}

/**
 * Dette initiale des locataires non encore réglée, agrégée par
 * propriétaire — montant BRUT dû par les locataires (avant toute
 * commission, puisque rien n'a encore été perçu). Décision explicite de
 * l'utilisateur : JAMAIS mélangée au solde séquestre réel
 * (`getEscrowBalances`, qui ne reflète que l'argent réellement encaissé) —
 * une ligne "impayé" distincte, pour ne jamais faire croire au propriétaire
 * qu'une somme non encore reçue est déjà détenue pour son compte.
 */
async function getUnpaidOpeningDebtByOwner(tenantId) {
  const [rows] = await pool.query(
    `SELECT p.owner_id, l.id AS lease_id, l.opening_debt_amount,
            COALESCE((SELECT SUM(amount) FROM lease_opening_debt_payments lodp WHERE lodp.lease_id = l.id), 0) AS paid
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND l.opening_debt_amount > 0`,
    { tenantId },
  );
  const byOwner = new Map();
  for (const r of rows) {
    const remaining = Number(r.opening_debt_amount) - Number(r.paid);
    if (remaining <= 0) continue;
    byOwner.set(r.owner_id, (byOwner.get(r.owner_id) ?? 0) + remaining);
  }
  return byOwner;
}

/**
 * Propriétaires ayant DÉJÀ des loyers réellement encaissés (au moins un
 * `rent_payments` sur l'un de leurs Biens) mais AUCUN taux de commission
 * jamais défini (`owner_commission_rates` vide pour eux) — vrai cas trouvé
 * en production le 22/09/2026 (AKOAKOU Jean, 90 000 FCFA encaissés à 100 %,
 * aucune commission prélevée faute de taux configuré). Le système avertit
 * déjà sur la fiche du Bien concerné ("Aucun taux défini — 0 % appliqué par
 * défaut"), mais c'est trop enfoui pour être fiable — ce garde-fou remonte
 * la liste complète au tableau de bord, avant que ça ne se reproduise sur un
 * autre propriétaire. Un propriétaire SANS aucun loyer encore encaissé n'a
 * pas encore besoin d'un taux (pas listé) : l'absence de taux n'est un
 * problème qu'à partir du moment où de l'argent a réellement transité.
 */
async function getOwnersWithoutCommissionRate(tenantId) {
  const [rows] = await pool.query(
    `SELECT p.owner_id, o.name AS owner_name, COALESCE(SUM(rp.amount), 0) AS total_collected
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN owners o ON o.id = p.owner_id
     WHERE rp.tenant_id = :tenantId
       AND NOT EXISTS (
         SELECT 1 FROM owner_commission_rates r WHERE r.tenant_id = :tenantId AND r.owner_id = p.owner_id
       )
     GROUP BY p.owner_id, o.name
     ORDER BY total_collected DESC`,
    { tenantId },
  );
  return rows.map((r) => ({ ownerId: r.owner_id, ownerName: r.owner_name, totalCollected: Number(r.total_collected) }));
}

module.exports = {
  lastDayOfMonth,
  getActiveCommissionRate,
  getTauxCommissionActif,
  getRecetteNetteMaison,
  getRecetteProprietaire,
  getEscrowBalances,
  getUnpaidOpeningDebtByOwner,
  getOwnersWithoutCommissionRate,
};
