'use strict';

/**
 * États comptables (espace Comptabilité avancée) — balance générale, grand
 * livre par compte, balance auxiliaire des tiers, et les états financiers
 * SYSCOHADA (livrable 8) : bilan, compte de résultat, tableau des flux de
 * trésorerie, avec exports PDF et Excel.
 */

const { Router } = require('express');
const ExcelJS = require('exceljs');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { computeIncomeStatement, computeBalanceSheet, computeCashFlow } = require('../../services/gl/glFinancialStatements');
const { computeMandantsCabinetIndicator } = require('../../services/gl/glMandantsCabinetService');
const { streamFinancialStatementsPdf } = require('../../services/pdf');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

// mysql2 renvoie une colonne DATE comme un objet Date JS, sérialisé en JSON
// avec l'heure (ex. "2026-03-10T00:00:00.000Z") — jamais souhaité pour une
// date SANS heure ; voir le même besoin dans routes/accounting.js `isoDate`.
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// GET /api/gl/reports/trial-balance?fiscalYearId= — balance générale : un
// total débit/crédit par compte, sur tout l'exercice.
router.get('/trial-balance', canAdvanced, async (req, res, next) => {
  const fiscalYearId = Number(req.query.fiscalYearId);
  if (!Number.isInteger(fiscalYearId) || fiscalYearId <= 0) {
    return next(new ApiError(400, 'Exercice comptable requis'));
  }
  try {
    const [fyRows] = await pool.query('SELECT id FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: fiscalYearId,
      tenantId: req.user.tenantId,
    });
    if (!fyRows[0]) throw new ApiError(404, 'Exercice comptable introuvable');

    const [rows] = await pool.query(
      `SELECT a.id, a.code, a.label, a.account_type,
              COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
              COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
       FROM gl_accounts a
       JOIN gl_entry_lines el ON el.account_id = a.id
       JOIN gl_entries e ON e.id = el.entry_id
       WHERE a.tenant_id = :tenantId AND e.fiscal_year_id = :fiscalYearId
       GROUP BY a.id, a.code, a.label, a.account_type
       ORDER BY a.code ASC`,
      { tenantId: req.user.tenantId, fiscalYearId },
    );

    const lines = rows.map((r) => {
      const totalDebit = Number(r.total_debit);
      const totalCredit = Number(r.total_credit);
      return {
        accountId: r.id,
        code: r.code,
        label: r.label,
        accountType: r.account_type,
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
      };
    });
    res.json({
      lines,
      totals: {
        totalDebit: lines.reduce((s, l) => s + l.totalDebit, 0),
        totalCredit: lines.reduce((s, l) => s + l.totalCredit, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/general-ledger?accountId=&from=&to= — grand livre : le
// détail chronologique des mouvements d'un compte, avec solde progressif.
router.get('/general-ledger', canAdvanced, async (req, res, next) => {
  const accountId = Number(req.query.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return next(new ApiError(400, 'Compte requis'));
  }
  try {
    const [accountRows] = await pool.query('SELECT * FROM gl_accounts WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
      id: accountId,
      tenantId: req.user.tenantId,
    });
    if (!accountRows[0]) throw new ApiError(404, 'Compte introuvable');

    const params = { tenantId: req.user.tenantId, accountId };
    let where = 'e.tenant_id = :tenantId AND el.account_id = :accountId';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (from) { where += ' AND e.entry_date >= :from'; params.from = from; }
    if (to) { where += ' AND e.entry_date <= :to'; params.to = to; }

    const [rows] = await pool.query(
      `SELECT e.entry_date, e.entry_number, e.narration, el.side, el.amount, tp.display_name AS third_party_name
       FROM gl_entry_lines el
       JOIN gl_entries e ON e.id = el.entry_id
       LEFT JOIN gl_third_parties tp ON tp.id = el.third_party_id
       WHERE ${where}
       ORDER BY e.entry_date ASC, e.entry_number ASC`,
      params,
    );

    let running = 0;
    const movements = rows.map((r) => {
      const amount = Number(r.amount);
      running += r.side === 'debit' ? amount : -amount;
      return {
        entryDate: isoDate(r.entry_date),
        entryNumber: r.entry_number,
        narration: r.narration,
        thirdPartyName: r.third_party_name,
        debit: r.side === 'debit' ? amount : null,
        credit: r.side === 'credit' ? amount : null,
        runningBalance: running,
      };
    });

    res.json({
      account: { id: accountRows[0].id, code: accountRows[0].code, label: accountRows[0].label },
      movements,
      finalBalance: running,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/third-party-balance?partyType= — balance auxiliaire :
// solde par tiers (locataires, propriétaires...), pour repérer d'un coup
// d'œil qui doit encore de l'argent au cabinet ou à qui le cabinet en doit.
router.get('/third-party-balance', canAdvanced, async (req, res, next) => {
  const partyType = typeof req.query.partyType === 'string' ? req.query.partyType : '';
  const validTypes = ['renter', 'owner', 'supplier', 'employee', 'other'];
  if (!validTypes.includes(partyType)) {
    return next(new ApiError(400, `Type de tiers invalide (attendu : ${validTypes.join(', ')})`));
  }
  try {
    // Un même tiers réel peut avoir PLUSIEURS lignes ici, une par compte
    // collectif concerné (ex. un locataire a sa créance de loyer sous 411
    // ET sa caution sous 165, deux dettes distinctes — migration 046) :
    // `controlAccount` permet au frontend de les distinguer clairement
    // plutôt que d'afficher deux fois le même nom sans explication.
    const [rows] = await pool.query(
      `SELECT tp.id, tp.auxiliary_code, tp.display_name, a.code AS control_account_code, a.label AS control_account_label,
              COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
              COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
       FROM gl_third_parties tp
       JOIN gl_accounts a ON a.id = tp.control_account_id
       LEFT JOIN gl_entry_lines el ON el.third_party_id = tp.id
       LEFT JOIN gl_entries e ON e.id = el.entry_id AND e.tenant_id = tp.tenant_id
       WHERE tp.tenant_id = :tenantId AND tp.party_type = :partyType
       GROUP BY tp.id, tp.auxiliary_code, tp.display_name, a.code, a.label
       ORDER BY tp.display_name ASC, a.code ASC`,
      { tenantId: req.user.tenantId, partyType },
    );
    res.json({
      thirdParties: rows.map((r) => {
        const totalDebit = Number(r.total_debit);
        const totalCredit = Number(r.total_credit);
        return {
          id: r.id,
          auxiliaryCode: r.auxiliary_code,
          displayName: r.display_name,
          controlAccount: { code: r.control_account_code, label: r.control_account_label },
          totalDebit,
          totalCredit,
          balance: totalDebit - totalCredit,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/mandants-cabinet — indicateur de séparation des fonds
// mandants/cabinet (dernier des 6 points de complétude identifiés) — voir
// `services/gl/glMandantsCabinetService.js` pour le calcul et son raisonnement.
router.get('/mandants-cabinet', canAdvanced, async (req, res, next) => {
  try {
    const result = await computeMandantsCabinetIndicator(pool, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── États financiers (livrable 8) ─────────────────────────────────────────

async function loadFiscalYear(tenantId, fiscalYearId) {
  const [rows] = await pool.query('SELECT * FROM gl_fiscal_years WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id: fiscalYearId,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Exercice comptable introuvable');
  return rows[0];
}

function parseFiscalYearId(req) {
  const id = Number(req.query.fiscalYearId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Exercice comptable requis');
  return id;
}

// GET /api/gl/reports/income-statement?fiscalYearId= — compte de résultat.
router.get('/income-statement', canAdvanced, async (req, res, next) => {
  try {
    const fiscalYearId = parseFiscalYearId(req);
    await loadFiscalYear(req.user.tenantId, fiscalYearId);
    const result = await computeIncomeStatement(pool, req.user.tenantId, fiscalYearId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/balance-sheet?fiscalYearId= — bilan.
router.get('/balance-sheet', canAdvanced, async (req, res, next) => {
  try {
    const fiscalYearId = parseFiscalYearId(req);
    await loadFiscalYear(req.user.tenantId, fiscalYearId);
    const result = await computeBalanceSheet(pool, req.user.tenantId, fiscalYearId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/cash-flow?from=&to= — tableau des flux de trésorerie.
router.get('/cash-flow', canAdvanced, async (req, res, next) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!from || !to) return next(new ApiError(400, 'Période requise (from/to)'));
  try {
    const result = await computeCashFlow(pool, req.user.tenantId, { from, to });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/financial-statements.pdf?fiscalYearId= — bilan +
// compte de résultat + flux de trésorerie réunis en un seul document,
// avec l'en-tête du cabinet (logo importé dans les paramètres).
router.get('/financial-statements.pdf', canAdvanced, async (req, res, next) => {
  try {
    const fiscalYearId = parseFiscalYearId(req);
    const fiscalYear = await loadFiscalYear(req.user.tenantId, fiscalYearId);
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    if (!tenantRows[0]) throw new ApiError(404, 'Entreprise introuvable');

    const [incomeStatement, balanceSheet, cashFlow] = await Promise.all([
      computeIncomeStatement(pool, req.user.tenantId, fiscalYearId),
      computeBalanceSheet(pool, req.user.tenantId, fiscalYearId),
      computeCashFlow(pool, req.user.tenantId, { from: isoDate(fiscalYear.start_date), to: isoDate(fiscalYear.end_date) }),
    ]);

    streamFinancialStatementsPdf(res, {
      tenant: tenantRows[0],
      fiscalYear: { label: fiscalYear.label },
      incomeStatement,
      balanceSheet,
      cashFlow,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/gl/reports/financial-statements.xlsx?fiscalYearId= — même contenu
// que le PDF, un onglet par état, pour un comptable qui doit retravailler
// les chiffres (même principe que l'export Excel de la comptabilité simple).
router.get('/financial-statements.xlsx', canAdvanced, async (req, res, next) => {
  try {
    const fiscalYearId = parseFiscalYearId(req);
    const fiscalYear = await loadFiscalYear(req.user.tenantId, fiscalYearId);
    const [tenantRows] = await pool.query('SELECT company_name FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    if (!tenantRows[0]) throw new ApiError(404, 'Entreprise introuvable');

    const [incomeStatement, balanceSheet, cashFlow] = await Promise.all([
      computeIncomeStatement(pool, req.user.tenantId, fiscalYearId),
      computeBalanceSheet(pool, req.user.tenantId, fiscalYearId),
      computeCashFlow(pool, req.user.tenantId, { from: isoDate(fiscalYear.start_date), to: isoDate(fiscalYear.end_date) }),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lyko System';
    workbook.created = new Date();

    function writeLinesSheet(name, title, sections) {
      const sheet = workbook.addWorksheet(name);
      sheet.getColumn(1).width = 45;
      sheet.getColumn(2).width = 18;
      sheet.mergeCells(1, 1, 1, 2);
      sheet.getCell(1, 1).value = `${title} — ${tenantRows[0].company_name} — Exercice ${fiscalYear.label}`;
      sheet.getCell(1, 1).font = { bold: true, size: 12 };
      let row = 3;
      for (const section of sections) {
        sheet.getCell(row, 1).value = section.heading;
        sheet.getCell(row, 1).font = { bold: true };
        row += 1;
        for (const l of section.lines) {
          sheet.getCell(row, 1).value = l.label;
          sheet.getCell(row, 2).value = l.amount;
          sheet.getCell(row, 2).numFmt = '#,##0';
          row += 1;
        }
        row += 1;
      }
      return sheet;
    }

    writeLinesSheet('Compte de résultat', 'Compte de résultat', [
      {
        heading: 'Produits',
        lines: [
          ...incomeStatement.produits.map((p) => ({ label: `${p.code} — ${p.label}`, amount: p.amount })),
          { label: 'Total produits', amount: incomeStatement.totalProduits },
        ],
      },
      {
        heading: 'Charges',
        lines: [
          ...incomeStatement.charges.map((c) => ({ label: `${c.code} — ${c.label}`, amount: c.amount })),
          { label: 'Total charges', amount: incomeStatement.totalCharges },
        ],
      },
      { heading: 'Résultat', lines: [{ label: 'Résultat net', amount: incomeStatement.resultatNet }] },
    ]);

    writeLinesSheet('Bilan', 'Bilan', [
      {
        heading: 'Actif',
        lines: [
          ...balanceSheet.actif.map((a) => ({ label: `${a.code} — ${a.label}`, amount: a.amount })),
          ...(balanceSheet.resultatNet < 0 ? [{ label: "Perte de l'exercice", amount: -balanceSheet.resultatNet }] : []),
          { label: 'Total actif', amount: balanceSheet.totalActif },
        ],
      },
      {
        heading: 'Passif',
        lines: [
          ...balanceSheet.passif.map((p) => ({ label: `${p.code} — ${p.label}`, amount: p.amount })),
          ...(balanceSheet.resultatNet > 0 ? [{ label: "Bénéfice de l'exercice", amount: balanceSheet.resultatNet }] : []),
          { label: 'Total passif', amount: balanceSheet.totalPassif },
        ],
      },
    ]);

    writeLinesSheet('Flux de trésorerie', 'Tableau des flux de trésorerie', [
      {
        heading: 'Trésorerie',
        lines: [
          { label: 'Trésorerie en début de période', amount: cashFlow.openingBalance },
          { label: 'Encaissements', amount: cashFlow.totalInflows },
          { label: 'Décaissements', amount: -cashFlow.totalOutflows },
          { label: 'Trésorerie en fin de période', amount: cashFlow.closingBalance },
        ],
      },
    ]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="etats-financiers-${fiscalYear.label}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
