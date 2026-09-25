'use strict';

const { pool } = require('../config/db');

/** Mois suivant au format 'YYYY-MM'. */
function addMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m (non m-1) avance déjà d'un mois
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Décompose un nombre de jours de retard en mois pleins + jours restants,
 * de façon exacte au calendrier (jamais une simple division par ~30) : le
 * nombre de mois pleins écoulés entre `dueDate` et `todayUtc`, puis le
 * reste en jours. Demande directe de l'utilisateur : au-delà d'un mois de
 * retard, l'information doit d'abord se lire en mois + jours, pas
 * seulement en jours bruts (peu lisible passé quelques dizaines de jours).
 */
function monthsAndDaysLate(dueDate, todayUtc) {
  let months =
    (todayUtc.getUTCFullYear() - dueDate.getUTCFullYear()) * 12 + (todayUtc.getUTCMonth() - dueDate.getUTCMonth());
  if (todayUtc.getUTCDate() < dueDate.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const afterMonths = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + months, dueDate.getUTCDate()));
  const remainderDays = Math.max(0, Math.round((todayUtc - afterMonths) / 86_400_000));
  return { months, remainderDays };
}

/** Date ISO 'AAAA-MM-JJ' à partir d'une chaîne ou d'un objet Date MySQL. */
function toIsoDateString(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Calcule le statut de paiement d'un bail : mois payés (à partir de la date
 * de début et des paiements enregistrés), prochaine échéance, retard éventuel.
 * `payments` : tableau de { coversMonth: 'YYYY-MM', amount }. `amount` est
 * OPTIONNEL (voir `monthlyRent` ci-dessous) pour ne jamais casser un appelant
 * qui ne le fournirait pas encore.
 *
 * `createdAt` (date d'enregistrement sur la plateforme) et
 * `upToDateAtOnboarding` : corrigent un vrai biais — sans eux, un locataire
 * entré dans les lieux il y a des mois/années mais enregistré aujourd'hui
 * ressortirait comme devant tout ce temps, alors qu'il n'a peut-être jamais
 * manqué un paiement (juste jamais suivi ici). Le suivi ne peut jamais
 * démarrer avant `createdAt` : `startDate` reste le fait historique (contrat,
 * état des lieux) mais seul, sans plafond, il ferait remonter le retard
 * avant même que Lyko System n'existe pour ce bail. `upToDateAtOnboarding`
 * (coché explicitement par l'agent à la création) couvre le dernier résidu :
 * le mois de l'enregistrement lui-même, également considéré couvert.
 * `createdAt` omis (compatibilité) : aucun plafond, comportement historique
 * inchangé.
 *
 * `monthlyRent` (audit comptable du 23/09/2026, anomalie A1) : SANS lui, un
 * mois est considéré réglé dès qu'AU MOINS UNE ligne `rent_payments` existe
 * pour ce mois, quel que soit son montant — un paiement PARTIEL (40000 sur
 * un loyer de 100000) faisait alors avancer `nextDueMonth` exactement comme
 * un paiement complet, effaçant silencieusement pour toujours les 60000
 * restants des calculs d'arriérés. AVEC `monthlyRent` fourni, `nextDueMonth`
 * n'avance que lorsque le CUMUL des paiements d'un mois atteint réellement
 * le loyer dû. `monthlyRent` omis (compatibilité, appelant non encore mis à
 * jour) : comportement historique (buggé) inchangé — ne JAMAIS omettre pour
 * un nouvel appel.
 */
function computeArrears(
  { startDate, createdAt, upToDateAtOnboarding, rentDueDay, rentTiming, monthlyRent, payments },
  today = new Date(),
) {
  const createdAtIso = createdAt ? toIsoDateString(createdAt) : null;
  const baselineDate = createdAtIso && createdAtIso > startDate ? createdAtIso : startDate;
  let baselineMonth = baselineDate.slice(0, 7);
  if (upToDateAtOnboarding) baselineMonth = addMonth(baselineMonth);

  const paidThrough = payments.length > 0 ? payments.map((p) => p.coversMonth).sort().at(-1) : null;

  const rent = monthlyRent != null ? Number(monthlyRent) : null;
  let nextDueMonth;
  let paidForNextDueMonth = 0;
  if (rent != null && rent > 0) {
    const paidByMonth = new Map();
    for (const p of payments) {
      paidByMonth.set(p.coversMonth, (paidByMonth.get(p.coversMonth) ?? 0) + Number(p.amount ?? 0));
    }
    // Avance mois par mois tant que le cumul payé pour CE mois atteint (ou
    // dépasse) le loyer dû — termine forcément vite : au-delà du dernier
    // mois cumulé dans `paidByMonth`, le cumul vaut 0 < rent, la boucle
    // s'arrête donc au plus tard un mois après le dernier paiement connu.
    let month = baselineMonth;
    while ((paidByMonth.get(month) ?? 0) >= rent) {
      month = addMonth(month);
    }
    nextDueMonth = month;
    paidForNextDueMonth = paidByMonth.get(nextDueMonth) ?? 0;
  } else {
    // Comportement historique (compatibilité, `monthlyRent` omis) : présence
    // d'AU MOINS UNE ligne pour un mois = mois considéré réglé, quel que
    // soit son montant réel.
    nextDueMonth = paidThrough && paidThrough >= baselineMonth ? addMonth(paidThrough) : baselineMonth;
  }

  // Convention de paiement (demande directe de l'utilisateur, 2026-09-24) :
  // 'terme_echu' repousse l'échéance au mois SUIVANT celui facturé (le
  // loyer de septembre ne se paie qu'en octobre) — 'avance' (défaut,
  // comportement historique) et l'omission de `rentTiming` restent
  // strictement identiques : l'échéance reste dans le mois facturé lui-même.
  const dueMonthForDate = rentTiming === 'terme_echu' ? addMonth(nextDueMonth) : nextDueMonth;
  const [y, m] = dueMonthForDate.split('-').map(Number);
  const dueDate = new Date(Date.UTC(y, m - 1, rentDueDay));
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysLate = Math.floor((todayUtc - dueDate) / 86_400_000);
  const { months: monthsLate, remainderDays: remainderDaysLate } =
    daysLate > 0 ? monthsAndDaysLate(dueDate, todayUtc) : { months: 0, remainderDays: 0 };

  return {
    paidThroughMonth: paidThrough,
    nextDueMonth,
    // Combien est déjà réglé pour `nextDueMonth` (0 si rien) — permet à
    // `allocateRentPayment` de COMPLÉTER un mois déjà partiellement payé au
    // lieu de repartir de zéro sur ce même mois.
    paidForNextDueMonth,
    dueDate: dueDate.toISOString().slice(0, 10),
    daysLate,
    monthsLate,
    remainderDaysLate,
    status: daysLate > 0 ? 'late' : 'current',
  };
}

/**
 * Répartit un montant total sur des mois de loyer consécutifs à partir de
 * `nextDueMonth` : d'abord le reliquat d'un mois déjà partiellement payé
 * (`alreadyPaidForNextDueMonth`, audit comptable A1 — sans ça, un paiement
 * de complément créerait à tort un NOUVEAU mois plutôt que de compléter
 * celui en cours), puis autant de mois complets que le montant restant le
 * permet, puis le reste éventuel en paiement partiel sur le mois suivant
 * (décision produit : « mois entiers + reste en partiel »). Renvoie la
 * liste des écritures à créer, une par mois (chacune donnera lieu à sa
 * propre quittance) — plusieurs lignes peuvent désormais partager le même
 * `coversMonth` (le complément d'un mois déjà partiel), sciemment : c'est
 * leur SOMME que `computeArrears` compare au loyer, jamais une ligne isolée.
 */
function allocateRentPayment({ nextDueMonth, monthlyRent, alreadyPaidForNextDueMonth = 0, amount }) {
  const rent = Number(monthlyRent);
  let remaining = Number(amount);
  const allocations = [];
  let month = nextDueMonth;

  if (rent > 0) {
    const shortfall = Math.max(0, rent - Number(alreadyPaidForNextDueMonth));
    if (shortfall > 0) {
      const toApply = Math.min(remaining, shortfall);
      if (toApply > 0) {
        allocations.push({ coversMonth: month, amount: toApply, isPartial: toApply < shortfall });
        remaining -= toApply;
      }
      if (toApply < shortfall) {
        // Montant épuisé avant d'avoir complété même ce premier mois.
        return { fullMonths: 0, partialAmount: 0, monthsCovered: allocations.length, allocations };
      }
      month = addMonth(month);
    }
  }

  const fullMonths = rent > 0 ? Math.floor(remaining / rent) : 0;
  const partialAmount = rent > 0 ? remaining % rent : remaining;
  for (let i = 0; i < fullMonths; i += 1) {
    allocations.push({ coversMonth: month, amount: rent, isPartial: false });
    month = addMonth(month);
  }
  if (partialAmount > 0) {
    allocations.push({ coversMonth: month, amount: partialAmount, isPartial: true });
  }
  return { fullMonths, partialAmount, monthsCovered: allocations.length, allocations };
}

/** Nombre de mois entre deux 'AAAA-MM' inclus (>= 1 si `to` >= `from`). */
function monthsBetweenInclusive(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Un paiement a-t-il été réglé APRÈS l'échéance de son propre mois (même
 * convention que `computeArrears` : le jour de l'échéance lui-même n'est pas
 * en retard, seulement le lendemain) ? `paidAt` peut être un objet `Date`
 * (colonne DATE MySQL) ou une chaîne 'AAAA-MM-JJ'. `rentTiming` (voir
 * `computeArrears`) : 'terme_echu' repousse l'échéance au mois suivant.
 */
function isPaymentLate(coversMonth, rentDueDay, paidAt, rentTiming) {
  const dueMonthForDate = rentTiming === 'terme_echu' ? addMonth(coversMonth) : coversMonth;
  const [y, m] = dueMonthForDate.split('-').map(Number);
  const dueDate = new Date(Date.UTC(y, m - 1, rentDueDay));
  const paid = paidAt instanceof Date ? paidAt : new Date(paidAt);
  const paidUtc = new Date(Date.UTC(paid.getUTCFullYear(), paid.getUTCMonth(), paid.getUTCDate()));
  return paidUtc > dueDate;
}

/**
 * Liste tous les baux actifs en retard de paiement pour l'ensemble du
 * portefeuille d'un tenant (pas seulement une période) — utilisée par le
 * tableau de bord comptable (étape 8, impayés locataires) et le centre de
 * relance groupée (étape 10). Le montant dû reste une estimation calculée
 * automatiquement (mois dus × loyer), jamais une saisie.
 *
 * `scopeAgentId` (étape 14) : un agent restreint ne voit que les impayés des
 * baux sur un Bien qui lui est attribué — voir services/scope.js.
 */
async function listPortfolioArrears(tenantId, scopeAgentId = null) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [activeLeases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_timing, l.opening_debt_amount,
            l.created_at, l.up_to_date_at_onboarding,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE l.tenant_id = :tenantId AND l.status = 'active' ${scopeClause}`,
    params,
  );
  if (activeLeases.length === 0) return [];

  const leaseIds = activeLeases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, amount FROM rent_payments WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    paymentsByLease.get(p.lease_id).push({ coversMonth: p.covers_month, amount: Number(p.amount) });
  }

  const [openingDebtPaid] = await pool.query(
    `SELECT lease_id, SUM(amount) AS paid FROM lease_opening_debt_payments WHERE lease_id IN (${placeholders}) GROUP BY lease_id`,
    leaseIds,
  );
  const openingDebtPaidByLease = new Map(openingDebtPaid.map((r) => [r.lease_id, Number(r.paid)]));

  const currentMonth = new Date().toISOString().slice(0, 7);
  const results = [];
  for (const lease of activeLeases) {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const arrears = computeArrears({
      startDate,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      rentTiming: lease.rent_timing,
      monthlyRent: lease.monthly_rent,
      payments: paymentsByLease.get(lease.id) || [],
    });
    const openingDebtRemaining = Number(lease.opening_debt_amount) - (openingDebtPaidByLease.get(lease.id) || 0);
    // Un bail peut devoir de l'argent pour DEUX raisons indépendantes : du
    // loyer en retard (calculé au jour près) ET/OU un reliquat de dette
    // initiale jamais soldé (onboarding) — l'un n'empêche jamais l'autre
    // d'apparaître dans la liste de relance.
    if (arrears.status === 'late' || openingDebtRemaining > 0) {
      const unpaidMonths = arrears.status === 'late' ? Math.max(1, monthsBetweenInclusive(arrears.nextDueMonth, currentMonth)) : 0;
      // Audit comptable, anomalie A1 : le mois en cours (`nextDueMonth`)
      // peut déjà être partiellement réglé (`paidForNextDueMonth`) — ne
      // JAMAIS compter le loyer plein de ce mois sans en déduire ce qui est
      // déjà payé, sous peine de facturer deux fois le même reliquat.
      const rentOwed = Math.max(0, unpaidMonths * Number(lease.monthly_rent) - arrears.paidForNextDueMonth);
      results.push({
        leaseId: lease.id,
        renterId: lease.renter_id,
        renterName: `${lease.first_name} ${lease.last_name}`,
        phone: lease.phone,
        unitCode: lease.unit_code,
        propertyCode: lease.property_code,
        monthlyRent: Number(lease.monthly_rent),
        dueDate: arrears.dueDate,
        daysLate: arrears.daysLate,
        unpaidMonths,
        openingDebtRemaining,
        amountOwed: rentOwed + openingDebtRemaining,
      });
    }
  }
  return results;
}

/**
 * Fige, pour chaque bail actif pendant le mois `period` clôturé, le montant
 * dû à cet instant (loyers en retard + reliquat de dette initiale non
 * soldé) dans `lease_balance_snapshots` — décision explicite de
 * l'utilisateur : un mois clôturé ne doit jamais changer de réponse à « que
 * devait-il à cette date-là », même si `computeArrears` évolue plus tard.
 * INSERT-only, appelé une seule fois par `POST /api/accounting/periods`
 * juste après la clôture — la contrainte UNIQUE (tenant_id, period,
 * lease_id) protège aussi contre un double appel accidentel.
 *
 * Portée des baux : même critère que `getPeriodClosability`
 * (`accountingPeriods.js`) — chevauche la période, actif ou déjà terminé,
 * jamais seulement `status = 'active'` (un bail terminé en cours de mois
 * devait encore quelque chose au moment de la clôture).
 */
async function snapshotLeaseBalances(tenantId, period) {
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const [leases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_timing, l.opening_debt_amount,
            l.created_at, l.up_to_date_at_onboarding
     FROM leases l
     WHERE l.tenant_id = :tenantId AND l.start_date <= :last AND (l.end_date IS NULL OR l.end_date >= :first)`,
    { tenantId, first, last },
  );
  if (leases.length === 0) return;

  const leaseIds = leases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, amount FROM rent_payments WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    paymentsByLease.get(p.lease_id).push({ coversMonth: p.covers_month, amount: Number(p.amount) });
  }
  const [openingDebtPaid] = await pool.query(
    `SELECT lease_id, SUM(amount) AS paid FROM lease_opening_debt_payments WHERE lease_id IN (${placeholders}) GROUP BY lease_id`,
    leaseIds,
  );
  const openingDebtPaidByLease = new Map(openingDebtPaid.map((r) => [r.lease_id, Number(r.paid)]));

  const currentMonth = new Date().toISOString().slice(0, 7);
  const rows = leases.map((lease) => {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const arrears = computeArrears({
      startDate,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      rentTiming: lease.rent_timing,
      monthlyRent: lease.monthly_rent,
      payments: paymentsByLease.get(lease.id) || [],
    });
    const unpaidMonths = arrears.status === 'late' ? Math.max(1, monthsBetweenInclusive(arrears.nextDueMonth, currentMonth)) : 0;
    const openingDebtRemaining = Math.max(0, Number(lease.opening_debt_amount) - (openingDebtPaidByLease.get(lease.id) || 0));
    const rentDue = Math.max(0, unpaidMonths * Number(lease.monthly_rent) - arrears.paidForNextDueMonth);
    const amountDue = rentDue + openingDebtRemaining;
    return [tenantId, period, lease.id, amountDue];
  });

  await pool.query('INSERT INTO lease_balance_snapshots (tenant_id, period, lease_id, amount_due) VALUES ?', [rows]);
}

/**
 * Alertes PRÉDICTIVES de retard (étape 13, idée n°4) : baux actuellement À
 * JOUR (jamais un doublon avec `listPortfolioArrears`, qui couvre le retard
 * déjà là) dont l'échéance à venir tombe dans les `daysAhead` prochains
 * jours ET dont l'historique de paiement montre un motif de retard
 * récurrent — pour relancer AVANT que le retard n'arrive, pas seulement
 * après.
 *
 * Règle retenue (aucune ne s'imposait, décision produit) : au moins 2 des 3
 * derniers mois RÉELLEMENT payés ont été réglés après leur propre échéance.
 * Il faut au moins 2 paiements dans l'historique pour se prononcer — jamais
 * d'alerte sur un locataire trop récent faute de recul.
 *
 * `scopeAgentId` (étape 14) : même portée que `listPortfolioArrears`.
 */
async function listPredictiveLateAlerts(tenantId, scopeAgentId = null, daysAhead = 5) {
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [activeLeases] = await pool.query(
    `SELECT l.id, l.monthly_rent, l.start_date, l.rent_due_day, l.rent_timing,
            l.created_at, l.up_to_date_at_onboarding,
            r.id AS renter_id, r.first_name, r.last_name, r.phone,
            un.code AS unit_code, p.code AS property_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE l.tenant_id = :tenantId AND l.status = 'active' ${scopeClause}`,
    params,
  );
  if (activeLeases.length === 0) return [];

  const leaseIds = activeLeases.map((l) => l.id);
  const placeholders = leaseIds.map(() => '?').join(',');
  const [payments] = await pool.query(
    `SELECT lease_id, covers_month, amount, paid_at FROM rent_payments
     WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY covers_month DESC`,
    leaseIds,
  );
  const paymentsByLease = new Map();
  for (const p of payments) {
    if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
    paymentsByLease.get(p.lease_id).push(p);
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const results = [];
  for (const lease of activeLeases) {
    const startDate = lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
    const leasePayments = paymentsByLease.get(lease.id) || [];
    const arrears = computeArrears({
      startDate,
      createdAt: lease.created_at,
      upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
      rentDueDay: lease.rent_due_day,
      rentTiming: lease.rent_timing,
      monthlyRent: lease.monthly_rent,
      payments: leasePayments.map((p) => ({ coversMonth: p.covers_month, amount: Number(p.amount) })),
    });

    // Déjà couvert par `listPortfolioArrears` : une alerte prédictive n'a de
    // sens que tant que l'échéance n'est pas encore dépassée.
    if (arrears.status === 'late') continue;

    const [dy, dm, dd] = arrears.dueDate.split('-').map(Number);
    const dueDateUtc = new Date(Date.UTC(dy, dm - 1, dd));
    const daysUntilDue = Math.round((dueDateUtc - todayUtc) / 86_400_000);
    if (daysUntilDue > daysAhead) continue;

    const recentPayments = leasePayments.slice(0, 3);
    if (recentPayments.length < 2) continue;
    const lateCount = recentPayments.filter((p) => isPaymentLate(p.covers_month, lease.rent_due_day, p.paid_at, lease.rent_timing)).length;
    if (lateCount < 2) continue;

    results.push({
      leaseId: lease.id,
      renterId: lease.renter_id,
      renterName: `${lease.first_name} ${lease.last_name}`,
      phone: lease.phone,
      unitCode: lease.unit_code,
      propertyCode: lease.property_code,
      monthlyRent: Number(lease.monthly_rent),
      dueDate: arrears.dueDate,
      daysUntilDue,
      lateCount,
      recentPaymentsCount: recentPayments.length,
    });
  }
  // Échéance la plus proche en premier — la plus urgente à relancer.
  results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return results;
}

module.exports = {
  computeArrears,
  addMonth,
  allocateRentPayment,
  monthsBetweenInclusive,
  isPaymentLate,
  listPortfolioArrears,
  listPredictiveLateAlerts,
  snapshotLeaseBalances,
};
