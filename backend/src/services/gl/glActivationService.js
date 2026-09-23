'use strict';

/**
 * Activation / suspension du module SYSCOHADA + rattrapage rétroactif —
 * décision explicite de l'utilisateur : « les deux comptabilités doivent
 * être sur la plateforme, l'entreprise active celle qu'elle veut, et peut
 * migrer de l'une à l'autre sans perdre de données ». Concrètement :
 *
 * - Activer un tenant JAMAIS initialisé : crée le plan comptable (seed),
 *   les exercices nécessaires, PUIS génère l'écriture GL de chaque
 *   opération déjà enregistrée (loyers, dépenses, charges, versements) —
 *   le bilan reflète alors toute l'histoire, pas seulement demain.
 * - Suspendre : coupe la génération de NOUVELLES écritures
 *   (`gl_module_enabled = 0`), sans rien supprimer — comptes et écritures
 *   déjà générés restent consultables dans l'espace Comptabilité avancée.
 * - Réactiver un tenant déjà initialisé : ne re-seed jamais (idempotent de
 *   toute façon, mais inutile), rejoue seulement le rattrapage pour
 *   couvrir les opérations enregistrées PENDANT la suspension (idempotent
 *   par construction : une opération déjà pourvue d'une écriture est
 *   ignorée, jamais dupliquée).
 */

const { seed } = require('../../db/seedGeneralLedger');
const { genererEcriture } = require('./glPostingService');
const {
  EXPENSE_CATEGORY_TO_OPERATION_TYPE,
  FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE,
  FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE,
} = require('../../constants/glOperationTypes');
const { logGlAudit } = require('./glAuditService');

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Le plan comptable a-t-il déjà été créé au moins une fois (indépendant de `gl_module_enabled`) ? */
async function isInitialized(conn, tenantId) {
  const [rows] = await conn.query('SELECT 1 FROM gl_accounts WHERE tenant_id = :tenantId LIMIT 1', { tenantId });
  return rows.length > 0;
}

/** Plus ancienne date parmi les 4 tables sources d'opérations, ou `null` si aucune n'existe encore. */
async function findEarliestOperationDate(conn, tenantId) {
  const [[row]] = await conn.query(
    `SELECT MIN(d) AS earliest FROM (
       SELECT MIN(paid_at) AS d FROM rent_payments WHERE tenant_id = :tenantId AND deleted_at IS NULL
       UNION ALL SELECT MIN(paid_at) FROM utility_payments WHERE tenant_id = :tenantId
       UNION ALL SELECT MIN(expense_date) FROM expenses WHERE tenant_id = :tenantId AND deleted_at IS NULL
       UNION ALL SELECT MIN(paid_at) FROM owner_payouts WHERE tenant_id = :tenantId
       UNION ALL SELECT MIN(acquisition_date) FROM fixed_assets WHERE tenant_id = :tenantId
       UNION ALL SELECT MIN(paid_at) FROM lease_opening_debt_payments WHERE tenant_id = :tenantId
       UNION ALL SELECT MIN(entry_fee_received_at) FROM leases WHERE tenant_id = :tenantId
     ) t`,
    { tenantId },
  );
  return row.earliest ? isoDate(row.earliest) : null;
}

/** Crée les exercices comptables calendaires manquants pour couvrir [fromDate, toDate]. Ignore une année déjà couverte par un exercice existant (même non calendaire). */
async function ensureFiscalYearsCoverRange(conn, tenantId, fromDate, toDate) {
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  const created = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const [existing] = await conn.query(
      `SELECT id FROM gl_fiscal_years WHERE tenant_id = :tenantId AND start_date <= :endDate AND end_date >= :startDate LIMIT 1`,
      { tenantId, startDate, endDate },
    );
    if (existing[0]) continue;
    const [result] = await conn.query(
      `INSERT INTO gl_fiscal_years (tenant_id, label, start_date, end_date, status) VALUES (:tenantId, :label, :startDate, :endDate, 'ouvert')`,
      { tenantId, label: String(year), startDate, endDate },
    );
    created.push({ id: result.insertId, label: String(year), startDate, endDate });
  }
  return created;
}

/** Génère l'écriture d'UNE opération si elle n'en a pas déjà une — idempotent, jamais de doublon. */
async function backfillOne(pool, tenantId, summary, op) {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = :sourceTable AND source_id = :sourceId LIMIT 1',
      { tenantId, sourceTable: op.sourceTable, sourceId: op.sourceId },
    );
    if (existing[0]) {
      summary.skipped += 1;
      return;
    }

    await conn.beginTransaction();
    await genererEcriture(conn, {
      tenantId,
      operationType: op.operationType,
      entryDate: op.entryDate,
      amount: op.amount,
      paymentMethod: op.paymentMethod,
      narrationVars: op.narrationVars,
      sourceTable: op.sourceTable,
      sourceId: op.sourceId,
      createdBy: op.createdBy,
      context: op.context ?? {},
    });
    await conn.commit();
    summary.generated += 1;
  } catch (err) {
    await conn.rollback().catch(() => {});
    summary.errors.push(`${op.sourceTable}#${op.sourceId} (${op.entryDate}) : ${err.message}`);
  } finally {
    conn.release();
  }
}

/**
 * Rejoue toutes les opérations depuis `fromDate` (inclus) qui n'ont pas
 * encore d'écriture GL — traitées dans l'ordre chronologique GLOBAL (les 4
 * tables mélangées), pas table par table, pour que la numérotation continue
 * des écritures reste lisible dans le journal. Résilient : une opération en
 * échec (ex. catégorie de dépense sans correspondance) est journalisée dans
 * `errors` et n'interrompt jamais les suivantes.
 */
async function backfillHistoricalEntries(pool, tenantId, { fromDate, createdBy }) {
  const summary = { generated: 0, skipped: 0, errors: [] };
  const operations = [];

  const [rentPayments] = await pool.query(
    `SELECT rp.id, rp.lease_id, rp.amount, rp.payment_method, rp.paid_at, rp.covers_month, rp.recorded_by,
            r.first_name, r.last_name
     FROM rent_payments rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN renters r ON r.id = l.renter_id
     WHERE rp.tenant_id = :tenantId AND rp.paid_at >= :fromDate AND rp.deleted_at IS NULL`,
    { tenantId, fromDate },
  );
  for (const p of rentPayments) {
    operations.push({
      sourceTable: 'rent_payments',
      sourceId: p.id,
      operationType: 'loyer_encaisse',
      entryDate: isoDate(p.paid_at),
      amount: Number(p.amount),
      paymentMethod: p.payment_method,
      narrationVars: { mois: p.covers_month, locataire: `${p.first_name} ${p.last_name}` },
      createdBy: p.recorded_by ?? createdBy,
      context: { leaseId: p.lease_id },
    });
  }

  const [openingDebtPayments] = await pool.query(
    `SELECT lodp.id, lodp.lease_id, lodp.amount, lodp.payment_method, lodp.paid_at, lodp.recorded_by,
            r.first_name, r.last_name
     FROM lease_opening_debt_payments lodp
     JOIN leases l ON l.id = lodp.lease_id
     JOIN renters r ON r.id = l.renter_id
     WHERE lodp.tenant_id = :tenantId AND lodp.paid_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const p of openingDebtPayments) {
    operations.push({
      sourceTable: 'lease_opening_debt_payments',
      sourceId: p.id,
      operationType: 'dette_initiale_encaissee',
      entryDate: isoDate(p.paid_at),
      amount: Number(p.amount),
      paymentMethod: p.payment_method,
      narrationVars: { locataire: `${p.first_name} ${p.last_name}` },
      createdBy: p.recorded_by ?? createdBy,
      context: { leaseId: p.lease_id },
    });
  }

  const [utilityPayments] = await pool.query(
    `SELECT up.id, up.amount, up.payment_method, up.paid_at, up.recorded_by,
            uc.utility_type, uc.period_start, uc.period_end, uc.lease_id,
            r.first_name, r.last_name
     FROM utility_payments up
     JOIN utility_charges uc ON uc.id = up.charge_id
     JOIN leases l ON l.id = uc.lease_id
     JOIN renters r ON r.id = l.renter_id
     WHERE up.tenant_id = :tenantId AND up.paid_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const p of utilityPayments) {
    operations.push({
      sourceTable: 'utility_payments',
      sourceId: p.id,
      operationType: 'charge_locative_encaissee',
      entryDate: isoDate(p.paid_at),
      amount: Number(p.amount),
      paymentMethod: p.payment_method,
      narrationVars: {
        fluide: p.utility_type === 'soneb' ? 'SONEB' : 'SBEE',
        periode: `${isoDate(p.period_start)} au ${isoDate(p.period_end)}`,
        locataire: `${p.first_name} ${p.last_name}`,
      },
      createdBy: p.recorded_by ?? createdBy,
      context: { leaseId: p.lease_id },
    });
  }

  const [expenses] = await pool.query(
    `SELECT e.id, e.category, e.label, e.amount, e.expense_date, e.payment_method, e.payment_status,
            e.supplier_id, e.paid_at, e.recorded_by, s.name AS supplier_name
     FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.tenant_id = :tenantId AND e.deleted_at IS NULL AND e.expense_date >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const e of expenses) {
    const operationType = EXPENSE_CATEGORY_TO_OPERATION_TYPE[e.category];
    if (!operationType) {
      summary.errors.push(`expenses#${e.id} : catégorie sans correspondance comptable (${e.category})`);
      continue;
    }
    const isCredit = e.supplier_id != null;
    operations.push({
      sourceTable: 'expenses',
      sourceId: e.id,
      operationType,
      entryDate: isoDate(e.expense_date),
      amount: Number(e.amount),
      // "À crédit" (voir migration 048) : pas de mode de règlement à
      // l'engagement — la ligne dynamique retombe sur le fournisseur (401).
      paymentMethod: isCredit ? undefined : e.payment_method,
      narrationVars: { libelle: e.label, mois: isoDate(e.expense_date).slice(0, 7), employe: e.label },
      createdBy: e.recorded_by ?? createdBy,
      context: isCredit ? { supplierId: e.supplier_id } : {},
    });

    // La dépense "à crédit" a peut-être ENTRE-TEMPS été réglée, avant même
    // l'activation — rejoue aussi ce règlement (entrée distincte : même
    // dépense d'origine, mais `sourceTable` différent pour ne jamais se
    // confondre avec l'engagement ci-dessus dans la déduplication).
    if (isCredit && e.payment_status === 'paid' && e.paid_at) {
      operations.push({
        sourceTable: 'expense_settlements',
        sourceId: e.id,
        operationType: 'reglement_fournisseur',
        entryDate: isoDate(e.paid_at),
        amount: Number(e.amount),
        paymentMethod: e.payment_method,
        narrationVars: { fournisseur: e.supplier_name ?? 'Fournisseur' },
        createdBy: e.recorded_by ?? createdBy,
        context: { supplierId: e.supplier_id },
      });
    }
  }

  const [fixedAssets] = await pool.query(
    `SELECT fa.id, fa.label, fa.category, fa.acquisition_date, fa.acquisition_cost, fa.useful_life_years,
            fa.payment_method, fa.payment_status, fa.supplier_id, fa.paid_at, fa.created_by, s.name AS supplier_name
     FROM fixed_assets fa LEFT JOIN suppliers s ON s.id = fa.supplier_id
     WHERE fa.tenant_id = :tenantId AND fa.acquisition_date >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const a of fixedAssets) {
    const operationType = FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE[a.category];
    if (!operationType) {
      summary.errors.push(`fixed_assets#${a.id} : catégorie sans correspondance comptable (${a.category})`);
      continue;
    }
    const isCredit = a.supplier_id != null;
    operations.push({
      sourceTable: 'fixed_assets',
      sourceId: a.id,
      operationType,
      entryDate: isoDate(a.acquisition_date),
      amount: Number(a.acquisition_cost),
      // "À crédit" (voir migration 049) : pas de mode de règlement à
      // l'acquisition — la ligne dynamique retombe sur le fournisseur (481,
      // jamais 401 — sous-compte distinct de ses dépenses courantes).
      paymentMethod: isCredit ? undefined : a.payment_method,
      narrationVars: { libelle: a.label },
      createdBy: a.created_by ?? createdBy,
      context: isCredit ? { supplierId: a.supplier_id } : {},
    });

    // Même principe que pour les dépenses à crédit : si le fournisseur a
    // ENTRE-TEMPS été réglé (avant l'activation), rejoue aussi ce règlement
    // (entrée distincte, `sourceTable` différent pour ne jamais se confondre
    // avec l'acquisition ci-dessus dans la déduplication).
    if (isCredit && a.payment_status === 'paid' && a.paid_at) {
      operations.push({
        sourceTable: 'fixed_asset_settlements',
        sourceId: a.id,
        operationType: 'reglement_fournisseur_investissement',
        entryDate: isoDate(a.paid_at),
        amount: Number(a.acquisition_cost),
        paymentMethod: a.payment_method,
        narrationVars: { fournisseur: a.supplier_name ?? 'Fournisseur' },
        createdBy: a.created_by ?? createdBy,
        context: { supplierId: a.supplier_id },
      });
    }
  }

  // Amortissements déjà saisis (acte manuel — voir migration 049) avant
  // l'activation : chaque mois déjà enregistré obtient son écriture, datée
  // du premier jour du mois concerné (même convention que POST /:id/depreciate).
  const [depreciations] = await pool.query(
    `SELECT fad.id, fad.fixed_asset_id, fad.period, fad.amount, fad.recorded_by, fa.label, fa.category
     FROM fixed_asset_depreciations fad JOIN fixed_assets fa ON fa.id = fad.fixed_asset_id
     WHERE fad.tenant_id = :tenantId AND fad.period >= :fromPeriod`,
    { tenantId, fromPeriod: fromDate.slice(0, 7) },
  );
  for (const d of depreciations) {
    const operationType = FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE[d.category];
    if (!operationType) {
      summary.errors.push(`fixed_asset_depreciations#${d.id} : catégorie sans correspondance comptable (${d.category})`);
      continue;
    }
    operations.push({
      sourceTable: 'fixed_asset_depreciations',
      sourceId: d.id,
      operationType,
      entryDate: `${d.period}-01`,
      amount: Number(d.amount),
      narrationVars: { libelle: `${d.label} — ${d.period}` },
      createdBy: d.recorded_by ?? createdBy,
      context: {},
    });
  }

  const [payouts] = await pool.query(
    `SELECT op.id, op.owner_id, op.amount, op.payment_method, op.paid_at, op.recorded_by, o.name
     FROM owner_payouts op JOIN owners o ON o.id = op.owner_id
     WHERE op.tenant_id = :tenantId AND op.paid_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const p of payouts) {
    operations.push({
      sourceTable: 'owner_payouts',
      sourceId: p.id,
      operationType: 'reversement_proprietaire',
      entryDate: isoDate(p.paid_at),
      amount: Number(p.amount),
      paymentMethod: p.payment_method,
      narrationVars: { proprietaire: p.name },
      createdBy: p.recorded_by ?? createdBy,
      context: { ownerId: p.owner_id },
    });
  }

  const [lateFees] = await pool.query(
    `SELECT lf.id, lf.lease_id, lf.amount, lf.applied_at, lf.applied_by, r.first_name, r.last_name
     FROM late_fees lf JOIN leases l ON l.id = lf.lease_id JOIN renters r ON r.id = l.renter_id
     WHERE lf.tenant_id = :tenantId AND lf.applied_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const f of lateFees) {
    operations.push({
      sourceTable: 'late_fees',
      sourceId: f.id,
      operationType: 'penalite_retard',
      entryDate: isoDate(f.applied_at),
      amount: Number(f.amount),
      narrationVars: { locataire: `${f.first_name} ${f.last_name}` },
      createdBy: f.applied_by ?? createdBy,
      context: { leaseId: f.lease_id },
    });
  }

  // Cautions — uniquement celles dont la réception/restitution a été
  // EXPLICITEMENT enregistrée (`deposit_received_at`/`refund_payment_method`,
  // colonnes ajoutées avec ce branchement) : jamais de date/mode DEVINÉ pour
  // un bail créé avant cette fonctionnalité, plutôt qu'une fausse certitude.
  const [depositsReceived] = await pool.query(
    `SELECT l.id, l.deposit_amount, l.deposit_received_at, l.deposit_received_method,
            r.first_name, r.last_name
     FROM leases l JOIN renters r ON r.id = l.renter_id
     WHERE l.tenant_id = :tenantId AND l.deposit_received_at IS NOT NULL AND l.deposit_received_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const d of depositsReceived) {
    operations.push({
      sourceTable: 'leases',
      sourceId: d.id,
      operationType: 'caution_recue',
      entryDate: isoDate(d.deposit_received_at),
      amount: Number(d.deposit_amount),
      paymentMethod: d.deposit_received_method,
      narrationVars: { locataire: `${d.first_name} ${d.last_name}` },
      createdBy,
      context: { leaseId: d.id },
    });
  }

  // Frais d'agence à l'entrée — même principe que les cautions ci-dessus
  // (uniquement ceux EXPLICITEMENT enregistrés, `entry_fee_received_at` non
  // NULL), mais `sourceTable` DIFFÉRENT ('lease_entry_fees', pas 'leases') :
  // `backfillOne` dédoublonne par (source_table, source_id) SANS regarder
  // l'opération — réutiliser 'leases' ferait ignorer ces frais dès qu'une
  // caution existe déjà sur le même bail (même sourceId).
  const [entryFeesReceived] = await pool.query(
    `SELECT l.id, l.entry_fee_amount, l.entry_fee_received_at, l.entry_fee_received_method,
            r.first_name, r.last_name
     FROM leases l JOIN renters r ON r.id = l.renter_id
     WHERE l.tenant_id = :tenantId AND l.entry_fee_received_at IS NOT NULL AND l.entry_fee_received_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const f of entryFeesReceived) {
    operations.push({
      sourceTable: 'lease_entry_fees',
      sourceId: f.id,
      operationType: 'frais_agence_encaisse',
      entryDate: isoDate(f.entry_fee_received_at),
      amount: Number(f.entry_fee_amount),
      paymentMethod: f.entry_fee_received_method,
      narrationVars: { locataire: `${f.first_name} ${f.last_name}` },
      createdBy,
      context: {},
    });
  }

  const [depositsReturned] = await pool.query(
    `SELECT mor.id, mor.lease_id, mor.net_refund, mor.refund_payment_method, mor.conducted_at,
            r.first_name, r.last_name
     FROM move_out_reports mor
     JOIN leases l ON l.id = mor.lease_id
     JOIN renters r ON r.id = l.renter_id
     WHERE mor.tenant_id = :tenantId AND mor.status = 'finalized' AND mor.total_deductions = 0
       AND mor.net_refund > 0 AND mor.refund_payment_method IS NOT NULL AND mor.conducted_at >= :fromDate`,
    { tenantId, fromDate },
  );
  for (const d of depositsReturned) {
    operations.push({
      sourceTable: 'move_out_reports',
      sourceId: d.id,
      operationType: 'caution_restituee',
      entryDate: isoDate(d.conducted_at),
      amount: Number(d.net_refund),
      paymentMethod: d.refund_payment_method,
      narrationVars: { locataire: `${d.first_name} ${d.last_name}` },
      createdBy,
      context: { leaseId: d.lease_id },
    });
  }

  operations.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  for (const op of operations) {
    await backfillOne(pool, tenantId, summary, op);
  }

  return summary;
}

/**
 * Active le module pour un tenant : initialise le plan comptable si jamais
 * fait, couvre toute la période nécessaire d'exercices comptables, rejoue
 * l'historique, puis bascule `gl_module_enabled`. Sûr à rappeler plusieurs
 * fois (réactivation après suspension) : jamais de double seed, jamais de
 * double écriture.
 */
async function activateModule(pool, tenantId, { userId, ipAddress }) {
  const alreadyInitialized = await isInitialized(pool, tenantId);

  if (!alreadyInitialized) {
    await seed(tenantId);
  }

  const [[tenantRow]] = await pool.query('SELECT accounting_start_date FROM tenants WHERE id = :id', { id: tenantId });
  const accountingStartDate = tenantRow.accounting_start_date ? isoDate(tenantRow.accounting_start_date) : null;
  const earliestOperation = await findEarliestOperationDate(pool, tenantId);
  const today = isoDate(new Date());
  // La date de démarrage comptable (si définie par le DG) est une borne
  // basse EXPLICITE déjà existante ("avant cette date, pas de comptabilité") :
  // le rattrapage la respecte plutôt que de remonter avant.
  const fromDate = accountingStartDate ?? earliestOperation ?? today;

  const fiscalYearsCreated = await ensureFiscalYearsCoverRange(pool, tenantId, fromDate, today);
  const backfill = await backfillHistoricalEntries(pool, tenantId, { fromDate, createdBy: userId });

  await pool.query('UPDATE tenants SET gl_module_enabled = 1 WHERE id = :id', { id: tenantId });
  await logGlAudit(pool, {
    tenantId,
    userId,
    ipAddress,
    action: alreadyInitialized ? 'module_reactivated' : 'module_activated',
    entityTable: 'tenants',
    entityId: tenantId,
    after: { fromDate, fiscalYearsCreated: fiscalYearsCreated.length, ...backfill, errorCount: backfill.errors.length },
  });

  return {
    wasAlreadyInitialized: alreadyInitialized,
    fromDate,
    fiscalYearsCreated,
    entriesGenerated: backfill.generated,
    entriesSkipped: backfill.skipped,
    errors: backfill.errors,
  };
}

/** Suspend le module : ne supprime rien, coupe seulement la génération de nouvelles écritures. */
async function deactivateModule(pool, tenantId, { userId, ipAddress }) {
  await pool.query('UPDATE tenants SET gl_module_enabled = 0 WHERE id = :id', { id: tenantId });
  await logGlAudit(pool, {
    tenantId,
    userId,
    ipAddress,
    action: 'module_deactivated',
    entityTable: 'tenants',
    entityId: tenantId,
  });
}

module.exports = {
  isInitialized,
  findEarliestOperationDate,
  ensureFiscalYearsCoverRange,
  backfillHistoricalEntries,
  activateModule,
  deactivateModule,
};
