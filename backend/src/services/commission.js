'use strict';

// Commission du cabinet sur les loyers encaissés pour le compte d'un
// propriétaire (`owners`). Calcul auditable, documenté fonction par fonction :
// aucune écriture n'est créée ici, seule une lecture agrégée est renvoyée —
// le versement réel au propriétaire reste une saisie manuelle indépendante
// (`owner_payouts`, étape 5).
//
// Règles métier (fixées avec l'utilisateur) :
//   1. Base caisse, mois civil (1er → 30/31) : chaque flux (loyer, dette initiale réglée, prorata
//      d'entrée, dépense payée du Bien) compte dans le mois où l'argent est RÉELLEMENT entré/sorti
//      (`paid_at`), quel que soit le mois de loyer couvert. Recette nette d'un Bien = entrées − dépenses.
//   2. Commission cabinet = Σ (flux × taux / 100) où le taux est celui EN VIGUEUR AU JOUR DU FLUX
//      (décision du 21/10/2026), arrondie une fois par (propriétaire, Bien, mois). Part propriétaire
//      = recette nette − commission.
//   3. Le taux de commission est historisé par Propriétaire : chaque modification clôture l'ancien taux
//      (`ends_on`) et insère une nouvelle ligne, jamais un UPDATE — un loyer encaissé avant le
//      changement garde son ancien taux, même s'il couvre un mois postérieur.

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
 * Propriétaire d'un Bien EN VIGUEUR à une date précise (pas forcément le propriétaire ACTUEL) — voir
 * `property_owner_history` (migration 078, étape 51bis : réattribuer un Bien via `PATCH
 * /api/properties/:id` ne doit jamais réécrire rétroactivement à qui appartenaient les loyers/dépenses
 * déjà réels avant ce changement). Un Bien jamais réattribué n'a qu'UNE période ouverte depuis sa
 * création : ce calcul reste alors identique à `properties.owner_id` pour toute date après sa création.
 * Renvoie `null` si aucune période ne couvre cette date (mois antérieur à la création du Bien).
 */
async function resolveOwnerAtDate(tenantId, propertyId, atDate, db = pool) {
  const [rows] = await db.query(
    `SELECT owner_id FROM property_owner_history
     WHERE tenant_id = :tenantId AND property_id = :propertyId
       AND starts_on <= :atDate AND (ends_on IS NULL OR ends_on > :atDate)
     LIMIT 1`,
    { tenantId, propertyId, atDate },
  );
  return rows[0] ? rows[0].owner_id : null;
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

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Chargeur UNIQUE des flux propriétaire (refonte du 21/10/2026, « vérification des calculs d'un mois »)
// ───────────────────────────────────────────────────────────────────────────────────────────────
// Avant : getRecetteNetteMaison, getEscrowBalances et getCabinetRevenue relisaient chacun leurs propres
// requêtes, avec des conventions qui divergeaient (mois de loyer vs mois d'encaissement, taux du dernier
// jour du mois vs taux du jour). Désormais TOUT part de ce chargeur, donc trois vues du même argent ne
// peuvent plus se contredire.
//
// Conventions (décisions de l'utilisateur) :
//   - Base caisse : chaque flux est daté de son encaissement/décaissement RÉEL (`paid_at`,
//     `entry_prorata_received_at`) ; le « mois » d'un flux est ce mois-là (mois civil, 1er → 30/31).
//   - Un loyer payé en avance ou en retard compte dans le mois où l'argent est entré.
//   - Le propriétaire d'un flux est celui en vigueur à la date du flux (`property_owner_history`).
//   - Le taux de commission d'un flux est celui en vigueur à la date du flux (jour du paiement).
//   - Arrondi de la commission à la maille PROPRIÉTAIRE + BIEN + MOIS (somme des montants × taux du jour,
//     arrondie une seule fois) — identique dans la fiche du Bien, le séquestre et le revenu du cabinet.

/** Sous-requête SQL commune : propriétaire en vigueur à la date `dateExpr` (repli : propriétaire actuel). */
function ownerJoin(dateExpr) {
  return `LEFT JOIN property_owner_history poh ON poh.property_id = p.id
       AND poh.starts_on <= ${dateExpr} AND (poh.ends_on IS NULL OR poh.ends_on > ${dateExpr})`;
}

/**
 * Tous les flux « argent du propriétaire » du tenant : loyers, dette initiale réglée, prorata d'entrée
 * (entrées, `amount` > 0) et dépenses payées rattachées à un Bien (sorties, `amount` > 0, `kind` =
 * 'expenses'). Dates renvoyées en 'AAAA-MM-JJ' (formatées par SQL : aucun décalage de fuseau possible).
 * Filtres : `asOfDate` (flux <= date), `month` ('AAAA-MM', flux de ce mois), `propertyId`.
 */
async function loadOwnerFlows(tenantId, db = pool, { asOfDate = null, month = null, propertyId = null } = {}) {
  const params = { tenantId };
  if (asOfDate) params.asOfDate = asOfDate;
  if (month) params.month = month;
  if (propertyId) params.propertyId = propertyId;
  const filters = (col) =>
    `${asOfDate ? ` AND ${col} <= :asOfDate` : ''}${month ? ` AND DATE_FORMAT(${col}, '%Y-%m') = :month` : ''}${
      propertyId ? ' AND p.id = :propertyId' : ''
    }`;

  const select = (dateCol, amountExpr, kind, from, where) =>
    `SELECT COALESCE(poh.owner_id, p.owner_id) AS owner_id, p.id AS property_id,
            DATE_FORMAT(${dateCol}, '%Y-%m-%d') AS flow_date, ${amountExpr} AS amount, '${kind}' AS kind
     ${from}
     ${ownerJoin(dateCol)}
     WHERE ${where}${filters(dateCol)}`;

  const rentFrom = `FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id`;
  const debtFrom = `FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id`;
  const prorataFrom = `FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id`;
  const expenseFrom = `FROM expenses e
     JOIN properties p ON p.id = e.property_id`;

  const sql = [
    select('rp.paid_at', 'rp.amount', 'rent', rentFrom, 'rp.tenant_id = :tenantId AND rp.deleted_at IS NULL'),
    select('lodp.paid_at', 'lodp.amount', 'openingDebt', debtFrom, 'lodp.tenant_id = :tenantId'),
    select(
      'l.entry_prorata_received_at',
      'l.entry_prorata_amount',
      'prorata',
      prorataFrom,
      'l.tenant_id = :tenantId AND l.entry_prorata_received_at IS NOT NULL',
    ),
    // Base caisse : une dépense « à crédit » encore impayée (paid_at NULL) ne réduit aucun solde.
    select(
      'e.paid_at',
      'e.amount',
      'expenses',
      expenseFrom,
      "e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.property_id IS NOT NULL AND e.payment_status = 'paid'",
    ),
  ].join('\nUNION ALL\n');

  const [rows] = await db.query(sql, params);
  return rows.map((r) => ({
    ownerId: r.owner_id,
    propertyId: r.property_id,
    date: r.flow_date,
    ym: r.flow_date.slice(0, 7),
    kind: r.kind,
    amount: Number(r.amount),
  }));
}

/** Taux historisés de TOUS les propriétaires du tenant : Map(ownerId → [{rate, startsOn, endsOn}]). */
async function loadRatesByOwner(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT owner_id, rate, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on
     FROM owner_commission_rates WHERE tenant_id = :tenantId ORDER BY owner_id, starts_on`,
    { tenantId },
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.owner_id)) map.set(r.owner_id, []);
    map.get(r.owner_id).push({ rate: Number(r.rate), startsOn: r.starts_on, endsOn: r.ends_on });
  }
  return map;
}

async function loadCommissionAtCollection(tenantId, db = pool) {
  const [rows] = await db.query('SELECT gl_commission_timing FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  return (rows[0]?.gl_commission_timing ?? 'encaissement') === 'encaissement';
}

/**
 * Fonction PURE : regroupe des flux par (propriétaire, Bien, mois d'encaissement). Pour chaque cellule :
 * les 4 composantes, la recette nette et la commission « brute » = Σ (montant signé × taux du jour du
 * flux / 100), arrondie UNE fois (`commission`). Une dépense compte en négatif (elle réduit la base).
 */
function buildOwnerCells(flows, ratesByOwner) {
  const cells = new Map();
  for (const f of flows) {
    const key = `${f.ownerId}|${f.propertyId}|${f.ym}`;
    let c = cells.get(key);
    if (!c) {
      c = { ownerId: f.ownerId, propertyId: f.propertyId, ym: f.ym, rent: 0, openingDebt: 0, prorata: 0, expenses: 0, commissionRaw: 0 };
      cells.set(key, c);
    }
    c[f.kind] += f.amount;
    const rate = pickRateValidAt(ratesByOwner.get(f.ownerId) || [], f.date)?.rate ?? 0;
    c.commissionRaw += (f.kind === 'expenses' ? -f.amount : f.amount) * (rate / 100);
  }
  for (const c of cells.values()) {
    c.recetteNette = c.rent + c.openingDebt + c.prorata - c.expenses;
    c.commission = Math.round(c.commissionRaw);
  }
  return cells;
}

/**
 * Recette nette d'un Bien pour un mois d'ENCAISSEMENT ('AAAA-MM') : loyers + dette initiale réglée +
 * prorata d'entrée reçus ce mois-là, moins les dépenses du Bien payées ce mois-là. (Avant la refonte du
 * 21/10/2026, les loyers étaient rangés par mois « couvert » : un loyer d'octobre payé en septembre
 * apparaissait en octobre sur la fiche du Bien mais en septembre dans le séquestre — incohérence supprimée.)
 */
async function getRecetteNetteMaison(tenantId, propertyId, yearMonth) {
  const flows = await loadOwnerFlows(tenantId, pool, { month: yearMonth, propertyId });
  const breakdown = { rent: 0, openingDebt: 0, prorata: 0 };
  let totalExpenses = 0;
  for (const f of flows) {
    if (f.kind === 'expenses') totalExpenses += f.amount;
    else breakdown[f.kind] += f.amount;
  }
  const totalPayments = breakdown.rent + breakdown.openingDebt + breakdown.prorata;
  return { totalPayments, totalExpenses, recetteNette: totalPayments - totalExpenses, breakdown };
}

/**
 * Recette d'un Bien pour un mois, ventilée entre le cabinet et le propriétaire : recette nette,
 * commission (chaque encaissement/dépense au taux du JOUR où il a eu lieu), part propriétaire.
 * `rate` = taux appliqué au dernier flux du mois (ou, à défaut de flux, taux du dernier jour du mois) ;
 * `rateChangedInMonth` signale un mois où plusieurs taux ont coexisté. Si aucun taux n'a jamais été défini
 * pour ce propriétaire, la commission vaut 0 % (`rateDefined: false`).
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
  const lastDay = lastDayOfMonth(yearMonth);
  // Étape 51bis : propriétaire EN VIGUEUR ce mois-là, jamais le propriétaire ACTUEL.
  const ownerId = (await resolveOwnerAtDate(tenantId, propertyId, lastDay)) ?? propertyRows[0].owner_id;

  const [flows, ratesByOwner] = await Promise.all([
    loadOwnerFlows(tenantId, pool, { month: yearMonth, propertyId }),
    loadRatesByOwner(tenantId),
  ]);
  const cells = [...buildOwnerCells(flows, ratesByOwner).values()];
  const breakdown = { rent: 0, openingDebt: 0, prorata: 0 };
  let totalExpenses = 0;
  let commissionCabinet = 0;
  for (const c of cells) {
    breakdown.rent += c.rent;
    breakdown.openingDebt += c.openingDebt;
    breakdown.prorata += c.prorata;
    totalExpenses += c.expenses;
    commissionCabinet += c.commission;
  }
  const totalPayments = breakdown.rent + breakdown.openingDebt + breakdown.prorata;
  const recetteNette = totalPayments - totalExpenses;

  const ownerRates = ratesByOwner.get(ownerId) || [];
  const lastFlowDate = flows.reduce((max, f) => (f.date > max ? f.date : max), '');
  const rateInfo = pickRateValidAt(ownerRates, lastFlowDate || lastDay);
  const distinctRates = new Set(flows.map((f) => pickRateValidAt(ownerRates, f.date)?.rate ?? 0));

  return {
    propertyId,
    ownerId,
    yearMonth,
    totalPayments,
    totalExpenses,
    recetteNette,
    breakdown,
    rate: rateInfo ? rateInfo.rate : 0,
    rateDefined: !!rateInfo,
    rateStartsOn: rateInfo?.startsOn ?? null,
    rateChangedInMonth: distinctRates.size > 1,
    commissionCabinet,
    partProprietaire: recetteNette - commissionCabinet,
  };
}

/**
 * Solde séquestre par propriétaire (mandat) : part propriétaire cumulée de TOUS ses Biens (flux du
 * chargeur ci-dessus, commission au taux du jour de chaque flux) moins les versements déjà effectués
 * (`owner_payouts`). Calculé pour tous les propriétaires du tenant en une passe ; volontairement PAS
 * filtré par la portée agent (voir `routes/owners.js`).
 *
 * `asOfDate` (bilan de clôture) : reconstruit le solde tel qu'il était à une date passée — borne chaque
 * source (flux, versements) par `<= asOfDate`. `null` = solde courant.
 *
 * Si `tenants.gl_commission_timing = 'reversement'`, la commission n'est prélevée comptablement qu'au
 * reversement (`computeReversementDeductions`) : le solde disponible reste alors BRUT (commission = 0 ici),
 * sinon elle serait déduite deux fois (audit du 30/09/2026).
 */
async function getEscrowBalances(tenantId, db = pool, asOfDate = null) {
  const [commissionDeductedAtCollection, flows, ratesByOwner] = await Promise.all([
    loadCommissionAtCollection(tenantId, db),
    loadOwnerFlows(tenantId, db, { asOfDate }),
    loadRatesByOwner(tenantId, db),
  ]);
  const [payoutRows] = await db.query(
    `SELECT owner_id, COALESCE(SUM(amount), 0) AS total FROM owner_payouts
     WHERE tenant_id = :tenantId${asOfDate ? ' AND paid_at <= :asOfDate' : ''} GROUP BY owner_id`,
    asOfDate ? { tenantId, asOfDate } : { tenantId },
  );
  const payoutsByOwner = new Map(payoutRows.map((r) => [r.owner_id, Number(r.total)]));

  const balances = new Map();
  for (const c of buildOwnerCells(flows, ratesByOwner).values()) {
    if (!balances.has(c.ownerId)) {
      balances.set(c.ownerId, { totalCollected: 0, totalPayouts: 0, balance: 0, breakdown: { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 } });
    }
    const b = balances.get(c.ownerId);
    b.breakdown.rent += c.rent;
    b.breakdown.openingDebt += c.openingDebt;
    b.breakdown.prorata += c.prorata;
    b.breakdown.expenses += c.expenses;
    b.totalCollected += c.recetteNette - (commissionDeductedAtCollection ? c.commission : 0);
  }
  for (const [ownerId, b] of balances) {
    b.totalPayouts = payoutsByOwner.get(ownerId) ?? 0;
    b.balance = b.totalCollected - b.totalPayouts;
  }
  // Versement sans aucune recette (anormal) : inclus avec un solde négatif explicite plutôt qu'absent.
  for (const [ownerId, totalPayouts] of payoutsByOwner) {
    if (!balances.has(ownerId)) {
      balances.set(ownerId, { totalCollected: 0, totalPayouts, balance: -totalPayouts, breakdown: { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 } });
    }
  }
  return balances;
}


/**
 * Bilan de clôture (demande utilisateur, 2026-10-18 : « les propriétaires reversé et non ») —
 * pour CHAQUE propriétaire ayant déjà perçu une recette, reconstruit son solde exactement comme
 * il était à la date de clôture du mois (`getEscrowBalances(tenantId, db, asOfDate)`) et le
 * classe : « reversé » (solde nul ou négatif à cette date — rien ne lui était plus dû) ou « non
 * reversé » (solde encore positif — il lui restait de l'argent dû). Décision explicite de
 * l'utilisateur (option B) : reconstruction historique, pas un simple « a reçu un versement ce
 * mois-ci » (qui confondrait un versement pour un AUTRE mois avec le solde réel de celui-ci).
 */
async function getOwnerPayoutStatusAsOf(tenantId, asOfDate, db = pool) {
  const balances = await getEscrowBalances(tenantId, db, asOfDate);
  const ownerIds = [...balances.keys()];
  if (ownerIds.length === 0) return { reversed: [], notReversed: [] };

  const [ownerRows] = await db.query('SELECT id, name FROM owners WHERE tenant_id = :tenantId', { tenantId });
  const ownerNameById = new Map(ownerRows.map((o) => [o.id, o.name]));

  const reversed = [];
  const notReversed = [];
  for (const [ownerId, b] of balances) {
    const entry = { ownerId, ownerName: ownerNameById.get(ownerId) ?? 'Propriétaire', balance: b.balance, totalCollected: b.totalCollected, totalPayouts: b.totalPayouts };
    if (b.balance > 0) notReversed.push(entry);
    else reversed.push(entry);
  }
  reversed.sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  notReversed.sort((a, b) => b.balance - a.balance);
  return { reversed, notReversed };
}

/**
 * Cautions actuellement détenues pour un propriétaire — demande utilisateur, 2026-10-17 : « je veux
 * que Recette nette cumulée soit détaillé ; la caution et le loyer ». Décision explicite : jamais
 * fondu dans `getEscrowBalances`/`totalCollected` ci-dessus (qui plafonne le reversement possible au
 * propriétaire) — une caution n'est pas un revenu, c'est l'argent du locataire, conservé puis
 * restitué (en tout ou partie) à son départ. Affichée À CÔTÉ, comme un fait séparé.
 *
 * « Détenues » = non encore restituées (`status = 'held'`) — une caution déjà rendue au locataire ne
 * représente plus rien que le cabinet détienne aujourd'hui, contrairement à `totalCollected` qui, lui,
 * reste volontairement CUMULÉ (jamais réduit par un reversement, suivi à part via `balance`).
 *
 * Deux sources distinctes, jamais recoupées (un bail a au plus une caution de loyer, et
 * indépendamment au plus une ligne par type dans `lease_deposits`) :
 *   - la caution de loyer (`leases.deposit_amount`), réellement reçue (`deposit_received_at`) et pas
 *     encore restituée (`deposit_status = 'held'`) ;
 *   - les cautions supplémentaires (étape 43 : SBEE/SONEB/peinture), `lease_deposits.status = 'held'`.
 *
 * Scope : propriétaire ACTUEL du Bien (`properties.owner_id`), pas l'historique
 * (`property_owner_history`) — contrairement à `getEscrowBalances` qui attribue un revenu DÉJÀ ENCAISSÉ
 * au propriétaire en vigueur à l'époque, une caution encore détenue aujourd'hui est une obligation de
 * restitution qui suit le mandat ACTUEL, quel qu'ait été le propriétaire au moment de l'encaissement.
 */
async function getDepositsHeldByOwner(tenantId, ownerId, db = pool) {
  const [depositRows] = await db.query(
    `SELECT COALESCE(SUM(l.deposit_amount), 0) AS total
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND p.owner_id = :ownerId
       AND l.deposit_received_at IS NOT NULL AND l.deposit_status = 'held'`,
    { tenantId, ownerId },
  );
  const [additionalRows] = await db.query(
    `SELECT ld.type, COALESCE(SUM(ld.amount), 0) AS total
     FROM lease_deposits ld
     JOIN leases l ON l.id = ld.lease_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE ld.tenant_id = :tenantId AND p.owner_id = :ownerId AND ld.status = 'held'
     GROUP BY ld.type`,
    { tenantId, ownerId },
  );

  const breakdown = { depositLoyer: Number(depositRows[0].total), sbee: 0, soneb: 0, peinture: 0 };
  for (const r of additionalRows) breakdown[r.type] = Number(r.total);
  const total = breakdown.depositLoyer + breakdown.sbee + breakdown.soneb + breakdown.peinture;
  return { total, breakdown };
}

/**
 * Revenu du CABINET lui-même pour un mois civil ('AAAA-MM'), tous propriétaires confondus, en base caisse :
 *   1. Commission — mode 'encaissement' (défaut) : somme des commissions de chaque (propriétaire, Bien)
 *      pour les flux encaissés CE mois-ci, chaque flux au taux du jour où il a eu lieu (mêmes cellules que
 *      le séquestre et la fiche du Bien : aucune divergence d'arrondi) ; mode 'reversement' : commission
 *      sur les VERSEMENTS réglés ce mois-ci, au taux du jour de chaque versement.
 *   2. Frais d'agence à l'entrée (100 % cabinet).
 *   3. Pénalités de retard RÉELLEMENT réglées (`late_fee_payments.paid_at`).
 *   4. Commission sur vente de biens (`sold_at`).
 * Moins les dépenses de FONCTIONNEMENT du cabinet (`expenses.property_id IS NULL`, payées ce mois-ci) ;
 * celles facturées à un Bien sont déjà déduites côté propriétaire.
 */
async function getCabinetRevenue(tenantId, yearMonth, db = pool) {
  const [commissionAtCollection, ratesByOwner] = await Promise.all([
    loadCommissionAtCollection(tenantId, db),
    loadRatesByOwner(tenantId, db),
  ]);

  let commission = 0;
  if (commissionAtCollection) {
    const flows = await loadOwnerFlows(tenantId, db, { month: yearMonth });
    for (const c of buildOwnerCells(flows, ratesByOwner).values()) commission += c.commission;
  } else {
    const [payoutRows] = await db.query(
      `SELECT owner_id, DATE_FORMAT(paid_at, '%Y-%m-%d') AS paid_on, amount FROM owner_payouts
       WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at, '%Y-%m') = :yearMonth`,
      { tenantId, yearMonth },
    );
    const rawByOwner = new Map();
    for (const r of payoutRows) {
      const rate = pickRateValidAt(ratesByOwner.get(r.owner_id) || [], r.paid_on)?.rate ?? 0;
      rawByOwner.set(r.owner_id, (rawByOwner.get(r.owner_id) ?? 0) + Number(r.amount) * (rate / 100));
    }
    for (const raw of rawByOwner.values()) commission += Math.round(raw);
  }

  const sum = async (sql) => Number((await db.query(sql, { tenantId, yearMonth }))[0][0].total);
  const entryFees = await sum(
    `SELECT COALESCE(SUM(entry_fee_amount), 0) AS total FROM leases
     WHERE tenant_id = :tenantId AND entry_fee_received_at IS NOT NULL AND DATE_FORMAT(entry_fee_received_at, '%Y-%m') = :yearMonth`,
  );
  const lateFees = await sum(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM late_fee_payments
     WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at, '%Y-%m') = :yearMonth`,
  );
  const saleCommissions = await sum(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total FROM sale_properties
     WHERE tenant_id = :tenantId AND status = 'vendu' AND deleted_at IS NULL AND DATE_FORMAT(sold_at, '%Y-%m') = :yearMonth`,
  );
  const otherIncomes = await sum(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM other_incomes
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND DATE_FORMAT(income_date, '%Y-%m') = :yearMonth`,
  );
  const expenses = await sum(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE tenant_id = :tenantId AND property_id IS NULL AND deleted_at IS NULL
       AND payment_status = 'paid' AND DATE_FORMAT(paid_at, '%Y-%m') = :yearMonth`,
  );

  return {
    yearMonth,
    breakdown: { commission, entryFees, lateFees, saleCommissions, otherIncomes, expenses },
    netCabinetIncome: commission + entryFees + lateFees + saleCommissions + otherIncomes - expenses,
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
  resolveOwnerAtDate,
  loadOwnerFlows,
  loadRatesByOwner,
  buildOwnerCells,
  assertPayoutWithinBalance,
  getActiveCommissionRate,
  getTauxCommissionActif,
  getRecetteNetteMaison,
  getRecetteProprietaire,
  getCabinetRevenue,
  getEscrowBalances,
  getOwnerPayoutStatusAsOf,
  getDepositsHeldByOwner,
  getUnpaidOpeningDebtByOwner,
  getOwnersWithoutCommissionRate,
};
