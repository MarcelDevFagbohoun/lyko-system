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
const { ApiError } = require('../middleware/error');

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
 * Fonction PURE (aucun accès base) : parmi une liste de taux déjà chargée
 * (`{startsOn, endsOn, ...}`, `endsOn` string ISO ou `null`), celui dont
 * l'intervalle [startsOn, endsOn] contient `atDate` (`endsOn` inclusif,
 * `null` = sans fin). `null` si aucun ne couvre cette date.
 *
 * Existe pour éviter EXACTEMENT le bug trouvé le 23/09/2026 sur la fiche
 * propriétaire (`routes/owners.js`) : le code y prenait "le taux sans
 * `endsOn`" comme raccourci pour "le taux actif", ce qui affiche un taux
 * déjà PROGRAMMÉ pour plus tard (ex. GBAGUIDI Rodrigue : 15 % à partir du
 * 01/10, sans `endsOn`) comme actif AUJOURD'HUI, alors que l'ancien taux
 * (10 %, avec un `endsOn` au 30/09) était encore réellement en vigueur — la
 * fiche affichait un taux différent de celui réellement appliqué aux
 * calculs de recette. Ne trie jamais en interne : suppose l'appelant déjà
 * en ordre, ou peu importe l'ordre (au plus UN taux peut valider la
 * condition à une date donnée, les intervalles ne se chevauchant jamais).
 */
function pickRateValidAt(rates, atDate) {
  return rates.find((r) => r.startsOn <= atDate && (!r.endsOn || r.endsOn >= atDate)) ?? null;
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
     WHERE rp.tenant_id = :tenantId AND u.property_id = :propertyId AND rp.covers_month = :yearMonth
       AND rp.deleted_at IS NULL`,
    { tenantId, propertyId, yearMonth },
  );
  // Dette initiale réglée + prorata d'entrée (étape 42) — mêmes sources que `getEscrowBalances`, dont ce
  // calcul doit rester cohérent (même mois, même recette nette) : les deux appartiennent au propriétaire
  // au même titre qu'un loyer, groupés ici par mois de RÈGLEMENT effectif (pas de loyer concerné).
  const [openingDebtRows] = await pool.query(
    `SELECT COALESCE(SUM(lodp.amount), 0) AS total
     FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     WHERE lodp.tenant_id = :tenantId AND u.property_id = :propertyId
       AND DATE_FORMAT(lodp.paid_at, '%Y-%m') = :yearMonth`,
    { tenantId, propertyId, yearMonth },
  );
  const [prorataRows] = await pool.query(
    `SELECT COALESCE(SUM(l.entry_prorata_amount), 0) AS total
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     WHERE l.tenant_id = :tenantId AND u.property_id = :propertyId
       AND l.entry_prorata_received_at IS NOT NULL AND DATE_FORMAT(l.entry_prorata_received_at, '%Y-%m') = :yearMonth`,
    { tenantId, propertyId, yearMonth },
  );
  const [expenseRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE tenant_id = :tenantId AND property_id = :propertyId AND deleted_at IS NULL
       AND DATE_FORMAT(expense_date, '%Y-%m') = :yearMonth`,
    { tenantId, propertyId, yearMonth },
  );

  const breakdown = {
    rent: Number(paymentRows[0].total),
    openingDebt: Number(openingDebtRows[0].total),
    prorata: Number(prorataRows[0].total),
  };
  const totalPayments = breakdown.rent + breakdown.openingDebt + breakdown.prorata;
  const totalExpenses = Number(expenseRows[0].total);
  return { totalPayments, totalExpenses, recetteNette: totalPayments - totalExpenses, breakdown };
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

  const { totalPayments, totalExpenses, recetteNette, breakdown } = await getRecetteNetteMaison(tenantId, propertyId, yearMonth);
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
    breakdown,
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
async function getEscrowBalances(tenantId, db = pool) {
  const [paymentRows] = await db.query(
    `SELECT p.owner_id, rp.covers_month AS ym, SUM(rp.amount) AS total
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE rp.tenant_id = :tenantId AND rp.deleted_at IS NULL
     GROUP BY p.owner_id, rp.covers_month`,
    { tenantId },
  );
  // Dette initiale réglée (étape 42, demande explicite de l'utilisateur : « lorsqu'un impayé est payé
  // on doit aussi l'ajouter dans le compte séquestré ») — jusqu'ici, seul le RESTE DÛ apparaissait
  // (`getUnpaidOpeningDebtByOwner`, volontairement à part) ; la part déjà RÉGLÉE, elle, n'entrait dans
  // aucun total « argent détenu pour ce propriétaire ». Groupée par mois de RÈGLEMENT (`paid_at`), pas
  // par mois de loyer (cette dette n'en a pas) — même traitement comptable qu'un loyer (voir
  // `dette_initiale_encaissee`, glOperationTypes).
  const [openingDebtRows] = await db.query(
    `SELECT p.owner_id, DATE_FORMAT(lodp.paid_at, '%Y-%m') AS ym, SUM(lodp.amount) AS total
     FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE lodp.tenant_id = :tenantId
     GROUP BY p.owner_id, ym`,
    { tenantId },
  );
  // Prorata d'entrée réglé (étape 42) — un seul montant par bail (pas un historique de paiements comme
  // la dette initiale ci-dessus), groupé par mois de règlement effectif (`entry_prorata_received_at`) ;
  // absent tant que rien n'a été concrètement encaissé (`IS NOT NULL`).
  const [prorataRows] = await db.query(
    `SELECT p.owner_id, DATE_FORMAT(l.entry_prorata_received_at, '%Y-%m') AS ym, SUM(l.entry_prorata_amount) AS total
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND l.entry_prorata_received_at IS NOT NULL
     GROUP BY p.owner_id, ym`,
    { tenantId },
  );
  const [expenseRows] = await db.query(
    `SELECT p.owner_id, DATE_FORMAT(e.expense_date, '%Y-%m') AS ym, SUM(e.amount) AS total
     FROM expenses e
     JOIN properties p ON p.id = e.property_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.property_id IS NOT NULL
     GROUP BY p.owner_id, ym`,
    { tenantId },
  );
  const [rateRows] = await db.query(
    `SELECT owner_id, rate, starts_on, ends_on FROM owner_commission_rates
     WHERE tenant_id = :tenantId ORDER BY owner_id, starts_on`,
    { tenantId },
  );
  const [payoutRows] = await db.query(
    `SELECT owner_id, COALESCE(SUM(amount), 0) AS total FROM owner_payouts WHERE tenant_id = :tenantId GROUP BY owner_id`,
    { tenantId },
  );

  // (owner_id -> (mois -> { rent, openingDebt, prorata, expenses })) : les quatre agrégats ne se
  // recoupent jamais sur la même ligne (requêtes séparées, voir `getRecetteNetteMaison`), on les
  // fusionne ici cellule par cellule. Trois sources distinctes plutôt qu'un seul total « payments » :
  // le DÉTAIL de ce qui compose le solde séquestre doit rester lisible (demande explicite de
  // l'utilisateur), pas seulement son montant.
  const byOwnerMonth = new Map();
  function cell(ownerId, ym) {
    if (!byOwnerMonth.has(ownerId)) byOwnerMonth.set(ownerId, new Map());
    const monthMap = byOwnerMonth.get(ownerId);
    if (!monthMap.has(ym)) monthMap.set(ym, { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 });
    return monthMap.get(ym);
  }
  for (const r of paymentRows) cell(r.owner_id, r.ym).rent = Number(r.total);
  for (const r of openingDebtRows) cell(r.owner_id, r.ym).openingDebt = Number(r.total);
  for (const r of prorataRows) cell(r.owner_id, r.ym).prorata = Number(r.total);
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
    const breakdown = { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 };
    for (const [ym, m] of months) {
      breakdown.rent += m.rent;
      breakdown.openingDebt += m.openingDebt;
      breakdown.prorata += m.prorata;
      breakdown.expenses += m.expenses;
      const recetteNette = m.rent + m.openingDebt + m.prorata - m.expenses;
      const rate = rateAt(ownerId, lastDayOfMonth(ym));
      const commissionCabinet = Math.round(recetteNette * (rate / 100));
      totalCollected += recetteNette - commissionCabinet;
    }
    const totalPayouts = payoutsByOwner.get(ownerId) ?? 0;
    balances.set(ownerId, { totalCollected, totalPayouts, balance: totalCollected - totalPayouts, breakdown });
  }
  // Un propriétaire sans aucune recette mais avec un versement déjà
  // enregistré (situation anormale, ne doit jamais faire planter le calcul) :
  // inclus quand même, avec un solde négatif explicite plutôt qu'absent.
  const emptyBreakdown = { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 };
  for (const [ownerId, totalPayouts] of payoutsByOwner) {
    if (!balances.has(ownerId)) balances.set(ownerId, { totalCollected: 0, totalPayouts, balance: -totalPayouts, breakdown: emptyBreakdown });
  }
  return balances;
}

/**
 * Revenu du CABINET lui-même pour un mois donné, tous propriétaires confondus (étape 44, demande
 * explicite de l'utilisateur : « les dépenses doivent être déduites de la recette du cabinet ») —
 * distinct de `getRecetteProprietaire` (par Bien, part reversée à UN propriétaire) et de
 * `netCashFlow` du tableau de bord (trésorerie brute, mélange recette propriétaire et cabinet).
 *
 * Quatre sources 100 % cabinet, jamais reversées à un propriétaire :
 *   1. Commission sur la recette nette de CHAQUE Bien, au taux en vigueur ce mois-là pour son
 *      propriétaire — même calcul cellule par cellule que `getEscrowBalances`, mais SOMMÉ (jamais
 *      soustrait) et restreint à ce seul mois, en 4 requêtes agrégées (jamais une boucle par Bien).
 *   2. Frais d'agence à l'entrée (`leases.entry_fee_amount`, 100 % cabinet, voir `frais_agence_encaisse`).
 *   3. Pénalités de retard RÉELLEMENT réglées (étape 44bis, `late_fee_payments.paid_at`) — jamais la
 *      date d'application (`late_fees.applied_at`), qui n'est qu'une créance tant que rien n'est payé.
 *
 * Moins les dépenses de FONCTIONNEMENT du cabinet (`expenses.property_id IS NULL`, jamais celles
 * facturées à un Bien — déjà déduites côté propriétaire dans `getRecetteNetteMaison`, ne jamais les
 * compter deux fois).
 */
async function getCabinetRevenue(tenantId, yearMonth, db = pool) {
  const atDate = lastDayOfMonth(yearMonth);

  const [paymentRows] = await db.query(
    `SELECT p.owner_id, SUM(rp.amount) AS total
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE rp.tenant_id = :tenantId AND rp.deleted_at IS NULL AND rp.covers_month = :yearMonth
     GROUP BY p.owner_id`,
    { tenantId, yearMonth },
  );
  const [openingDebtRows] = await db.query(
    `SELECT p.owner_id, SUM(lodp.amount) AS total
     FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE lodp.tenant_id = :tenantId AND DATE_FORMAT(lodp.paid_at, '%Y-%m') = :yearMonth
     GROUP BY p.owner_id`,
    { tenantId, yearMonth },
  );
  const [prorataRows] = await db.query(
    `SELECT p.owner_id, SUM(l.entry_prorata_amount) AS total
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND l.entry_prorata_received_at IS NOT NULL
       AND DATE_FORMAT(l.entry_prorata_received_at, '%Y-%m') = :yearMonth
     GROUP BY p.owner_id`,
    { tenantId, yearMonth },
  );
  const [propertyExpenseRows] = await db.query(
    `SELECT p.owner_id, SUM(e.amount) AS total
     FROM expenses e
     JOIN properties p ON p.id = e.property_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.property_id IS NOT NULL
       AND DATE_FORMAT(e.expense_date, '%Y-%m') = :yearMonth
     GROUP BY p.owner_id`,
    { tenantId, yearMonth },
  );
  const [rateRows] = await db.query(
    `SELECT owner_id, rate, starts_on, ends_on FROM owner_commission_rates WHERE tenant_id = :tenantId`,
    { tenantId },
  );

  const byOwner = new Map();
  function cell(ownerId) {
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 });
    return byOwner.get(ownerId);
  }
  for (const r of paymentRows) cell(r.owner_id).rent = Number(r.total);
  for (const r of openingDebtRows) cell(r.owner_id).openingDebt = Number(r.total);
  for (const r of prorataRows) cell(r.owner_id).prorata = Number(r.total);
  for (const r of propertyExpenseRows) cell(r.owner_id).expenses = Number(r.total);

  const ratesByOwner = new Map();
  for (const r of rateRows) {
    if (!ratesByOwner.has(r.owner_id)) ratesByOwner.set(r.owner_id, []);
    ratesByOwner.get(r.owner_id).push({ rate: Number(r.rate), startsOn: isoDate(r.starts_on), endsOn: isoDate(r.ends_on) });
  }

  let commission = 0;
  for (const [ownerId, m] of byOwner) {
    const recetteNette = m.rent + m.openingDebt + m.prorata - m.expenses;
    const rate = pickRateValidAt(ratesByOwner.get(ownerId) || [], atDate)?.rate ?? 0;
    commission += Math.round(recetteNette * (rate / 100));
  }

  const [entryFeeRows] = await db.query(
    `SELECT COALESCE(SUM(entry_fee_amount), 0) AS total FROM leases
     WHERE tenant_id = :tenantId AND entry_fee_received_at IS NOT NULL
       AND DATE_FORMAT(entry_fee_received_at, '%Y-%m') = :yearMonth`,
    { tenantId, yearMonth },
  );
  const entryFees = Number(entryFeeRows[0].total);

  // Pénalités de retard RÉELLEMENT réglées (étape 44bis, `late_fee_payments`) — groupées par mois de
  // RÈGLEMENT effectif (`paid_at`), jamais par date d'application (`late_fees.applied_at`) : cette
  // recette est en base de caisse, comme les trois sources ci-dessus, jamais une créance non encaissée.
  const [lateFeeRows] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM late_fee_payments
     WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at, '%Y-%m') = :yearMonth`,
    { tenantId, yearMonth },
  );
  const lateFees = Number(lateFeeRows[0].total);

  const [cabinetExpenseRows] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE tenant_id = :tenantId AND property_id IS NULL AND deleted_at IS NULL
       AND DATE_FORMAT(expense_date, '%Y-%m') = :yearMonth`,
    { tenantId, yearMonth },
  );
  const expenses = Number(cabinetExpenseRows[0].total);

  return {
    yearMonth,
    breakdown: { commission, entryFees, lateFees, expenses },
    netCabinetIncome: commission + entryFees + lateFees - expenses,
  };
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
     WHERE rp.tenant_id = :tenantId AND rp.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM owner_commission_rates r WHERE r.tenant_id = :tenantId AND r.owner_id = p.owner_id
       )
     GROUP BY p.owner_id, o.name
     ORDER BY total_collected DESC`,
    { tenantId },
  );
  return rows.map((r) => ({ ownerId: r.owner_id, ownerName: r.owner_name, totalCollected: Number(r.total_collected) }));
}

/**
 * Un reversement ne peut jamais dépasser ce que le cabinet détient
 * RÉELLEMENT pour ce propriétaire (`getEscrowBalances`) — audit comptable
 * du 23/09/2026, anomalie A2 : sans ce contrôle, un montant absurde était
 * accepté sans la moindre erreur (constaté : 5 000 000 FCFA reversés à un
 * propriétaire dont le solde réel était nul, rendant son solde négatif en
 * silence). Décision explicite de l'utilisateur : blocage total (400),
 * jamais un simple avertissement contournable — voir routes/owners.js
 * `POST /:id/payouts`.
 */
async function assertPayoutWithinBalance(tenantId, ownerId, amount, db = pool) {
  // `db` : la connexion de la transaction du versement, une fois la fiche du propriétaire VERROUILLÉE —
  // le solde est alors lu après tout versement concurrent déjà validé, jamais avant (sinon deux versements
  // simultanés, chacun inférieur au solde, pouvaient le dépasser ensemble).
  const balances = await getEscrowBalances(tenantId, db);
  const balance = balances.get(ownerId)?.balance ?? 0;
  if (amount > balance) {
    throw new ApiError(400, `Le montant dépasse le solde séquestre réellement détenu pour ce propriétaire (${balance} FCFA)`);
  }
}

module.exports = {
  lastDayOfMonth,
  pickRateValidAt,
  assertPayoutWithinBalance,
  getActiveCommissionRate,
  getTauxCommissionActif,
  getRecetteNetteMaison,
  getRecetteProprietaire,
  getCabinetRevenue,
  getEscrowBalances,
  getUnpaidOpeningDebtByOwner,
  getOwnersWithoutCommissionRate,
};
