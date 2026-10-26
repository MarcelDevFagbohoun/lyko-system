'use strict';

/**
 * Calcul du tableau de bord comptable pour une période — réutilisé tel quel par `GET /dashboard` (JSON,
 * écran), `GET /dashboard.pdf` (rapport mensuel exportable, étape 18) et l'assistant IA : un seul calcul,
 * jamais dupliqué entre les formats de sortie. Déplacé à l'identique depuis `routes/accounting.js`.
 */

const { pool } = require('../config/db');
const { toActor } = require('../utils/actor');
const { isPeriodClosed, getPeriodClosability } = require('./accountingPeriods');
const { listPortfolioArrears } = require('./rentTracking');
const {
  getEscrowBalances,
  getUnpaidOpeningDebtByOwner,
  getOwnersWithoutCommissionRate,
  getCabinetRevenue,
} = require('./commission');
const { resolvePropertyScope } = require('./scope');
const { getMonthBilan } = require('./monthBilan');

/**
 * Calcul du tableau de bord comptable pour une période — extrait en
 * fonction nommée pour être réutilisé tel quel par `GET /dashboard` (JSON,
 * écran) et `GET /dashboard.pdf` (rapport mensuel exportable, étape 18) :
 * un seul calcul, jamais dupliqué entre les deux formats de sortie.
 */
async function computeAccountingDashboard(user, { from, to }) {
  const params = { tenantId: user.tenantId, from, to };

  const [[rentRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM rent_payments WHERE tenant_id = :tenantId AND paid_at BETWEEN :from AND :to AND deleted_at IS NULL`,
    params,
  );
  const [[payoutRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM owner_payouts WHERE tenant_id = :tenantId AND paid_at BETWEEN :from AND :to`,
    params,
  );
  // Frais d'agence pris directement au locataire à l'entrée — 100 % produit
  // du cabinet, JAMAIS compté dans la recette du propriétaire (voir
  // `routes/renters.js` `recordEntryFeeReceived`) : un total à part, jamais
  // mélangé à `rentCollected` ci-dessus qui, lui, se répartit encore entre
  // commission et propriétaire.
  const [[entryFeeRow]] = await pool.query(
    `SELECT COALESCE(SUM(entry_fee_amount), 0) AS total, COUNT(*) AS n
     FROM leases WHERE tenant_id = :tenantId AND entry_fee_received_at BETWEEN :from AND :to`,
    params,
  );
  // Commission sur vente d'un bien à vendre (bouton « Vendu », demande utilisateur 2026-10-18) —
  // même principe que `entryFeeRow` ci-dessus : 100 % produit du cabinet, groupée par date de vente
  // réelle (`sold_at`).
  const [[saleCommissionRow]] = await pool.query(
    `SELECT COALESCE(SUM(commission_amount), 0) AS total, COUNT(*) AS n
     FROM sale_properties
     WHERE tenant_id = :tenantId AND status = 'vendu' AND deleted_at IS NULL AND sold_at BETWEEN :from AND :to`,
    params,
  );
  // Autres entrées du cabinet (Comptabilité → Autres entrées, 21/10/2026) : 100 % produit du cabinet.
  const [[otherIncomeRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM other_incomes
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND income_date BETWEEN :from AND :to`,
    params,
  );
  // Dépenses du CABINET uniquement (`property_id IS NULL`) : les travaux
  // facturés à un Bien précis ne sont pas un coût de fonctionnement de
  // l'entreprise — ils sont déjà déduits de la recette du PROPRIÉTAIRE
  // concerné (`services/commission.js`, `getRecetteProprietaire`, carte
  // « Recette du mois » sur la fiche du Bien). Les compter aussi ici
  // ferait payer deux fois le même travaux : une fois au propriétaire, une
  // fois (à tort) au solde du cabinet.
  // Haute #7 (étape 51) : base caisse réelle (`paid_at`), jamais `expense_date` — une dépense « à
  // crédit » encore impayée ne doit jamais réduire `netCashFlow` tant qu'aucun argent n'est réellement
  // sorti (même correctif que `services/commission.js getCabinetRevenue`/`getEscrowBalances`).
  const [[expenseRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL
       AND payment_status = 'paid' AND paid_at BETWEEN :from AND :to`,
    params,
  );
  const [byCategory] = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL
       AND payment_status = 'paid' AND paid_at BETWEEN :from AND :to
     GROUP BY category ORDER BY total DESC`,
    params,
  );
  // Informatif seulement : total des travaux facturés aux Biens sur la
  // période, pour ne pas donner l'impression que cet argent a disparu du
  // suivi — il reste visible ici, et déduit là où il doit l'être (fiche du
  // propriétaire concerné), jamais dans les totaux du cabinet ci-dessus.
  // Haute #7 (étape 51) : même correctif — doit rester cohérent avec `getRecetteNetteMaison`/
  // `getEscrowBalances`, qui déduisent désormais ces mêmes dépenses sur `paid_at`, jamais `expense_date`.
  const [[propertyExpenseRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NOT NULL
       AND payment_status = 'paid' AND paid_at BETWEEN :from AND :to`,
    params,
  );

  // Charges SONEB/SBEE impayées : pas de filtre de période — un impayé reste dû tant qu'il n'est pas
  // réglé, quelle que soit la date de facturation.
  // Étape 51bis (Moyenne #2) : `status = 'impayee'` seul ignorait toute facture PARTIELLEMENT réglée
  // (`status = 'partiellement_payee'`, voir `recordUtilityPayment`) — un reste à payer de plusieurs
  // milliers de FCFA disparaissait du total, contrairement à `GET /api/charges/month-summary` (déjà
  // correct : `status <> 'payee'`) et au registre des charges. Corrigé en reprenant exactement le même
  // calcul : `status <> 'payee'` et le RESTE DÛ (`amount - payé`), jamais le montant facturé en entier.
  const paidPerCharge = '(SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id)';
  const [[unpaidChargesRow]] = await pool.query(
    `SELECT COALESCE(SUM(uc.amount - COALESCE(pt.paid_total, 0)), 0) AS total, COUNT(*) AS n
     FROM utility_charges uc LEFT JOIN ${paidPerCharge} pt ON pt.charge_id = uc.id
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee'`,
    { tenantId: user.tenantId },
  );
  const [unpaidByType] = await pool.query(
    `SELECT uc.utility_type, COALESCE(SUM(uc.amount - COALESCE(pt.paid_total, 0)), 0) AS total, COUNT(*) AS n
     FROM utility_charges uc LEFT JOIN ${paidPerCharge} pt ON pt.charge_id = uc.id
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee'
     GROUP BY uc.utility_type`,
    { tenantId: user.tenantId },
  );

  // Impayés locataires : estimation par bail actif en retard (jours de
  // retard × loyer déjà connus via computeArrears), pas une écriture
  // enregistrée — « si ça existe, le système fait l'addition ». Calcul
  // partagé avec GET /arrears (centre de relance groupée, étape 10).
  // Portée « Biens gérés » (étape 14) : un agent restreint (rare ici, ce
  // module exige `comptabilite`) ne voit que ses propres impayés.
  const scopeAgentId = await resolvePropertyScope(user);
  // Mois déjà terminé : impayés tels qu'ils étaient À LA FIN de la période (jamais l'état d'aujourd'hui).
  const todayStr = new Date().toISOString().slice(0, 10);
  const portfolioArrears = await listPortfolioArrears(user.tenantId, scopeAgentId, to < todayStr ? to : null);
  const tenantArrears = portfolioArrears.map((a) => ({
    leaseId: a.leaseId,
    renterName: a.renterName,
    daysLate: a.daysLate,
    unpaidMonths: a.unpaidMonths,
    openingDebtRemaining: a.openingDebtRemaining,
    lateFeesRemaining: a.lateFeesRemaining,
    amountOwed: a.amountOwed,
  }));
  const tenantArrearsTotal = portfolioArrears.reduce((sum, a) => sum + a.amountOwed, 0);

  // Comptes séquestres par mandat : combien le cabinet détient
  // ACTUELLEMENT pour chaque propriétaire (cumulé depuis toujours, pas
  // borné à la période affichée — voir `getEscrowBalances`). Volontairement
  // pas scopé par agent, comme le reste des totaux ci-dessous : ce module
  // exige déjà la permission `comptabilite`, pas une simple visibilité agent.
  const escrowBalances = await getEscrowBalances(user.tenantId);
  // Dette initiale non réglée — volontairement à part du solde séquestre
  // réel ci-dessus (voir `getUnpaidOpeningDebtByOwner`), jamais mélangée.
  const unpaidOpeningDebtByOwner = await getUnpaidOpeningDebtByOwner(user.tenantId);
  // Garde-fou (cas réel trouvé le 22/09/2026, AKOAKOU Jean) : propriétaires
  // avec des loyers déjà encaissés mais AUCUN taux jamais défini — 0 %
  // appliqué en silence sinon. Jamais borné à la période affichée (comme
  // escrowBalances ci-dessus) : un taux manquant reste un problème tant
  // qu'il n'est pas réglé, peu importe le mois consulté.
  const ownersWithoutCommissionRate = await getOwnersWithoutCommissionRate(user.tenantId);
  const [ownerRows] = await pool.query('SELECT id, name FROM owners WHERE tenant_id = :tenantId', {
    tenantId: user.tenantId,
  });
  const ownerNameById = new Map(ownerRows.map((o) => [o.id, o.name]));
  const allOwnerIds = new Set([...escrowBalances.keys(), ...unpaidOpeningDebtByOwner.keys()]);
  const escrowByOwner = [...allOwnerIds]
    .map((ownerId) => {
      const b = escrowBalances.get(ownerId) ?? { totalCollected: 0, totalPayouts: 0, balance: 0, breakdown: { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 } };
      return {
        ownerId,
        ownerName: ownerNameById.get(ownerId) ?? 'Propriétaire',
        ...b,
        openingDebtUnpaid: unpaidOpeningDebtByOwner.get(ownerId) ?? 0,
      };
    })
    .filter((b) => b.balance !== 0 || b.openingDebtUnpaid > 0)
    .sort((a, b) => b.balance - a.balance);
  const escrowTotal = escrowByOwner.reduce((sum, b) => sum + b.balance, 0);
  const openingDebtUnpaidTotal = escrowByOwner.reduce((sum, b) => sum + b.openingDebtUnpaid, 0);

  // Recette nette du CABINET lui-même (étape 44, demande explicite de l'utilisateur) — TOUJOURS par
  // mois (comme la recette nette d'un Bien, `getRecetteNetteMaison`), jamais par plage arbitraire :
  // `null` si la période demandée ne correspond pas exactement à un seul mois calendaire (ex. export
  // sur une plage personnalisée dans Comptabilité), plutôt que d'afficher un chiffre à cheval sur
  // plusieurs mois qui n'aurait pas le même sens que la carte du tableau de bord.
  const cabinetRevenue = from.slice(0, 7) === to.slice(0, 7) ? await getCabinetRevenue(user.tenantId, from.slice(0, 7)) : null;

  // Trésorerie RÉELLE du mois (toutes entrées − toutes sorties, argent des propriétaires, cautions et charges
  // en transit inclus) : distincte du résultat du cabinet ci-dessus (décision du 21/10/2026, « les deux,
  // séparés »). `null` hors mois calendaire unique.
  const treasury =
    from.slice(0, 7) === to.slice(0, 7) ? (await getMonthBilan(user.tenantId, from.slice(0, 7), { light: true })).treasury : null;

  const rentCollected = Number(rentRow.total);
  const ownerPayouts = Number(payoutRow.total);
  const expensesTotal = Number(expenseRow.total);
  const propertyExpensesTotal = Number(propertyExpenseRow.total);
  const entryFeesCollected = Number(entryFeeRow.total);
  const saleCommissionsCollected = Number(saleCommissionRow.total);
  const otherIncomesCollected = Number(otherIncomeRow.total);

  const period = from.slice(0, 7);
  const closed = await isPeriodClosed(user.tenantId, from);
  let closedInfo = null;
  let closability = null;
  if (closed) {
    const [[row]] = await pool.query(
      `SELECT ap.closed_at, ap.forced, u.first_name, u.last_name, u.role
       FROM accounting_periods ap JOIN users u ON u.id = ap.closed_by
       WHERE ap.tenant_id = :tenantId AND ap.period = :period LIMIT 1`,
      { tenantId: user.tenantId, period },
    );
    closedInfo = {
      closedAt: row.closed_at,
      closedBy: toActor(row.first_name, row.last_name, row.role),
      forced: !!row.forced,
    };
  } else {
    // Clôturabilité (étape ajustement clôture) : l'échéance de loyer la
    // plus tardive parmi les baux actifs de ce mois précis, propre à
    // chaque locataire (`rent_due_day`), plus une marge de sécurité —
    // jamais une date de clôture choisie à l'aveugle.
    const c = await getPeriodClosability(user.tenantId, period);
    closability = {
      status: c.isClosable ? 'closable' : 'open',
      closableFrom: c.closableFrom,
      maxDueDay: c.maxDueDay,
      pendingLeases: c.pendingLeases,
    };
  }

  return {
    period: { from, to },
    isClosed: closed,
    closedInfo,
    closability,
    totals: {
      rentCollected,
      rentCollectedCount: Number(rentRow.n),
      ownerPayouts,
      ownerPayoutsCount: Number(payoutRow.n),
      expenses: expensesTotal,
      expensesCount: Number(expenseRow.n),
      // Informatif : travaux facturés à un Bien, EXCLUS de `expenses` et
      // de `netCashFlow` ci-dessous — à la charge du propriétaire concerné
      // (déjà déduits de sa recette), jamais du cabinet.
      propertyExpenses: propertyExpensesTotal,
      propertyExpensesCount: Number(propertyExpenseRow.n),
      unpaidCharges: Number(unpaidChargesRow.total),
      unpaidChargesCount: Number(unpaidChargesRow.n),
      tenantArrears: tenantArrearsTotal,
      tenantArrearsCount: tenantArrears.length,
      // 100 % produit du cabinet (jamais reversé) : s'ajoute au flux net,
      // contrairement à `rentCollected` qui inclut la part à reverser aux
      // propriétaires (déjà déduite via `ownerPayouts`).
      entryFeesCollected,
      entryFeesCollectedCount: Number(entryFeeRow.n),
      // Même principe que `entryFeesCollected` : 100 % produit du cabinet, s'ajoute au flux net.
      saleCommissionsCollected,
      saleCommissionsCollectedCount: Number(saleCommissionRow.n),
      otherIncomes: otherIncomesCollected,
      otherIncomesCount: Number(otherIncomeRow.n),
      treasuryNet: treasury ? treasury.net : null,
      treasuryIn: treasury ? treasury.in : null,
      treasuryOut: treasury ? treasury.out : null,
      netCashFlow: rentCollected - ownerPayouts - expensesTotal + entryFeesCollected + saleCommissionsCollected + otherIncomesCollected,
    },
    expensesByCategory: byCategory.map((r) => ({ category: r.category, total: Number(r.total) })),
    unpaidChargesByType: unpaidByType.map((r) => ({
      utilityType: r.utility_type,
      total: Number(r.total),
      count: Number(r.n),
    })),
    tenantArrears,
    // Comptes séquestres par mandat : solde cumulé depuis toujours, pas
    // borné à `period.from/to` (contrairement à `totals` ci-dessus).
    escrow: { total: escrowTotal, openingDebtUnpaidTotal, byOwner: escrowByOwner },
    ownersWithoutCommissionRate,
    cabinetRevenue,
  };
}

module.exports = { computeAccountingDashboard };
