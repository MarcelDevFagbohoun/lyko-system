'use strict';

// Détail d'une carte de la page Comptabilité : mêmes filtres EXACTS que `computeAccountingDashboard`
// (routes/accounting.js), pour que « somme des lignes = chiffre de la carte » soit vrai par construction.
// Chaque réponse porte `rowsTotal` et `matches` : un écart serait visible, jamais caché.
const { pool } = require('../config/db');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');
const { UTILITY_TYPES } = require('../constants/charges');
const { listPortfolioArrears, paymentPeriodKey } = require('./rentTracking');
const { resolvePropertyScope } = require('./scope');
const { getMonthBilan } = require('./monthBilan');

const METHOD = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque', caution: 'Prélevé sur la caution' };
const CATEGORY = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
const UTILITY = Object.fromEntries((UTILITY_TYPES ?? []).map((u) => [u.key, u.label]));
const INCOME_CATEGORY = { prestation: 'Prestation', commission: 'Commission', interets: 'Intérêts', remboursement: 'Remboursement', subvention_don: 'Subvention / don', autre: 'Autre' };
const CARDS = ['rent', 'entryFees', 'saleCommissions', 'otherIncomes', 'ownerPayouts', 'expenses', 'propertyExpenses', 'unpaidCharges', 'tenantArrears', 'treasury'];

const iso = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const n = (v) => Number(v) || 0;
const sum = (rows, key = 'amount') => rows.reduce((s, r) => s + n(r[key]), 0);
const col = (key, label, type = 'text') => ({ key, label, type });
const groupBy = (rows, fn) => {
  const m = new Map();
  for (const r of rows) m.set(fn(r), (m.get(fn(r)) ?? 0) + n(r.amount));
  return [...m.entries()];
};

async function rent({ tenantId, from, to }) {
  const [rows] = await pool.query(
    `SELECT rp.*, r.first_name, r.last_name, u.code AS unit_code, p.code AS property_code, ru.first_name AS rf, ru.last_name AS rl
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
     LEFT JOIN users ru ON ru.id = rp.recorded_by
     WHERE rp.tenant_id = :tenantId AND rp.paid_at BETWEEN :from AND :to AND rp.deleted_at IS NULL
     ORDER BY rp.paid_at, rp.id`,
    { tenantId, from, to },
  );
  const single = from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : null;
  const data = rows.map((r) => {
    const covers = paymentPeriodKey(r);
    const timing = !single || !covers ? '—' : String(covers).slice(0, 7) === single ? 'Mois en cours' : String(covers).slice(0, 7) < single ? 'Arriéré' : "Payé d'avance";
    return {
      date: iso(r.paid_at), who: `${r.first_name} ${r.last_name}`, where: `${r.property_code} · ${r.unit_code}`,
      covers: covers ? String(covers).slice(0, 7) : '—', timing, method: METHOD[r.payment_method] ?? r.payment_method,
      by: r.rf ? `${r.rf} ${r.rl}` : '—', amount: n(r.amount), _m: r.payment_method, _t: timing,
    };
  });
  const total = sum(data);
  const formula = [{ label: 'Loyers encaissés sur la période', amount: total, op: 'total' }];
  for (const [t, a] of groupBy(data, (r) => r._t)) if (single) formula.push({ label: t, amount: a, op: 'info' });
  for (const [m, a] of groupBy(data, (r) => r._m)) formula.push({ label: `Mode : ${METHOD[m] ?? m}`, amount: a, op: 'info', note: m === 'caution' ? 'Pas un mouvement d\'argent : réglé par la caution du locataire' : undefined });
  return {
    title: 'Loyers encaissés', total, rows: data,
    columns: [col('date', 'Date payé', 'date'), col('who', 'Locataire'), col('where', 'Bien · Unité'), col('covers', 'Mois couvert'), col('timing', 'Imputation'), col('method', 'Mode'), col('by', 'Enregistré par'), col('amount', 'Montant', 'money')],
    formula, notes: ['Somme des paiements de loyer datés dans la période (date de règlement), hors paiements supprimés.', 'La part commission / propriétaire se calcule dans « Résultat de l\'entreprise » (clôture) et sur la fiche de chaque bien.'],
  };
}

async function entryFees({ tenantId, from, to }) {
  const [rows] = await pool.query(
    `SELECT l.id, l.entry_fee_amount AS amount, l.entry_fee_received_at AS d, l.entry_fee_received_method AS m,
            r.first_name, r.last_name, u.code AS unit_code, p.code AS property_code
     FROM leases l JOIN renters r ON r.id = l.renter_id JOIN property_units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = :tenantId AND l.entry_fee_received_at BETWEEN :from AND :to ORDER BY l.entry_fee_received_at, l.id`,
    { tenantId, from, to },
  );
  const data = rows.map((r) => ({ date: iso(r.d), who: `${r.first_name} ${r.last_name}`, where: `${r.property_code} · ${r.unit_code}`, method: METHOD[r.m] ?? r.m ?? '—', amount: n(r.amount) }));
  const total = sum(data);
  return { title: "Frais d'agence à l'entrée", total, rows: data, columns: [col('date', 'Date reçu', 'date'), col('who', 'Locataire'), col('where', 'Bien · Unité'), col('method', 'Mode'), col('amount', 'Montant', 'money')], formula: [{ label: "Frais d'agence reçus", amount: total, op: 'total' }], notes: ['100 % produit de l\'entreprise : jamais reversé au propriétaire.'] };
}

async function saleCommissions({ tenantId, from, to }) {
  const [rows] = await pool.query(
    `SELECT title, address, price, commission_amount AS amount, sold_at AS d FROM sale_properties
     WHERE tenant_id = :tenantId AND status = 'vendu' AND deleted_at IS NULL AND sold_at BETWEEN :from AND :to ORDER BY sold_at, id`,
    { tenantId, from, to },
  );
  const data = rows.map((r) => ({ date: iso(r.d), title: r.title, price: n(r.price), amount: n(r.amount) }));
  const total = sum(data);
  return { title: 'Commission sur ventes de biens', total, rows: data, columns: [col('date', 'Date de vente', 'date'), col('title', 'Bien vendu'), col('price', 'Prix de vente', 'money'), col('amount', 'Commission', 'money')], formula: [{ label: 'Commissions de vente', amount: total, op: 'total' }], notes: ['100 % produit de l\'entreprise.'] };
}

async function otherIncomes({ tenantId, from, to }) {
  const [rows] = await pool.query(
    `SELECT category, label, amount, income_date AS d, payment_method AS m, payer_name FROM other_incomes
     WHERE tenant_id = :tenantId AND deleted_at IS NULL AND income_date BETWEEN :from AND :to ORDER BY income_date, id`,
    { tenantId, from, to },
  );
  const data = rows.map((r) => ({ date: iso(r.d), category: INCOME_CATEGORY[r.category] ?? r.category, label: r.label, who: r.payer_name ?? '—', method: METHOD[r.m] ?? r.m, amount: n(r.amount), _c: r.category }));
  const total = sum(data);
  return { title: 'Autres entrées', total, rows: data, columns: [col('date', 'Date', 'date'), col('category', 'Nature'), col('label', 'Libellé'), col('who', 'Payeur'), col('method', 'Mode'), col('amount', 'Montant', 'money')], formula: [{ label: 'Autres entrées', amount: total, op: 'total' }, ...groupBy(data, (r) => r.category).map(([k, a]) => ({ label: k, amount: a, op: 'info' }))], notes: ['100 % produit de l\'entreprise.'] };
}

async function ownerPayouts({ tenantId, from, to }) {
  const [rows] = await pool.query(
    `SELECT op.amount, op.paid_at AS d, op.payment_method AS m, op.period_label, o.name FROM owner_payouts op JOIN owners o ON o.id = op.owner_id
     WHERE op.tenant_id = :tenantId AND op.paid_at BETWEEN :from AND :to ORDER BY op.paid_at, op.id`,
    { tenantId, from, to },
  );
  const data = rows.map((r) => ({ date: iso(r.d), who: r.name, label: r.period_label ?? '—', method: METHOD[r.m] ?? r.m, amount: n(r.amount), _o: r.name }));
  const total = sum(data);
  return { title: 'Versé aux propriétaires', total, rows: data, columns: [col('date', 'Date', 'date'), col('who', 'Propriétaire'), col('label', 'Période'), col('method', 'Mode'), col('amount', 'Montant', 'money')], formula: [{ label: 'Total versé', amount: total, op: 'total' }, ...groupBy(data, (r) => r._o).map(([k, a]) => ({ label: k, amount: a, op: 'info' }))], notes: ['Argent des propriétaires reversé : ce n\'est pas une charge de l\'entreprise.'] };
}

async function expenseCard({ tenantId, from, to }, forProperty) {
  const [rows] = await pool.query(
    `SELECT e.category, e.label, e.amount, e.paid_at AS d, e.expense_date, e.payment_method AS m, p.code AS property_code, s.name AS supplier
     FROM expenses e LEFT JOIN properties p ON p.id = e.property_id LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.property_id IS ${forProperty ? 'NOT NULL' : 'NULL'}
       AND e.payment_status = 'paid' AND e.paid_at BETWEEN :from AND :to ORDER BY e.paid_at, e.id`,
    { tenantId, from, to },
  );
  const data = rows.map((r) => ({ date: iso(r.d), expenseDate: iso(r.expense_date), category: CATEGORY[r.category] ?? r.category, label: r.label, where: r.property_code ?? '—', who: r.supplier ?? '—', method: METHOD[r.m] ?? r.m, amount: n(r.amount) }));
  const total = sum(data);
  return {
    title: forProperty ? 'Travaux facturés aux biens' : "Dépenses de l'entreprise", total, rows: data,
    columns: [col('date', 'Date payé', 'date'), col('category', 'Catégorie'), col('label', 'Libellé'), ...(forProperty ? [col('where', 'Bien')] : [col('who', 'Fournisseur')]), col('method', 'Mode'), col('amount', 'Montant', 'money')],
    formula: [{ label: forProperty ? 'Travaux payés' : 'Dépenses payées', amount: total, op: 'total' }, ...groupBy(data, (r) => r.category).map(([k, a]) => ({ label: k, amount: a, op: 'info' }))],
    notes: [forProperty ? 'À la charge des propriétaires (déduits de leur recette) : jamais une charge de l\'entreprise.' : 'Comptées à la date de paiement réelle ; une dépense à crédit non payée n\'y figure pas.'],
  };
}

async function unpaidCharges({ tenantId }) {
  const [rows] = await pool.query(
    `SELECT uc.utility_type, uc.period_start, uc.period_end, uc.billed_at, uc.amount, COALESCE(pt.paid_total, 0) AS paid, r.first_name, r.last_name, u.code AS unit_code, p.code AS property_code
     FROM utility_charges uc
     LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
     JOIN leases l ON l.id = uc.lease_id JOIN renters r ON r.id = l.renter_id JOIN property_units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee' ORDER BY uc.billed_at, uc.id`,
    { tenantId },
  );
  const data = rows.map((r) => ({ date: iso(r.billed_at), who: `${r.first_name} ${r.last_name}`, where: `${r.property_code} · ${r.unit_code}`, kind: UTILITY[r.utility_type] ?? r.utility_type, period: `${iso(r.period_start)} → ${iso(r.period_end)}`, billed: n(r.amount), paid: n(r.paid), amount: n(r.amount) - n(r.paid), _k: r.utility_type }));
  const total = sum(data);
  return {
    title: 'Impayés SONEB/SBEE', total, rows: data, undated: true,
    columns: [col('date', 'Facturé le', 'date'), col('who', 'Locataire'), col('where', 'Bien · Unité'), col('kind', 'Fluide'), col('period', 'Période'), col('billed', 'Facturé', 'money'), col('paid', 'Déjà réglé', 'money'), col('amount', 'Reste dû', 'money')],
    formula: [{ label: 'Facturé', amount: sum(data, 'billed'), op: 'plus' }, { label: 'Déjà réglé', amount: sum(data, 'paid'), op: 'minus' }, { label: 'Reste dû', amount: total, op: 'total' }],
    notes: ['Toutes les factures non soldées, quelle que soit leur date : un impayé reste dû tant qu\'il n\'est pas réglé.'],
  };
}

async function tenantArrears(ctx) {
  const scopeAgentId = await resolvePropertyScope(ctx.user);
  const today = new Date().toISOString().slice(0, 10);
  const list = await listPortfolioArrears(ctx.tenantId, scopeAgentId, ctx.to < today ? ctx.to : null);
  const leaseIds = list.map((a) => a.leaseId);
  const info = new Map();
  if (leaseIds.length) {
    const [rows] = await pool.query(
      `SELECT l.id, l.monthly_rent, u.code AS unit_code, p.code AS property_code FROM leases l JOIN property_units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id WHERE l.id IN (:ids)`,
      { ids: leaseIds },
    );
    for (const r of rows) info.set(r.id, r);
  }
  const data = list.map((a) => {
    const i = info.get(a.leaseId);
    const rentPart = n(a.amountOwed) - n(a.openingDebtRemaining) - n(a.lateFeesRemaining);
    return { who: a.renterName, where: i ? `${i.property_code} · ${i.unit_code}` : '—', late: `${a.daysLate} j`, months: a.unpaidMonths, rent: rentPart, opening: n(a.openingDebtRemaining), fees: n(a.lateFeesRemaining), amount: n(a.amountOwed) };
  });
  const total = sum(data);
  return {
    title: 'Impayés locataires', total, rows: data, undated: true, asOf: ctx.to < today ? ctx.to : today,
    columns: [col('who', 'Locataire'), col('where', 'Bien · Unité'), col('late', 'Retard'), col('months', 'Mois impayés'), col('rent', 'Loyers dus', 'money'), col('opening', 'Dette initiale', 'money'), col('fees', 'Pénalités', 'money'), col('amount', 'Total dû', 'money')],
    formula: [{ label: 'Loyers dus', amount: sum(data, 'rent'), op: 'plus' }, { label: 'Dette initiale restante', amount: sum(data, 'opening'), op: 'plus' }, { label: 'Pénalités restantes', amount: sum(data, 'fees'), op: 'plus' }, { label: 'Total des impayés', amount: total, op: 'total' }],
    notes: [`Situation arrêtée au ${ctx.to < today ? ctx.to : today} (un mois terminé est figé à sa dernière date).`, 'Loyers dus = nombre de mois impayés × loyer, moins ce qui est déjà réglé sur le mois en cours.'],
  };
}

async function treasury(ctx) {
  if (ctx.from.slice(0, 7) !== ctx.to.slice(0, 7)) return { title: 'Trésorerie réelle', total: 0, rows: [], columns: [], formula: [], notes: ['Sélectionnez un mois calendaire unique pour voir la trésorerie.'], noRows: true };
  const b = await getMonthBilan(ctx.tenantId, ctx.from.slice(0, 7), { light: false });
  const line = (label, amount, op) => ({ label, amount: n(amount), op });
  const ins = Object.entries(b.inflows.lines).filter(([, v]) => n(v) !== 0).map(([k, v]) => ({ key: k, section: 'Entrées', amount: n(v) }));
  const outs = Object.entries(b.outflows.lines).filter(([, v]) => n(v) !== 0).map(([k, v]) => ({ key: k, section: 'Sorties', amount: n(v) }));
  return {
    title: 'Trésorerie réelle', total: n(b.treasury.net), noRows: true, rows: [], columns: [],
    treasuryLines: { inflows: ins, outflows: outs },
    formula: [line('Entrées d\'argent du mois', b.treasury.in, 'plus'), line('Sorties d\'argent du mois', b.treasury.out, 'minus'), line('Trésorerie nette du mois', b.treasury.net, 'total')],
    notes: ['Tout l\'argent réellement entré et sorti : argent des propriétaires, cautions et charges en transit inclus. Le résultat de l\'entreprise est à part (voir Clôture).'],
  };
}

const BUILDERS = { rent, entryFees, saleCommissions, otherIncomes, ownerPayouts, expenses: (c) => expenseCard(c, false), propertyExpenses: (c) => expenseCard(c, true), unpaidCharges, tenantArrears, treasury };

async function getCardDetail(user, card, { from, to }) {
  if (!CARDS.includes(card)) return null;
  const ctx = { user, tenantId: user.tenantId, from, to };
  const r = await BUILDERS[card](ctx);
  const rowsTotal = r.noRows ? r.total : sum(r.rows);
  return { card, period: { from, to }, ...r, count: r.rows.length, rowsTotal, matches: rowsTotal === r.total };
}

module.exports = { getCardDetail, CARDS };
