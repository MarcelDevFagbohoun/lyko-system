'use strict';

/**
 * Calcul de paie (option « Paie » des réglages comptables).
 *
 * - niveau 'net'      : aucun prélèvement calculé (comportement historique).
 * - niveau 'cnss'     : part salariale CNSS retenue + part patronale due.
 * - niveau 'complet'  : idem + ITS (barème progressif saisi par l'entreprise, jamais codé en dur).
 *
 * Tous les taux et le barème viennent des réglages de l'entreprise.
 * Base ITS = brut − retenue CNSS salariale. Net = brut − retenue manuelle (avance) − CNSS salariale − ITS.
 */

async function loadPayrollSettings(db, tenantId) {
  const [[row]] = await db.query(
    'SELECT gl_payroll_level, gl_cnss_employee_rate, gl_cnss_employer_rate, gl_its_brackets FROM tenants WHERE id = :tenantId LIMIT 1',
    { tenantId },
  );
  let brackets = row?.gl_its_brackets ?? null;
  if (typeof brackets === 'string') {
    try { brackets = JSON.parse(brackets); } catch { brackets = null; }
  }
  return {
    level: row?.gl_payroll_level ?? 'net',
    cnssEmployeeRate: Number(row?.gl_cnss_employee_rate ?? 0),
    cnssEmployerRate: Number(row?.gl_cnss_employer_rate ?? 0),
    itsBrackets: Array.isArray(brackets) ? brackets : [],
  };
}

/** Impôt progressif par tranches : [{ upTo: 60000, rate: 0 }, { upTo: 150000, rate: 10 }, { upTo: null, rate: 30 }]. */
function computeProgressiveTax(base, brackets) {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo == null ? Infinity : b.upTo;
    if (base > lower) tax += (Math.min(base, upper) - lower) * (b.rate / 100);
    if (base <= upper) break;
    lower = upper;
  }
  return Math.round(tax);
}

function computePayroll(settings, { gross, deduction = 0 }) {
  let cnssEmployee = 0;
  let cnssEmployer = 0;
  let its = 0;
  if (settings.level !== 'net') {
    cnssEmployee = Math.round((gross * settings.cnssEmployeeRate) / 100);
    cnssEmployer = Math.round((gross * settings.cnssEmployerRate) / 100);
  }
  if (settings.level === 'complet') {
    its = computeProgressiveTax(gross - cnssEmployee, settings.itsBrackets);
  }
  const net = gross - deduction - cnssEmployee - its;
  return {
    level: settings.level,
    cnssEmployee,
    cnssEmployer,
    its,
    taxableBase: gross - cnssEmployee,
    net,
    // Charge de salaire comptabilisée (661) : brut moins la retenue manuelle (avance déjà sortie de caisse).
    salaryCost: gross - deduction,
  };
}

module.exports = { loadPayrollSettings, computePayroll, computeProgressiveTax };
