'use strict';

/**
 * Accès base de données des immobilisations du cabinet (registre, acquisition, règlement à crédit,
 * amortissement mensuel, sortie du patrimoine). Code déplacé depuis `routes/accounting.js` : la route
 * garde la validation, les codes HTTP, les logs et la mise en forme publique (`toPublicFixedAsset`).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const {
  FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE,
  FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE,
  FIXED_ASSET_CATEGORY_TO_DISPOSAL_TYPE,
  FIXED_ASSET_CATEGORY_TO_SALE_TYPE,
} = require('../constants/glOperationTypes');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { computeMonthlyDepreciation } = require('./gl/glDepreciationService');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { claimIdempotencyKey } = require('./paymentGuards');
const { isoDate } = require('../utils/dates');

/** Charge une immobilisation de l'entreprise courante, ou lève 404. */
async function loadFixedAsset(conn, tenantId, id) {
  const [rows] = await conn.query('SELECT * FROM fixed_assets WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id,
    tenantId,
  });
  if (!rows[0]) throw new ApiError(404, 'Immobilisation introuvable');
  return rows[0];
}

const ACCUMULATED_DEPRECIATION_JOIN = `
  LEFT JOIN (SELECT fixed_asset_id, SUM(amount) AS total FROM fixed_asset_depreciations GROUP BY fixed_asset_id) fad
    ON fad.fixed_asset_id = fa.id`;

/** Registre des immobilisations du cabinet (jamais les Biens gérés pour les propriétaires). */
async function listFixedAssets(tenantId) {
  const [rows] = await pool.query(
    `SELECT fa.*, s.name AS supplier_name, COALESCE(fad.total, 0) AS accumulated_depreciation
     FROM fixed_assets fa
     LEFT JOIN suppliers s ON s.id = fa.supplier_id
     ${ACCUMULATED_DEPRECIATION_JOIN}
     WHERE fa.tenant_id = :tenantId
     ORDER BY fa.acquisition_date DESC, fa.id DESC`,
    { tenantId },
  );
  return rows;
}

/** Enregistre une immobilisation (comptant ou à crédit). Renvoie l'id. */
async function createFixedAsset(tenantId, userId, data) {
  const conn = await pool.getConnection();
  try {
    await assertPeriodOpen(tenantId, data.acquisitionDate);
    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.acquisitionDate);
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'fixed_asset', data.idempotencyKey);

    let supplierId = null;
    if (data.paymentStatus === 'unpaid') {
      const [existingSupplier] = await conn.query(
        'SELECT id FROM suppliers WHERE tenant_id = :tenantId AND name = :name LIMIT 1',
        { tenantId, name: data.supplierName },
      );
      if (existingSupplier[0]) {
        supplierId = existingSupplier[0].id;
      } else {
        const [supplierResult] = await conn.query(
          'INSERT INTO suppliers (tenant_id, name, created_by) VALUES (:tenantId, :name, :by)',
          { tenantId, name: data.supplierName, by: userId },
        );
        supplierId = supplierResult.insertId;
      }
    }

    const [result] = await conn.query(
      `INSERT INTO fixed_assets (tenant_id, label, category, acquisition_date, acquisition_cost, useful_life_years, payment_method, payment_status, paid_at, supplier_id, created_by)
       VALUES (:tenantId, :label, :category, :acquisitionDate, :acquisitionCost, :usefulLifeYears, :paymentMethod, :paymentStatus, :paidAt, :supplierId, :by)`,
      {
        tenantId,
        label: data.label,
        category: data.category,
        acquisitionDate: data.acquisitionDate,
        acquisitionCost: data.acquisitionCost,
        usefulLifeYears: data.usefulLifeYears,
        paymentMethod: data.paymentStatus === 'paid' ? data.paymentMethod : null,
        paymentStatus: data.paymentStatus,
        paidAt: data.paymentStatus === 'paid' ? data.acquisitionDate : null,
        supplierId,
        by: userId,
      },
    );
    const fixedAssetId = result.insertId;

    if (await isModuleActive(conn, tenantId)) {
      const operationType = FIXED_ASSET_CATEGORY_TO_ACQUISITION_TYPE[data.category];
      await genererEcriture(conn, {
        tenantId,
        operationType,
        entryDate: data.acquisitionDate,
        amount: data.acquisitionCost,
        // "À crédit" : pas de mode de règlement (rien n'est payé) — la ligne
        // dynamique `tresorerie_ou_fournisseur_investissement` retombe sur le
        // fournisseur (481, JAMAIS 401) via `context.supplierId`.
        paymentMethod: data.paymentStatus === 'paid' ? data.paymentMethod : undefined,
        narrationVars: { libelle: data.label },
        sourceTable: 'fixed_assets',
        sourceId: fixedAssetId,
        createdBy: userId,
        context: { supplierId },
      });
    }

    await conn.commit();
    return fixedAssetId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Détail d'une immobilisation + historique de ses amortissements (lignes brutes). */
async function getFixedAsset(tenantId, id) {
  const [rows] = await pool.query(
    `SELECT fa.*, s.name AS supplier_name, COALESCE(fad.total, 0) AS accumulated_depreciation
     FROM fixed_assets fa
     LEFT JOIN suppliers s ON s.id = fa.supplier_id
     ${ACCUMULATED_DEPRECIATION_JOIN}
     WHERE fa.id = :id AND fa.tenant_id = :tenantId LIMIT 1`,
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Immobilisation introuvable');

  const [depreciations] = await pool.query(
    `SELECT fad.period, fad.amount, fad.created_at, u.first_name, u.last_name, u.role
     FROM fixed_asset_depreciations fad
     LEFT JOIN users u ON u.id = fad.recorded_by
     WHERE fad.fixed_asset_id = :id
     ORDER BY fad.period ASC`,
    { id },
  );
  return { row: rows[0], depreciations };
}

/** Règle une immobilisation acquise « à crédit ». */
async function payFixedAsset(tenantId, userId, id, data) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadFixedAsset(conn, tenantId, id);
    if (existing.payment_status !== 'unpaid') throw new ApiError(409, 'Cette immobilisation est déjà réglée.');
    await assertPeriodOpen(tenantId, data.paidAt);

    const [supplierRows] = await conn.query('SELECT name FROM suppliers WHERE id = :id', { id: existing.supplier_id });
    const supplierName = supplierRows[0]?.name ?? 'Fournisseur';

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.paidAt);

    // Même correctif que POST /expenses/:id/pay ci-dessus (audit sécurité) —
    // verrou + double vérification pour empêcher un double règlement.
    const [[locked]] = await conn.query(
      'SELECT payment_status FROM fixed_assets WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId },
    );
    if (!locked || locked.payment_status !== 'unpaid') {
      throw new ApiError(409, 'Cette immobilisation est déjà réglée.');
    }

    const [updateResult] = await conn.query(
      `UPDATE fixed_assets SET payment_status = :status, payment_method = :method, paid_at = :paidAt
       WHERE id = :id AND payment_status = 'unpaid'`,
      { status: 'paid', method: data.paymentMethod, paidAt: data.paidAt, id },
    );
    if (updateResult.affectedRows === 0) throw new ApiError(409, 'Cette immobilisation est déjà réglée.');

    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'reglement_fournisseur_investissement',
        entryDate: data.paidAt,
        amount: Number(existing.acquisition_cost),
        paymentMethod: data.paymentMethod,
        narrationVars: { fournisseur: supplierName },
        // Haute #6 (étape 51) : même correctif que POST /expenses/:id/pay ci-dessus — `sourceTable`
        // distinct de l'acquisition ('fixed_assets', à la création), aligné sur ce que
        // `glActivationService.js` (rattrapage) utilise déjà pour ce même règlement.
        sourceTable: 'fixed_asset_settlements',
        sourceId: id,
        createdBy: userId,
        context: { supplierId: existing.supplier_id },
      });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Enregistre un mois d'amortissement linéaire. Renvoie { depreciationId, amount, remainingBookValue }. */
async function depreciateFixedAsset(tenantId, userId, id, period) {
  const entryDate = `${period}-01`;

  const conn = await pool.getConnection();
  try {
    const existing = await loadFixedAsset(conn, tenantId, id);
    if (existing.status === 'disposed') throw new ApiError(409, 'Cette immobilisation a été sortie du patrimoine.');
    // Étape 51bis (Basse #6) : aucune validation n'empêchait d'enregistrer un amortissement pour un mois
    // ANTÉRIEUR à l'acquisition — un bien qui n'existait pas encore ne peut rien s'être déprécié.
    const acquisitionPeriod = isoDate(existing.acquisition_date).slice(0, 7);
    if (period < acquisitionPeriod) {
      throw new ApiError(400, `Cette immobilisation a été acquise en ${acquisitionPeriod} — aucun amortissement ne peut être antérieur.`);
    }
    await assertPeriodOpen(tenantId, entryDate);

    const [[existingPeriod]] = await conn.query(
      'SELECT id FROM fixed_asset_depreciations WHERE fixed_asset_id = :id AND period = :period LIMIT 1',
      { id, period },
    );
    if (existingPeriod) {
      throw new ApiError(409, `L'amortissement de ${period} a déjà été enregistré pour cette immobilisation.`);
    }

    const [[depRow]] = await conn.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fixed_asset_depreciations WHERE fixed_asset_id = :id',
      { id },
    );
    const remainingBookValue = Number(existing.acquisition_cost) - Number(depRow.total);
    if (remainingBookValue <= 0) throw new ApiError(409, 'Cette immobilisation est déjà entièrement amortie.');

    const [[tenantRow]] = await conn.query('SELECT gl_depreciation_prorata_temporis FROM tenants WHERE id = :id', {
      id: tenantId,
    });
    const monthly = computeMonthlyDepreciation({
      acquisitionCost: Number(existing.acquisition_cost),
      usefulLifeYears: existing.useful_life_years,
      acquisitionDate: isoDate(existing.acquisition_date),
      period,
      prorataTemporis: !!tenantRow.gl_depreciation_prorata_temporis,
    });
    const amount = Math.min(monthly, remainingBookValue);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, entryDate);

    // Bug corrigé (signalé par l'utilisateur, 2026-10-17, même famille que la facture SONEB/SBEE
    // en double) : le contrôle `existingPeriod` ci-dessus se fait AVANT la transaction, sans verrou —
    // un double-clic pouvait passer deux fois cette vérification. On verrouille la ligne de
    // l'immobilisation (FOR UPDATE) pour sérialiser les tentatives concurrentes, puis on revérifie.
    await conn.query('SELECT id FROM fixed_assets WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
      id,
      tenantId,
    });
    const [[existingPeriodLocked]] = await conn.query(
      'SELECT id FROM fixed_asset_depreciations WHERE fixed_asset_id = :id AND period = :period LIMIT 1',
      { id, period },
    );
    if (existingPeriodLocked) {
      throw new ApiError(409, `L'amortissement de ${period} a déjà été enregistré pour cette immobilisation.`);
    }

    const [result] = await conn.query(
      'INSERT INTO fixed_asset_depreciations (tenant_id, fixed_asset_id, period, amount, recorded_by) VALUES (:tenantId, :id, :period, :amount, :by)',
      { tenantId, id, period, amount, by: userId },
    );
    const depreciationId = result.insertId;

    if (await isModuleActive(conn, tenantId)) {
      const operationType = FIXED_ASSET_CATEGORY_TO_DEPRECIATION_TYPE[existing.category];
      await genererEcriture(conn, {
        tenantId,
        operationType,
        entryDate,
        amount,
        narrationVars: { libelle: `${existing.label} — ${period}` },
        sourceTable: 'fixed_asset_depreciations',
        sourceId: depreciationId,
        createdBy: userId,
      });
    }

    await conn.commit();
    return { depreciationId, amount, remainingBookValue: remainingBookValue - amount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Sort une immobilisation du patrimoine (vente, rebut, perte). Acte définitif. */
async function disposeFixedAsset(tenantId, userId, id, { disposedAt, reason, salePrice, salePaymentMethod }) {
  const conn = await pool.getConnection();
  try {
    if (salePrice > 0) {
      if (!salePaymentMethod) throw new ApiError(400, 'Indiquez comment le prix de vente a été encaissé.');
      const [[opt]] = await pool.query('SELECT gl_asset_sale_proceeds AS on_ FROM tenants WHERE id = :t', { t: tenantId });
      if (!opt.on_) {
        throw new ApiError(422, "Pour enregistrer un prix de vente, activez d'abord l'option « Vente d'immobilisations avec prix » dans Comptabilité avancée → Réglages.");
      }
    }
    const existing = await loadFixedAsset(conn, tenantId, id);
    if (existing.status === 'disposed') throw new ApiError(409, 'Cette immobilisation a déjà été sortie du patrimoine.');
    // Étape 51bis (Basse #6) : aucune validation n'empêchait de sortir une immobilisation à une date
    // ANTÉRIEURE à son acquisition, ni antérieure à un amortissement déjà enregistré pour un mois plus
    // tardif — `amortissement_cumule` (glAccountResolver.js) additionne TOUT l'amortissement déjà
    // enregistré sans filtrer par date, une sortie antidatée produirait une VNC incohérente avec sa
    // propre date.
    if (disposedAt < isoDate(existing.acquisition_date)) {
      throw new ApiError(400, `Cette immobilisation a été acquise le ${isoDate(existing.acquisition_date)} — la sortie ne peut pas être antérieure.`);
    }
    const [[depRow]] = await conn.query(
      'SELECT COALESCE(SUM(amount), 0) AS total, MAX(period) AS latestPeriod FROM fixed_asset_depreciations WHERE fixed_asset_id = :id',
      { id },
    );
    if (depRow.latestPeriod && disposedAt.slice(0, 7) < depRow.latestPeriod) {
      throw new ApiError(
        400,
        `Un amortissement a déjà été enregistré pour ${depRow.latestPeriod} — la sortie ne peut pas être antérieure à ce mois.`,
      );
    }
    const accumulatedDepreciation = Number(depRow.total);
    await assertPeriodOpen(tenantId, disposedAt);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, disposedAt);

    // Bug corrigé (signalé par l'utilisateur, 2026-10-17, même famille que la facture SONEB/SBEE en
    // double) : le contrôle `existing.status === 'disposed'` ci-dessus se fait AVANT la transaction,
    // sans verrou, et l'UPDATE n'était pas conditionné au statut — un double-clic pouvait poster DEUX
    // écritures GL de sortie pour la même immobilisation. Même schéma que POST /fixed-assets/:id/pay.
    const [[lockedAsset]] = await conn.query(
      'SELECT status FROM fixed_assets WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId },
    );
    if (!lockedAsset || lockedAsset.status === 'disposed') {
      throw new ApiError(409, 'Cette immobilisation a déjà été sortie du patrimoine.');
    }

    const [disposeResult] = await conn.query(
      `UPDATE fixed_assets
       SET status = 'disposed', disposed_at = :disposedAt, disposed_reason = :reason, disposed_by = :by,
           disposed_sale_price = :salePrice, disposed_sale_method = :saleMethod
       WHERE id = :id AND status <> 'disposed'`,
      { id, disposedAt, reason, by: userId, salePrice: salePrice > 0 ? salePrice : null, saleMethod: salePrice > 0 ? salePaymentMethod : null },
    );
    if (disposeResult.affectedRows === 0) throw new ApiError(409, 'Cette immobilisation a déjà été sortie du patrimoine.');

    if (await isModuleActive(conn, tenantId)) {
      const operationType = salePrice > 0
        ? FIXED_ASSET_CATEGORY_TO_SALE_TYPE[existing.category]
        : FIXED_ASSET_CATEGORY_TO_DISPOSAL_TYPE[existing.category];
      await genererEcriture(conn, {
        tenantId,
        operationType,
        entryDate: disposedAt,
        paymentMethod: salePrice > 0 ? salePaymentMethod : undefined,
        // `montant_total` de la règle = coût d'ACQUISITION brut (jamais la
        // VNC) : la règle elle-même dérive l'amortissement cumulé (compte
        // 28xxx) et la valeur nette comptable résiduelle (compte 654) à
        // partir de ce montant — voir `amortissement_cumule`,
        // glAccountResolver.js.
        amount: Number(existing.acquisition_cost),
        narrationVars: { libelle: `${existing.label} — ${reason}` },
        // Bug trouvé EN vérifiant Basse #6 (étape 51bis) : partageait `sourceTable: 'fixed_assets'` avec
        // l'écriture d'ACQUISITION — les deux restent `validee` indéfiniment (la sortie ne réverse jamais
        // l'acquisition, c'est un évènement distinct qui s'ajoute), donc la contrainte UNIQUE
        // `uq_gl_entries_active_source` (migration 077, Haute #8) rejetait TOUTE sortie d'immobilisation
        // depuis son ajout — régression 100% bloquante jamais détectée par cet audit, car la sortie
        // d'immobilisation est une fonctionnalité du Critique #4 de cette même étape, jamais rejouée par
        // un test après l'ajout de la contrainte. Corrigé en alignant sur la convention déjà établie pour
        // ce même cas de figure (`expense_settlements`, `lease_deposits_return`...) : un label distinct
        // pour un second évènement RÉEL sur la même ligne source.
        sourceTable: 'fixed_asset_disposals',
        sourceId: id,
        createdBy: userId,
        context: { fixedAssetId: id, salePrice },
      });
    }

    await conn.commit();
    return { accumulatedDepreciation, bookValue: Number(existing.acquisition_cost) - accumulatedDepreciation };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  loadFixedAsset,
  listFixedAssets,
  createFixedAsset,
  getFixedAsset,
  payFixedAsset,
  depreciateFixedAsset,
  disposeFixedAsset,
};
