'use strict';

/**
 * Export comptable Excel : registre détaillé, une ligne par mouvement de trésorerie RÉELLEMENT enregistré
 * (jamais un montant recalculé/estimé), pour un comptable externe qui doit rapprocher les comptes.
 * Construit le classeur ; la route (`GET /export.xlsx`) valide la période, journalise et l'écrit dans la
 * réponse. Déplacé à l'identique depuis `routes/accounting.js`.
 */

const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');
const { paymentPeriodKey } = require('./rentTracking');
const { isoDate } = require('../utils/dates');

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  caution: 'Prélevé sur la caution',
};

/** Construit le registre comptable de la période. Renvoie { workbook, rowCount }. */
async function buildAccountingExport(tenantId, { from, to }) {
  const params = { tenantId, from, to };

  const [tenantRows] = await pool.query('SELECT company_name FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  if (!tenantRows[0]) throw new ApiError(404, 'Entreprise introuvable');

  const [rentRows] = await pool.query(
    `SELECT rp.paid_at, rp.amount, rp.payment_method, rp.covers_month, rp.covers_period_start,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            u.code AS unit_code, p.code AS property_code,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     LEFT JOIN users ru ON ru.id = rp.recorded_by
     WHERE rp.tenant_id = :tenantId AND rp.paid_at BETWEEN :from AND :to AND rp.deleted_at IS NULL`,
    params,
  );

  const [payoutRows] = await pool.query(
    `SELECT op.paid_at, op.amount, op.payment_method, op.period_label,
            o.name AS owner_name,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name
     FROM owner_payouts op
     JOIN owners o ON o.id = op.owner_id
     LEFT JOIN users ru ON ru.id = op.recorded_by
     WHERE op.tenant_id = :tenantId AND op.paid_at BETWEEN :from AND :to`,
    params,
  );

  const [expenseRows] = await pool.query(
    `SELECT e.expense_date, e.amount, e.payment_method, e.category, e.label, e.property_id,
            p.code AS property_code,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name
     FROM expenses e
     LEFT JOIN properties p ON p.id = e.property_id
     LEFT JOIN users ru ON ru.id = e.recorded_by
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL
       AND e.expense_date BETWEEN :from AND :to`,
    params,
  );

  const [utilityRows] = await pool.query(
    `SELECT up.paid_at, up.amount, up.payment_method, uc.utility_type,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            pu.code AS unit_code, pr.code AS property_code,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name
     FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id AND uc.deleted_at IS NULL
     JOIN leases l ON l.id = uc.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units pu ON pu.id = l.unit_id
     JOIN properties pr ON pr.id = pu.property_id
     LEFT JOIN users ru ON ru.id = up.recorded_by
     WHERE up.tenant_id = :tenantId AND up.paid_at BETWEEN :from AND :to`,
    params,
  );

  // Reversements au propriétaire des charges SONEB/SBEE encaissées (étape 31) :
  // la contrepartie, en sortie, des « Charge SONEB/SBEE réglée » ci-dessus.
  const [chargeRemittanceRows] = await pool.query(
    `SELECT cr.paid_at, cr.amount, cr.payment_method, cr.period_label, o.name AS owner_name,
            ru.first_name AS recorder_first_name, ru.last_name AS recorder_last_name
     FROM owner_charge_remittances cr
     JOIN owners o ON o.id = cr.owner_id
     LEFT JOIN users ru ON ru.id = cr.recorded_by
     WHERE cr.tenant_id = :tenantId AND cr.deleted_at IS NULL AND cr.paid_at BETWEEN :from AND :to`,
    params,
  );

  // Frais d'agence à l'entrée — 100 % produit du cabinet (voir
  // `recordEntryFeeReceived`, routes/renters.js), une ligne par bail.
  const [entryFeeRows] = await pool.query(
    `SELECT l.entry_fee_received_at AS paid_at, l.entry_fee_amount AS amount, l.entry_fee_received_method AS payment_method,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name,
            u.code AS unit_code, p.code AS property_code,
            lu.first_name AS recorder_first_name, lu.last_name AS recorder_last_name
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     LEFT JOIN users lu ON lu.id = l.created_by
     WHERE l.tenant_id = :tenantId AND l.entry_fee_received_at BETWEEN :from AND :to`,
    params,
  );

  const categoryLabels = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
  const utilityLabels = { soneb: 'SONEB (Eau)', sbee: 'SBEE (Électricité)' };
  const recorderName = (r) => (r.recorder_first_name ? `${r.recorder_first_name} ${r.recorder_last_name}` : '');

  const rows = [];
  for (const r of rentRows) {
    rows.push({
      date: isoDate(r.paid_at),
      type: 'Loyer encaissé',
      tiers: `${r.renter_first_name} ${r.renter_last_name}`,
      bien: `${r.property_code} · ${r.unit_code}`,
      categorie: `Loyer ${paymentPeriodKey(r)}`,
      debit: null,
      credit: Number(r.amount),
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  for (const r of payoutRows) {
    rows.push({
      date: isoDate(r.paid_at),
      type: 'Versement propriétaire',
      tiers: r.owner_name,
      bien: '',
      categorie: r.period_label,
      debit: Number(r.amount),
      credit: null,
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  for (const r of chargeRemittanceRows) {
    rows.push({
      date: isoDate(r.paid_at),
      type: 'Reversement de charges (propriétaire)',
      tiers: r.owner_name,
      bien: '',
      categorie: r.period_label || 'Charges SONEB/SBEE',
      debit: Number(r.amount),
      credit: null,
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  for (const r of expenseRows) {
    rows.push({
      date: isoDate(r.expense_date),
      type: r.property_id ? 'Travaux facturé au Bien (charge propriétaire)' : 'Dépense (entreprise)',
      tiers: r.label,
      bien: r.property_code || '',
      categorie: categoryLabels[r.category] ?? r.category,
      debit: Number(r.amount),
      credit: null,
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  for (const r of utilityRows) {
    rows.push({
      date: isoDate(r.paid_at),
      type: 'Charge SONEB/SBEE réglée',
      tiers: `${r.renter_first_name} ${r.renter_last_name}`,
      bien: `${r.property_code} · ${r.unit_code}`,
      categorie: utilityLabels[r.utility_type] ?? r.utility_type,
      debit: null,
      credit: Number(r.amount),
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  for (const r of entryFeeRows) {
    rows.push({
      date: isoDate(r.paid_at),
      type: "Frais d'agence à l'entrée (produit de l'entreprise)",
      tiers: `${r.renter_first_name} ${r.renter_last_name}`,
      bien: `${r.property_code} · ${r.unit_code}`,
      categorie: 'Frais d’agence',
      debit: null,
      credit: Number(r.amount),
      mode: PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
      enregistrePar: recorderName(r),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Charte graphique alignée sur les PDF (`services/pdf.js` : bandeau marine PRIMARY,
  // tableaux zébrés SURFACE_MUTED) — même identité visuelle sur l'export Excel.
  const NAVY = 'FF0B2A5B';
  const ZEBRA = 'FFF1F5F9';
  const GRID = 'FFCBD5E1';
  const thin = { style: 'thin', color: { argb: GRID } };
  const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Africa Immo Management';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Registre comptable');

  const columns = [
    { header: 'Date', width: 12 },
    { header: 'Type', width: 30 },
    { header: 'Tiers', width: 24 },
    { header: 'Bien / Unité', width: 18 },
    { header: 'Catégorie', width: 26 },
    { header: 'Débit (FCFA)', width: 16, align: 'right' },
    { header: 'Crédit (FCFA)', width: 16, align: 'right' },
    { header: 'Mode de règlement', width: 18 },
    { header: 'Enregistré par', width: 20 },
  ];
  columns.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `Registre comptable — ${tenantRows[0].company_name} — du ${from} au ${to}`;
  sheet.getCell(1, 1).font = { bold: true, size: 13, color: { argb: NAVY } };

  const headerRowIndex = 3;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = columns.map((c) => c.header);
  headerRow.height = 20;
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: c.align ?? 'left' };
    cell.border = cellBorder;
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

  rows.forEach((r, i) => {
    const excelRow = sheet.getRow(headerRowIndex + 1 + i);
    excelRow.values = [
      new Date(`${r.date}T00:00:00Z`),
      r.type,
      r.tiers,
      r.bien,
      r.categorie,
      r.debit,
      r.credit,
      r.mode,
      r.enregistrePar,
    ];
    excelRow.getCell(1).numFmt = 'dd/mm/yyyy';
    excelRow.getCell(6).numFmt = '#,##0';
    excelRow.getCell(7).numFmt = '#,##0';
    const zebra = i % 2 === 1;
    for (let col = 1; col <= columns.length; col++) {
      const cell = excelRow.getCell(col);
      cell.border = cellBorder;
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      if (col === 6 || col === 7) cell.alignment = { horizontal: 'right' };
    }
  });

  const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const totalRow = sheet.getRow(headerRowIndex + rows.length + 2);
  totalRow.getCell(5).value = 'TOTAL';
  totalRow.getCell(6).value = totalDebit;
  totalRow.getCell(7).value = totalCredit;
  totalRow.font = { bold: true };
  totalRow.getCell(6).numFmt = '#,##0';
  totalRow.getCell(7).numFmt = '#,##0';
  for (let col = 1; col <= columns.length; col++) {
    const cell = totalRow.getCell(col);
    cell.border = cellBorder;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    if (col === 6 || col === 7) cell.alignment = { horizontal: 'right' };
  }

  const soldeRow = sheet.getRow(headerRowIndex + rows.length + 3);
  soldeRow.getCell(5).value = 'Solde net (crédit − débit)';
  soldeRow.getCell(7).value = totalCredit - totalDebit;
  soldeRow.font = { bold: true };
  soldeRow.getCell(7).numFmt = '#,##0';
  for (let col = 1; col <= columns.length; col++) {
    const cell = soldeRow.getCell(col);
    cell.border = cellBorder;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    if (col === 6 || col === 7) cell.alignment = { horizontal: 'right' };
  }

  return { workbook, rowCount: rows.length };
}

module.exports = { buildAccountingExport };
