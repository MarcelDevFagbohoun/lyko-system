'use strict';

/**
 * Bilan détaillé d'UN mois civil (1er → 30/31), en base caisse — demande de l'utilisateur (21/10/2026) :
 * « visualiser les mois antérieurs : les entrées, les versements, le point locataires, le point
 * propriétaires, les dépenses ».
 *
 * Une seule source de vérité pour chaque chiffre :
 *   - flux propriétaires (loyers, dette initiale, prorata, dépenses de Bien) et commission :
 *     `services/commission.js` (chargeur unique, taux du jour du paiement) ;
 *   - impayés locataires : `listPortfolioArrears(..., asOfDate = fin du mois)` — l'état À LA FIN du mois,
 *     jamais l'état d'aujourd'hui ;
 *   - soldes propriétaires : `getEscrowBalances(..., asOfDate)`.
 *
 * Deux chiffres « nets » volontairement séparés (décision de l'utilisateur) :
 *   - `treasury.net`  : variation RÉELLE de la trésorerie (tout l'argent entré − tout l'argent sorti,
 *     y compris l'argent des propriétaires, les cautions et les charges SONEB/SBEE en transit) ;
 *   - `cabinet.netIncome` : résultat du cabinet (commission + frais d'agence + pénalités + commissions de
 *     vente − dépenses de fonctionnement), qui est la seule part qui lui appartient.
 *
 * `controls` : contrôles de cohérence croisée, calculés à chaque lecture (un contrôle `ok: false`
 * signale un écart entre deux chemins de calcul, jamais ignoré en silence).
 */

const { pool } = require('../config/db');
const commission = require('./commission');
const { listPortfolioArrears } = require('./rentTracking');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function firstDayOf(month) {
  return `${month}-01`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const n = (v) => Number(v ?? 0);

/** Montant + nombre d'opérations pour une requête `SELECT SUM(...) total, COUNT(*) n`. */
async function sumCount(db, sql, params) {
  const [[row]] = await db.query(sql, params);
  return { total: n(row.total), count: n(row.n) };
}

/**
 * `light: true` : uniquement les totaux (entrées/sorties, trésorerie, résultat cabinet) — sans le détail par
 * propriétaire, le point locataires ni les contrôles. Utilisé par le tableau de bord (appelé souvent).
 */
async function getMonthBilan(tenantId, month, { scopeAgentId = null, db = pool, light = false } = {}) {
  if (!MONTH_RE.test(month)) throw new Error('Mois invalide (AAAA-MM)');
  const first = firstDayOf(month);
  const last = commission.lastDayOfMonth(month);
  const today = todayIso();
  const isFuture = first > today;
  // Point « à la fin du mois » ; pour le mois en cours, l'état d'aujourd'hui (le mois n'est pas fini).
  const asOf = last < today ? last : today;
  const p = { tenantId, month, first, last };

  // ── ENTRÉES ────────────────────────────────────────────────────────────────────────────────
  // Loyers : ventilés selon le mois que le paiement couvre, par rapport à ce mois-ci.
  const [rentRows] = await db.query(
    `SELECT CASE
              WHEN COALESCE(rp.covers_month, DATE_FORMAT(rp.covers_period_start, '%Y-%m')) = :month THEN 'ceMois'
              WHEN COALESCE(rp.covers_month, DATE_FORMAT(rp.covers_period_start, '%Y-%m')) < :month THEN 'arriere'
              ELSE 'avance' END AS bucket,
            SUM(rp.amount) AS total, COUNT(*) AS n
     FROM rent_payments rp
     WHERE rp.tenant_id = :tenantId AND rp.deleted_at IS NULL AND DATE_FORMAT(rp.paid_at, '%Y-%m') = :month
     GROUP BY bucket`,
    p,
  );
  const rent = { total: 0, count: 0, ceMois: 0, arriere: 0, avance: 0 };
  for (const r of rentRows) {
    rent[r.bucket] = n(r.total);
    rent.total += n(r.total);
    rent.count += n(r.n);
  }
  const [rentByMethod] = await db.query(
    `SELECT payment_method AS method, SUM(amount) AS total, COUNT(*) AS n FROM rent_payments
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND DATE_FORMAT(paid_at, '%Y-%m') = :month
     GROUP BY payment_method ORDER BY total DESC`,
    p,
  );

  const openingDebt = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM lease_opening_debt_payments WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const prorata = await sumCount(db, `SELECT COALESCE(SUM(entry_prorata_amount),0) total, COUNT(*) n FROM leases WHERE tenant_id = :tenantId AND entry_prorata_received_at IS NOT NULL AND DATE_FORMAT(entry_prorata_received_at,'%Y-%m') = :month`, p);
  const entryFees = await sumCount(db, `SELECT COALESCE(SUM(entry_fee_amount),0) total, COUNT(*) n FROM leases WHERE tenant_id = :tenantId AND entry_fee_received_at IS NOT NULL AND DATE_FORMAT(entry_fee_received_at,'%Y-%m') = :month`, p);
  const lateFees = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM late_fee_payments WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const saleCommissions = await sumCount(db, `SELECT COALESCE(SUM(commission_amount),0) total, COUNT(*) n FROM sale_properties WHERE tenant_id = :tenantId AND status = 'vendu' AND deleted_at IS NULL AND DATE_FORMAT(sold_at,'%Y-%m') = :month`, p);
  const otherIncomes = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM other_incomes WHERE tenant_id = :tenantId AND deleted_at IS NULL AND DATE_FORMAT(income_date,'%Y-%m') = :month`, p);
  const rentDeposits = await sumCount(db, `SELECT COALESCE(SUM(deposit_amount),0) total, COUNT(*) n FROM leases WHERE tenant_id = :tenantId AND deposit_received_at IS NOT NULL AND DATE_FORMAT(deposit_received_at,'%Y-%m') = :month`, p);
  const extraDeposits = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM lease_deposits WHERE tenant_id = :tenantId AND received_at IS NOT NULL AND DATE_FORMAT(received_at,'%Y-%m') = :month`, p);
  // Charges SONEB/SBEE payées par les locataires — l'argent transite (reversé au propriétaire) ; un règlement
  // prélevé sur la caution (`settled_from_deposit`) n'est PAS une entrée d'argent.
  const utilityCollected = await sumCount(
    db,
    `SELECT COALESCE(SUM(up.amount),0) total, COUNT(*) n FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL
     WHERE up.tenant_id = :tenantId AND up.settled_from_deposit = 0 AND DATE_FORMAT(up.paid_at,'%Y-%m') = :month`,
    p,
  );

  // Cautions reversées au propriétaire / récupérées auprès de lui (mouvements d'argent, sans effet sur sa recette).
  const depTransOut = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM owner_deposit_transfers WHERE tenant_id = :tenantId AND direction = 'to_owner' AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const depTransIn = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM owner_deposit_transfers WHERE tenant_id = :tenantId AND direction = 'from_owner' AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  // Position à la fin du mois : cautions encore chez les propriétaires (reversé − récupéré, jusqu'à cette date).
  const [withOwnersRows] = await db.query(
    `SELECT t.owner_id, o.name, SUM(CASE WHEN t.direction = 'to_owner' THEN t.amount ELSE -t.amount END) AS net
     FROM owner_deposit_transfers t JOIN owners o ON o.id = t.owner_id
     WHERE t.tenant_id = :tenantId AND t.paid_at <= :last
     GROUP BY t.owner_id, o.name HAVING net > 0 ORDER BY net DESC`,
    p,
  );
  const [depTransList] = await db.query(
    `SELECT t.id, t.owner_id, o.name AS owner_name, t.direction, t.deposit_type, t.amount, t.motive, t.requested_by_owner,
            DATE_FORMAT(t.paid_at,'%Y-%m-%d') AS paid_at, r.first_name, r.last_name
     FROM owner_deposit_transfers t JOIN owners o ON o.id = t.owner_id JOIN leases l ON l.id = t.lease_id JOIN renters r ON r.id = l.renter_id
     WHERE t.tenant_id = :tenantId AND DATE_FORMAT(t.paid_at,'%Y-%m') = :month ORDER BY t.paid_at, t.id`,
    p,
  );

  // ── SORTIES ────────────────────────────────────────────────────────────────────────────────
  const ownerPayouts = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM owner_payouts WHERE tenant_id = :tenantId AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const chargeRemittances = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM owner_charge_remittances WHERE tenant_id = :tenantId AND deleted_at IS NULL AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const propertyExpenses = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NOT NULL AND payment_status = 'paid' AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const cabinetExpenses = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL AND payment_status = 'paid' AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  const fixedAssets = await sumCount(db, `SELECT COALESCE(SUM(acquisition_cost),0) total, COUNT(*) n FROM fixed_assets WHERE tenant_id = :tenantId AND payment_status = 'paid' AND DATE_FORMAT(paid_at,'%Y-%m') = :month`, p);
  // Restitutions de cautions — mêmes critères que le grand livre (`glActivationService`).
  const extraDepositsReturned = await sumCount(db, `SELECT COALESCE(SUM(returned_amount),0) total, COUNT(*) n FROM lease_deposits WHERE tenant_id = :tenantId AND status = 'returned' AND returned_amount > 0 AND returned_method IS NOT NULL AND DATE_FORMAT(returned_at,'%Y-%m') = :month`, p);
  const rentDepositsReturned = await sumCount(db, `SELECT COALESCE(SUM(net_refund),0) total, COUNT(*) n FROM move_out_reports WHERE tenant_id = :tenantId AND status = 'finalized' AND total_deductions = 0 AND net_refund > 0 AND refund_payment_method IS NOT NULL AND DATE_FORMAT(conducted_at,'%Y-%m') = :month`, p);

  const [cabinetByCategory] = await db.query(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS n FROM expenses
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND property_id IS NULL AND payment_status = 'paid' AND DATE_FORMAT(paid_at,'%Y-%m') = :month
     GROUP BY category ORDER BY total DESC`,
    p,
  );
  const [expenseLines] = await db.query(
    `SELECT e.id, e.label, e.category, e.amount, DATE_FORMAT(e.paid_at,'%Y-%m-%d') AS paid_at, DATE_FORMAT(e.expense_date,'%Y-%m-%d') AS expense_date,
            pr.code AS property_code
     FROM expenses e LEFT JOIN properties pr ON pr.id = e.property_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.payment_status = 'paid' AND DATE_FORMAT(e.paid_at,'%Y-%m') = :month
     ORDER BY e.paid_at, e.id`,
    p,
  );
  // Dépenses ENGAGÉES ce mois-ci mais pas encore payées (comptées dans le mois où elles seront payées).
  const unpaidExpenses = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses WHERE tenant_id = :tenantId AND deleted_at IS NULL AND payment_status <> 'paid' AND DATE_FORMAT(expense_date,'%Y-%m') = :month`, p);

  // ── PAR BIEN ET PAR PROPRIÉTAIRE ───────────────────────────────────────────────────────────
  const [flows, ratesByOwner] = await Promise.all([
    commission.loadOwnerFlows(tenantId, db, { month }),
    commission.loadRatesByOwner(tenantId, db),
  ]);
  const cells = [...commission.buildOwnerCells(flows, ratesByOwner).values()];
  const [propRows] = await db.query('SELECT id, code FROM properties WHERE tenant_id = :tenantId', { tenantId });
  const [ownerRows] = await db.query('SELECT id, name FROM owners WHERE tenant_id = :tenantId', { tenantId });
  const propCode = new Map(propRows.map((r) => [r.id, r.code]));
  const ownerName = new Map(ownerRows.map((r) => [r.id, r.name]));

  const properties = cells
    .map((c) => ({
      propertyId: c.propertyId,
      propertyCode: propCode.get(c.propertyId) ?? '?',
      ownerId: c.ownerId,
      ownerName: ownerName.get(c.ownerId) ?? 'Propriétaire',
      rent: c.rent,
      openingDebt: c.openingDebt,
      prorata: c.prorata,
      expenses: c.expenses,
      netRevenue: c.recetteNette,
      commission: c.commission,
      ownerShare: c.recetteNette - c.commission,
    }))
    .sort((a, b) => a.propertyCode.localeCompare(b.propertyCode));

  const commissionAtCollection = await (async () => {
    const [rows] = await db.query('SELECT gl_commission_timing FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
    return (rows[0]?.gl_commission_timing ?? 'encaissement') === 'encaissement';
  })();

  // Soldes séquestre : ouverture (veille du 1er) → clôture (fin du mois) + mouvement du mois.
  const [opening, closing] = light
    ? [new Map(), new Map()]
    : await Promise.all([commission.getEscrowBalances(tenantId, db, dayBefore(first)), commission.getEscrowBalances(tenantId, db, last)]);
  const ownerIds = new Set([...opening.keys(), ...closing.keys(), ...cells.map((c) => c.ownerId)]);
  const owners = [...ownerIds]
    .map((ownerId) => {
      const mine = cells.filter((c) => c.ownerId === ownerId);
      const collected = mine.reduce((s, c) => s + c.rent + c.openingDebt + c.prorata, 0);
      const exp = mine.reduce((s, c) => s + c.expenses, 0);
      const comm = mine.reduce((s, c) => s + c.commission, 0);
      const o = opening.get(ownerId)?.balance ?? 0;
      const c = closing.get(ownerId)?.balance ?? 0;
      return {
        ownerId,
        ownerName: ownerName.get(ownerId) ?? 'Propriétaire',
        openingBalance: o,
        collected,
        expenses: exp,
        commission: commissionAtCollection ? comm : 0,
        payouts: n(closing.get(ownerId)?.totalPayouts) - n(opening.get(ownerId)?.totalPayouts),
        closingBalance: c,
        // reversé = plus rien de dû à la fin du mois
        status: c > 0 ? 'non_reverse' : 'reverse',
      };
    })
    .sort((a, b) => b.closingBalance - a.closingBalance);

  // ── POINT LOCATAIRES (état à la fin du mois) ───────────────────────────────────────────────
  let tenants = { asOf, totalOwed: 0, count: 0, list: [] };
  if (!isFuture && !light) {
    const arrears = await listPortfolioArrears(tenantId, scopeAgentId, last < today ? last : null);
    tenants = {
      asOf,
      totalOwed: arrears.reduce((s, a) => s + a.amountOwed, 0),
      count: arrears.length,
      list: arrears
        .map((a) => ({
          leaseId: a.leaseId,
          renterName: a.renterName,
          propertyCode: a.propertyCode,
          unitCode: a.unitCode,
          monthlyRent: a.monthlyRent,
          daysLate: a.daysLate,
          unpaidMonths: a.unpaidMonths,
          openingDebtRemaining: a.openingDebtRemaining,
          lateFeesRemaining: a.lateFeesRemaining,
          amountOwed: a.amountOwed,
        }))
        .sort((a, b) => b.amountOwed - a.amountOwed),
    };
  }

  // ── CHARGES SONEB / SBEE ───────────────────────────────────────────────────────────────────
  const billed = await sumCount(db, `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM utility_charges WHERE tenant_id = :tenantId AND deleted_at IS NULL AND DATE_FORMAT(billed_at,'%Y-%m') = :month`, p);
  const unpaidAtEnd = await sumCount(
    db,
    `SELECT COALESCE(SUM(uc.amount - COALESCE((SELECT SUM(up.amount) FROM utility_payments up WHERE up.charge_id = uc.id AND up.paid_at <= :last), 0)), 0) total, COUNT(*) n
     FROM utility_charges uc
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.billed_at <= :last
       AND uc.amount - COALESCE((SELECT SUM(up.amount) FROM utility_payments up WHERE up.charge_id = uc.id AND up.paid_at <= :last), 0) > 0`,
    p,
  );

  // ── TOTAUX ─────────────────────────────────────────────────────────────────────────────────
  const cabinetRev = await commission.getCabinetRevenue(tenantId, month, db);
  // Un loyer réglé « sur la caution » (mode 'caution', sortie de locataire) appartient bien au propriétaire
  // (il est dans ses flux) mais ne fait ENTRER aucun argent nouveau : la caution était déjà détenue.
  const rentFromDeposit = n(rentByMethod.find((r) => r.method === 'caution')?.total);
  const inLines = {
    rent: rent.total - rentFromDeposit,
    openingDebt: openingDebt.total,
    prorata: prorata.total,
    entryFees: entryFees.total,
    lateFees: lateFees.total,
    saleCommissions: saleCommissions.total,
    otherIncomes: otherIncomes.total,
    rentDeposits: rentDeposits.total,
    extraDeposits: extraDeposits.total,
    utilityCollected: utilityCollected.total,
    depositsRecoveredFromOwners: depTransIn.total,
  };
  const outLines = {
    ownerPayouts: ownerPayouts.total,
    chargeRemittances: chargeRemittances.total,
    propertyExpenses: propertyExpenses.total,
    cabinetExpenses: cabinetExpenses.total,
    fixedAssets: fixedAssets.total,
    rentDepositsReturned: rentDepositsReturned.total,
    extraDepositsReturned: extraDepositsReturned.total,
    depositsTransferredToOwners: depTransOut.total,
  };
  const sumOf = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  const totalIn = sumOf(inLines);
  const totalOut = sumOf(outLines);

  // ── CONTRÔLES DE COHÉRENCE ─────────────────────────────────────────────────────────────────
  const cellsNet = cells.reduce((s, c) => s + c.recetteNette, 0);
  const cellsCommission = cells.reduce((s, c) => s + c.commission, 0);
  const escrowDelta = owners.reduce((s, o) => s + (o.closingBalance - o.openingBalance), 0);
  const expectedDelta = cellsNet - (commissionAtCollection ? cellsCommission : 0) - ownerPayouts.total;
  const controls = light ? [] : [
    {
      key: 'flux_proprietaires',
      label: 'Loyers + dette initiale + prorata − dépenses de Biens (par Bien) = entrées − dépenses du mois',
      ok: cellsNet === rent.total + openingDebt.total + prorata.total - propertyExpenses.total,
      expected: rent.total + openingDebt.total + prorata.total - propertyExpenses.total,
      actual: cellsNet,
    },
    {
      key: 'sequestre',
      label: 'Variation des soldes séquestre = recette nette − commission − versements',
      ok: escrowDelta === expectedDelta,
      expected: expectedDelta,
      actual: escrowDelta,
    },
    {
      key: 'commission_cabinet',
      label: 'Commission du revenu cabinet = commission des fiches de Bien',
      ok: !commissionAtCollection || cabinetRev.breakdown.commission === cellsCommission,
      expected: cellsCommission,
      actual: cabinetRev.breakdown.commission,
    },
    {
      key: 'depenses_cabinet',
      label: 'Dépenses de fonctionnement = dépenses payées sans Bien',
      ok: cabinetRev.breakdown.expenses === cabinetExpenses.total,
      expected: cabinetExpenses.total,
      actual: cabinetRev.breakdown.expenses,
    },
  ];

  return {
    month,
    from: first,
    to: last,
    isFuture,
    commissionTiming: commissionAtCollection ? 'encaissement' : 'reversement',
    inflows: {
      total: totalIn,
      lines: inLines,
      rent: { ...rent, fromDeposit: rentFromDeposit, cashTotal: rent.total - rentFromDeposit, byMethod: rentByMethod.map((r) => ({ method: r.method, total: n(r.total), count: n(r.n) })) },
      counts: { openingDebt: openingDebt.count, prorata: prorata.count, entryFees: entryFees.count, lateFees: lateFees.count, saleCommissions: saleCommissions.count, otherIncomes: otherIncomes.count, rentDeposits: rentDeposits.count, extraDeposits: extraDeposits.count, utilityCollected: utilityCollected.count },
    },
    outflows: {
      total: totalOut,
      lines: outLines,
      counts: { ownerPayouts: ownerPayouts.count, chargeRemittances: chargeRemittances.count, propertyExpenses: propertyExpenses.count, cabinetExpenses: cabinetExpenses.count, fixedAssets: fixedAssets.count },
    },
    treasury: { in: totalIn, out: totalOut, net: totalIn - totalOut },
    cabinet: { ...cabinetRev.breakdown, netIncome: cabinetRev.netCabinetIncome },
    properties,
    owners,
    tenants,
    expenses: {
      cabinetTotal: cabinetExpenses.total,
      propertyTotal: propertyExpenses.total,
      byCategory: cabinetByCategory.map((r) => ({ category: r.category, total: n(r.total), count: n(r.n) })),
      lines: expenseLines.map((e) => ({ id: e.id, label: e.label, category: e.category, amount: n(e.amount), paidAt: e.paid_at, propertyCode: e.property_code })),
      engagedUnpaid: unpaidExpenses,
    },
    charges: { billed, collected: utilityCollected, remitted: chargeRemittances, unpaidAtEndOfMonth: unpaidAtEnd },
    // Point mensuel des cautions remises aux propriétaires : mouvements du mois + ce qui reste chez eux à la fin du mois.
    depositTransfers: {
      month: { toOwners: depTransOut, fromOwners: depTransIn },
      lines: depTransList.map((t) => ({
        id: t.id, ownerId: t.owner_id, ownerName: t.owner_name, direction: t.direction, depositType: t.deposit_type,
        amount: n(t.amount), paidAt: t.paid_at, motive: t.motive, requestedByOwner: !!t.requested_by_owner,
        renterName: `${t.first_name} ${t.last_name}`,
      })),
      stillWithOwners: {
        total: withOwnersRows.reduce((sum, r) => sum + n(r.net), 0),
        owners: withOwnersRows.map((r) => ({ ownerId: r.owner_id, ownerName: r.name, amount: n(r.net) })),
      },
    },
    controls,
    allControlsOk: controls.every((c) => c.ok),
  };
}

/**
 * Photo figée du bilan à la clôture (`accounting_period_bilans`). `getStoredBilan` renvoie `null` si le
 * mois a été clôturé avant l'existence de cette table (reconstruction à la demande dans ce cas).
 */
async function storeBilanSnapshot(tenantId, month, closedBy, db = pool) {
  const bilan = await getMonthBilan(tenantId, month, { db });
  await db.query(
    `INSERT INTO accounting_period_bilans (tenant_id, period, snapshot, created_by)
     VALUES (:tenantId, :month, :snapshot, :closedBy)
     ON DUPLICATE KEY UPDATE snapshot = VALUES(snapshot), created_by = VALUES(created_by)`,
    { tenantId, month, snapshot: JSON.stringify(bilan), closedBy },
  );
  return bilan;
}

async function getStoredBilan(tenantId, month, db = pool) {
  const [rows] = await db.query(
    'SELECT snapshot, created_at FROM accounting_period_bilans WHERE tenant_id = :tenantId AND period = :month LIMIT 1',
    { tenantId, month },
  );
  if (!rows[0]) return null;
  const snap = typeof rows[0].snapshot === 'string' ? JSON.parse(rows[0].snapshot) : rows[0].snapshot;
  return { snapshot: snap, frozenAt: rows[0].created_at };
}

module.exports = { MONTH_RE, getMonthBilan, storeBilanSnapshot, getStoredBilan };
