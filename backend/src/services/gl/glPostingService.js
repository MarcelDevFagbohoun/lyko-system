'use strict';

/**
 * Moteur d'écritures comptables — cœur du module SYSCOHADA. `genererEcriture`
 * est LE seul point d'insertion dans `gl_entries`/`gl_entry_lines` pour une
 * écriture AUTOMATIQUE (déclenchée par une opération métier). Toujours
 * appelé DANS LA MÊME TRANSACTION SQL que l'opération d'origine (le `conn`
 * passé en paramètre doit déjà avoir un `beginTransaction()` en cours,
 * jamais `pool` directement) — si l'écriture comptable échoue, l'opération
 * métier échoue aussi (ROLLBACK des deux ensemble), jamais l'inverse.
 *
 * N'invente JAMAIS de compte : tout vient de `gl_posting_rules`/
 * `gl_posting_rule_lines`, résolu dynamiquement pour les comptes/montants
 * variables (voir glAccountResolver).
 */

const { GL_OPERATION_TYPES } = require('../../constants/glOperationTypes');
const { GL_ACCOUNT_ROLES } = require('../../constants/glAccountRoles');
const { resolveLineAccount, resolveLineAmount } = require('./glAccountResolver');
const { nextEntryNumber } = require('./glNumbering');

/**
 * Le module comptabilité SYSCOHADA est-il ACTUELLEMENT actif pour cette
 * entreprise ? Lit `tenants.gl_module_enabled` (migration 044) — PAS la
 * simple présence de comptes : une entreprise initialisée puis suspendue
 * (`glActivationService.deactivateModule`) garde son plan comptable et son
 * historique consultables, mais ne doit plus générer de NOUVELLES écritures
 * tant qu'elle n'a pas été réactivée. TOUS les points de branchement sur les
 * routes existantes (`leases.js`, `charges.js`, `accounting.js`, `owners.js`)
 * DOIVENT vérifier ceci avant d'appeler `genererEcriture` : ce module est
 * additif — une entreprise qui ne l'a jamais activé (ou qui l'a suspendu)
 * continue de fonctionner EXACTEMENT comme avant, jamais bloquée par une
 * comptabilité qu'elle n'a pas mise en place ou plus choisi d'utiliser.
 */
async function isModuleActive(conn, tenantId) {
  const [rows] = await conn.query('SELECT gl_module_enabled FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  return !!rows[0]?.gl_module_enabled;
}

/** Exercice OUVERT couvrant cette date, ou lève une erreur explicite. */
async function resolveOpenFiscalYear(conn, tenantId, entryDate) {
  const [rows] = await conn.query(
    `SELECT id, status FROM gl_fiscal_years
     WHERE tenant_id = :tenantId AND start_date <= :entryDate AND end_date >= :entryDate
     LIMIT 1`,
    { tenantId, entryDate },
  );
  if (!rows[0]) {
    throw new Error(`Aucun exercice comptable ne couvre la date ${entryDate} — créez-le depuis Comptabilité avancée.`);
  }
  if (rows[0].status !== 'ouvert') {
    throw new Error(`L'exercice comptable couvrant ${entryDate} est clôturé — aucune écriture n'y est plus possible.`);
  }
  return rows[0].id;
}

/** Remplace les `{variable}` du gabarit de libellé par les valeurs fournies. */
function renderNarration(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => (vars[key] !== undefined ? String(vars[key]) : `{${key}}`));
}

async function genererEcriture(
  conn,
  { tenantId, operationType, entryDate, amount, paymentMethod, narrationVars, sourceTable, sourceId, createdBy, context = {} },
) {
  if (!GL_OPERATION_TYPES.includes(operationType)) {
    throw new Error(`Type d'opération comptable inconnu : ${operationType}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Montant invalide pour une écriture comptable : ${amount}`);
  }

  const [ruleRows] = await conn.query(
    `SELECT * FROM gl_posting_rules WHERE tenant_id = :tenantId AND operation_type = :operationType AND is_active = 1 LIMIT 1`,
    { tenantId, operationType },
  );
  if (!ruleRows[0]) {
    throw new Error(
      `Aucune règle comptable active pour l'opération "${operationType}" — vérifiez la configuration dans Comptabilité avancée.`,
    );
  }
  const rule = ruleRows[0];

  const [ruleLines] = await conn.query(
    'SELECT * FROM gl_posting_rule_lines WHERE rule_id = :ruleId ORDER BY line_order ASC',
    { ruleId: rule.id },
  );
  if (ruleLines.length < 2) {
    throw new Error(`La règle comptable "${operationType}" est mal configurée (moins de 2 lignes).`);
  }

  // Résolution compte + montant de chaque ligne — une ligne dont le montant
  // se résout à 0 (ex. commission à taux 0 %) est OMISE : jamais de ligne à
  // 0 en base (interdit par la contrainte `amount > 0`), et une ligne à 0
  // n'a de toute façon aucun effet comptable.
  // `entryDate` injecté dans le contexte : le taux de commission doit être
  // celui EN VIGUEUR à la date de l'opération, pas le taux actuel — critique
  // pour un rattrapage rétroactif (glActivationService) où la date de
  // l'écriture peut être bien antérieure à aujourd'hui.
  const contextWithDate = { ...context, entryDate };
  const resolvedLines = [];
  for (const line of ruleLines) {
    const lineAmount = await resolveLineAmount(conn, { tenantId, line, totalAmount: amount, context: contextWithDate });
    if (lineAmount <= 0) continue;
    const { accountId, thirdPartyId } = await resolveLineAccount(conn, { tenantId, line, context: { ...contextWithDate, paymentMethod } });
    // Une ligne de trésorerie peut être résolue par un rôle FIXE
    // (TRESORERIE_MODE_PAIEMENT) ou par un rôle DYNAMIQUE qui retombe sur la
    // trésorerie seulement si `paymentMethod` est fourni (TRESORERIE_OU_FOURNISSEUR*,
    // "à crédit" sinon — voir glAccountRoles.js). Sans ce second cas, `payment_method`
    // restait NULL sur toute dépense/immobilisation payée immédiatement.
    const isTreasuryLine = [
      GL_ACCOUNT_ROLES.TRESORERIE_MODE_PAIEMENT,
      GL_ACCOUNT_ROLES.TRESORERIE_OU_FOURNISSEUR,
      GL_ACCOUNT_ROLES.TRESORERIE_OU_FOURNISSEUR_INVESTISSEMENT,
    ].includes(line.account_role);
    resolvedLines.push({ side: line.side, accountId, thirdPartyId, amount: Math.round(lineAmount), isTreasuryLine });
  }

  // Refus de toute écriture déséquilibrée — LA garantie centrale du moteur.
  const totalDebit = resolvedLines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0);
  const totalCredit = resolvedLines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Écriture comptable déséquilibrée pour "${operationType}" (débit ${totalDebit} ≠ crédit ${totalCredit}) — opération refusée.`,
    );
  }
  if (totalDebit === 0) {
    throw new Error(`Écriture comptable vide pour "${operationType}" (toutes les lignes résolues à 0) — opération refusée.`);
  }

  const fiscalYearId = await resolveOpenFiscalYear(conn, tenantId, entryDate);
  const entryNumber = await nextEntryNumber(conn, tenantId);
  const narration = renderNarration(rule.narration_template, narrationVars);

  const [entryResult] = await conn.query(
    `INSERT INTO gl_entries
       (tenant_id, journal_id, fiscal_year_id, entry_number, piece_number, entry_date, narration,
        source_operation_type, source_table, source_id, status, created_by)
     VALUES
       (:tenantId, :journalId, :fiscalYearId, :entryNumber, :entryNumber, :entryDate, :narration,
        :operationType, :sourceTable, :sourceId, 'validee', :createdBy)`,
    {
      tenantId,
      journalId: rule.journal_id,
      fiscalYearId,
      entryNumber,
      entryDate,
      narration,
      operationType,
      sourceTable: sourceTable ?? null,
      sourceId: sourceId ?? null,
      createdBy: createdBy ?? null,
    },
  );
  const entryId = entryResult.insertId;

  for (const [i, line] of resolvedLines.entries()) {
    await conn.query(
      `INSERT INTO gl_entry_lines (entry_id, line_order, account_id, third_party_id, side, amount, payment_method)
       VALUES (:entryId, :order, :accountId, :thirdPartyId, :side, :amount, :paymentMethod)`,
      {
        entryId,
        order: i + 1,
        accountId: line.accountId,
        thirdPartyId: line.thirdPartyId,
        side: line.side,
        amount: line.amount,
        // Uniquement sur la ligne de trésorerie (résolue via le rôle
        // TRESORERIE_MODE_PAIEMENT) — jamais sur les autres lignes.
        paymentMethod: line.isTreasuryLine ? paymentMethod ?? null : null,
      },
    );
  }

  return { entryId, entryNumber, totalDebit, totalCredit, lines: resolvedLines };
}

module.exports = { genererEcriture, resolveOpenFiscalYear, renderNarration, isModuleActive };
