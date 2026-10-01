'use strict';

/**
 * États financiers SYSCOHADA — bilan, compte de résultat, tableau des flux de
 * trésorerie (livrable 8, "au minimum le squelette" selon le cahier des
 * charges). Calculs partagés entre l'écran (JSON) et les exports PDF/Excel,
 * même principe que `computeAccountingDashboard` côté comptabilité simple.
 *
 * Hypothèse explicite (à valider par l'expert-comptable) : aucune écriture
 * de clôture ne vire le résultat de l'exercice vers les comptes 121/129
 * (affectation du résultat) — ce module n'en génère pas non plus (jugement
 * comptable hors périmètre : politique de report à nouveau/dividendes). Le
 * résultat net affiché dans le bilan est donc une ligne CALCULÉE en direct
 * depuis les classes 6/7 (comme dans tout bilan "de situation" avant
 * affectation formelle), jamais une écriture réellement journalisée.
 */

async function fetchTrialBalanceRows(conn, tenantId, fiscalYearId) {
  const [rows] = await conn.query(
    `SELECT a.id, a.code, a.label, a.class, a.account_type,
            COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
     FROM gl_accounts a
     JOIN gl_entry_lines el ON el.account_id = a.id
     JOIN gl_entries e ON e.id = el.entry_id
     WHERE a.tenant_id = :tenantId AND e.fiscal_year_id = :fiscalYearId
     GROUP BY a.id, a.code, a.label, a.class, a.account_type
     ORDER BY a.code ASC`,
    { tenantId, fiscalYearId },
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    class: r.class,
    accountType: r.account_type,
    totalDebit: Number(r.total_debit),
    totalCredit: Number(r.total_credit),
  }));
}

/** Compte de résultat : produits (classe 7) et charges (classe 6) de l'exercice, résultat net. */
async function computeIncomeStatement(conn, tenantId, fiscalYearId) {
  const rows = await fetchTrialBalanceRows(conn, tenantId, fiscalYearId);

  const charges = rows
    .filter((r) => r.accountType === 'charge')
    .map((r) => ({ code: r.code, label: r.label, amount: r.totalDebit - r.totalCredit }))
    .filter((r) => r.amount !== 0);
  const produits = rows
    .filter((r) => r.accountType === 'produit')
    .map((r) => ({ code: r.code, label: r.label, amount: r.totalCredit - r.totalDebit }))
    .filter((r) => r.amount !== 0);

  const totalCharges = charges.reduce((s, r) => s + r.amount, 0);
  const totalProduits = produits.reduce((s, r) => s + r.amount, 0);

  return { charges, produits, totalCharges, totalProduits, resultatNet: totalProduits - totalCharges };
}

/**
 * Mêmes colonnes que `fetchTrialBalanceRows`, mais CUMULATIVES depuis le
 * tout premier mouvement du tenant jusqu'à `uptoDate` INCLUS — jamais
 * restreintes à un seul exercice. Même principe déjà établi par
 * `computeCashFlow` ci-dessous pour la trésorerie (`e.entry_date < :from`,
 * sans filtre `fiscal_year_id`), étendu ici à TOUS les comptes de bilan.
 */
async function fetchCumulativeTrialBalanceRows(conn, tenantId, uptoDate) {
  const [rows] = await conn.query(
    `SELECT a.id, a.code, a.label, a.class, a.account_type,
            COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
     FROM gl_accounts a
     JOIN gl_entry_lines el ON el.account_id = a.id
     JOIN gl_entries e ON e.id = el.entry_id
     WHERE a.tenant_id = :tenantId AND e.entry_date <= :uptoDate
     GROUP BY a.id, a.code, a.label, a.class, a.account_type
     ORDER BY a.code ASC`,
    { tenantId, uptoDate },
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    class: r.class,
    accountType: r.account_type,
    totalDebit: Number(r.total_debit),
    totalCredit: Number(r.total_credit),
  }));
}

/**
 * Bilan (situation provisoire) : actif (soldes débiteurs des comptes de
 * classes 2 à 5) et passif (soldes créditeurs des comptes de classe 1 et 4),
 * complété par le résultat net calculé (voir avertissement en tête de
 * fichier) pour équilibrer actif = passif.
 *
 * Bug corrigé (audit comptable du 30/09/2026) : les comptes de BILAN sont
 * des soldes qui PERSISTENT d'un exercice à l'autre (une trésorerie, une
 * dette, une créance ne repart jamais à zéro le 1er janvier) — contrairement
 * aux comptes de charges/produits (classes 6/7), qui doivent repartir de
 * zéro chaque exercice. Filtrer `actif`/`passif` sur le seul
 * `fiscal_year_id` de l'exercice consulté (comme le fait à raison
 * `computeIncomeStatement` pour les classes 6/7) sous-évaluait donc le bilan
 * dès le 2ᵉ exercice d'activité d'un tenant : aucune écriture de report à
 * nouveau n'existant (voir avertissement en tête de fichier — décision
 * assumée), le solde de clôture de l'exercice précédent n'apparaissait
 * simplement plus nulle part. Corrigé en calculant `actif`/`passif` de façon
 * CUMULATIVE (tous les mouvements du tenant depuis le début, jusqu'à la date
 * de fin de cet exercice INCLUSE — `fetchCumulativeTrialBalanceRows`
 * ci-dessus), et en calculant le résultat net utilisé pour ÉQUILIBRER le
 * bilan de la même façon cumulative (jamais seulement celui du dernier
 * exercice) : tant qu'aucune écriture n'affecte le résultat cumulé vers les
 * capitaux propres (121/129, hors périmètre assumé), la somme cumulée de
 * TOUS les mouvements des classes 6/7 depuis toujours EST exactement le
 * résultat non affecté à reporter — c'est cette même quantité qui, dans un
 * bilan classique, seraît normalement logée en report à nouveau (110/120).
 * `computeIncomeStatement`, lui, reste inchangé (affichage du résultat du
 * SEUL exercice consulté, correct pour cet usage précis).
 */
async function computeBalanceSheet(conn, tenantId, fiscalYearId) {
  const [fyRows] = await conn.query('SELECT end_date FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: fiscalYearId,
    tenantId,
  });
  if (!fyRows[0]) throw new Error(`Exercice comptable introuvable (id ${fiscalYearId})`);
  const uptoDate = fyRows[0].end_date instanceof Date ? fyRows[0].end_date.toISOString().slice(0, 10) : fyRows[0].end_date;

  const rows = await fetchCumulativeTrialBalanceRows(conn, tenantId, uptoDate);

  const actif = rows
    .filter((r) => r.accountType === 'actif' && r.class >= 2 && r.class <= 5)
    .map((r) => ({ code: r.code, label: r.label, amount: r.totalDebit - r.totalCredit }))
    .filter((r) => r.amount !== 0);
  const passif = rows
    .filter((r) => r.accountType === 'passif' && (r.class === 1 || r.class === 4))
    .map((r) => ({ code: r.code, label: r.label, amount: r.totalCredit - r.totalDebit }))
    .filter((r) => r.amount !== 0);

  // Résultat CUMULÉ (jamais seulement celui de l'exercice consulté) — voir
  // le commentaire de fonction ci-dessus pour le raisonnement complet.
  const chargesCumul = rows.filter((r) => r.accountType === 'charge').reduce((s, r) => s + (r.totalDebit - r.totalCredit), 0);
  const produitsCumul = rows.filter((r) => r.accountType === 'produit').reduce((s, r) => s + (r.totalCredit - r.totalDebit), 0);
  const resultatNet = produitsCumul - chargesCumul;

  const totalActifBrut = actif.reduce((s, r) => s + r.amount, 0);
  const totalPassifBrut = passif.reduce((s, r) => s + r.amount, 0);

  // Le résultat complète le côté le plus léger, comme dans un bilan papier :
  // un bénéfice s'ajoute au passif (capitaux propres), une perte à l'actif.
  const totalActif = totalActifBrut + (resultatNet < 0 ? -resultatNet : 0);
  const totalPassif = totalPassifBrut + (resultatNet > 0 ? resultatNet : 0);

  return { actif, passif, resultatNet, totalActif, totalPassif, balanced: totalActif === totalPassif };
}

/**
 * Tableau des flux de trésorerie (squelette, comme demandé) : solde
 * d'ouverture/clôture des comptes de trésorerie (classe 5) sur une période
 * libre, total encaissements/décaissements. Pas de ventilation par nature
 * d'activité (exploitation/investissement/financement) — nécessiterait un
 * classement compte par compte qui n'a pas été validé par un expert-comptable.
 */
async function computeCashFlow(conn, tenantId, { from, to }) {
  const [[opening]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE -el.amount END), 0) AS balance
     FROM gl_entry_lines el
     JOIN gl_entries e ON e.id = el.entry_id
     JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :tenantId AND a.class = 5 AND e.entry_date < :from`,
    { tenantId, from },
  );
  const [[period]] = await conn.query(
    `SELECT
       COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS inflows,
       COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS outflows
     FROM gl_entry_lines el
     JOIN gl_entries e ON e.id = el.entry_id
     JOIN gl_accounts a ON a.id = el.account_id
     WHERE e.tenant_id = :tenantId AND a.class = 5 AND e.entry_date BETWEEN :from AND :to`,
    { tenantId, from, to },
  );

  const openingBalance = Number(opening.balance);
  const totalInflows = Number(period.inflows);
  const totalOutflows = Number(period.outflows);
  const closingBalance = openingBalance + totalInflows - totalOutflows;

  return { openingBalance, totalInflows, totalOutflows, closingBalance, netVariation: totalInflows - totalOutflows };
}

module.exports = { computeIncomeStatement, computeBalanceSheet, computeCashFlow };
