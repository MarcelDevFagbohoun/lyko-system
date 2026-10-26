'use strict';

/**
 * Accès base de données des dépenses du cabinet (journal, saisie, correction, règlement d'une dépense
 * « à crédit », suppression logique) et des fournisseurs. Code déplacé depuis `routes/accounting.js` :
 * la route garde la validation, les codes HTTP, les logs et la mise en forme publique (`toPublicExpense`).
 */

const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { EXPENSE_CATEGORY_KEYS } = require('../constants/expenses');
const { EXPENSE_CATEGORY_TO_OPERATION_TYPE } = require('../constants/glOperationTypes');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { resolveExpensePosting } = require('./gl/glExpensePosting');
const { extourneEcriture } = require('./gl/glReversalService');
const { notifyDg } = require('./gl/glNotificationService');
const { assertUploadType, randomFileName } = require('../utils/uploads');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { claimIdempotencyKey } = require('./paymentGuards');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

/** Charge une dépense de l'entreprise courante (non supprimée), ou lève 404. */
async function loadExpense(conn, tenantId, id) {
  const [rows] = await conn.query(
    'SELECT * FROM expenses WHERE id = :id AND tenant_id = :tenantId AND deleted_at IS NULL LIMIT 1',
    { id, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Dépense introuvable');
  return rows[0];
}

/** Journal des dépenses. `filters` : { from, to, category, q, propertyId } (déjà typés par la route). */
async function listExpenses(tenantId, { from, to, category, q, propertyId }) {
  const params = { tenantId };
  let where = 'e.tenant_id = :tenantId AND e.deleted_at IS NULL';

  // Même règle que la carte « Dépenses » du tableau de bord : une dépense payée appartient au mois où
  // l'argent est sorti (`paid_at`) ; une dépense à crédit pas encore payée reste, elle, à sa date de dépense.
  if (from) { where += " AND (CASE WHEN e.payment_status = 'paid' THEN COALESCE(e.paid_at, e.expense_date) ELSE e.expense_date END) >= :from"; params.from = from; }
  if (to) { where += " AND (CASE WHEN e.payment_status = 'paid' THEN COALESCE(e.paid_at, e.expense_date) ELSE e.expense_date END) <= :to"; params.to = to; }

  if (category && EXPENSE_CATEGORY_KEYS.includes(category)) {
    where += ' AND e.category = :category';
    params.category = category;
  }

  if (q) {
    where += ' AND e.label LIKE :q';
    params.q = `%${q}%`;
  }

  if (Number.isInteger(propertyId) && propertyId > 0) {
    where += ' AND e.property_id = :propertyId';
    params.propertyId = propertyId;
  }

  // Journal = ordre de SAISIE (la plus récemment enregistrée en tête),
  // pas la date de dépense choisie par l'utilisateur : une dépense
  // ressaisie plus tard avec une date antérieure ne doit pas se retrouver
  // « perdue » en dessous d'anciennes saisies simplement mieux datées.
  // `p.code` : pour distinguer d'un coup d'œil, dans ce journal commun, une
  // dépense de fonctionnement du cabinet d'un travaux facturé à un Bien
  // (donc à son propriétaire — voir `GET /dashboard` ci-dessus).
  const [rows] = await pool.query(
    `SELECT e.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role,
            p.code AS property_code, s.name AS supplier_name
     FROM expenses e
     JOIN users u ON u.id = e.recorded_by
     LEFT JOIN properties p ON p.id = e.property_id
     LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE ${where}
     ORDER BY e.created_at DESC, e.id DESC`,
    params,
  );
  return rows;
}

/** Enregistre une dépense (+ justificatif optionnel). Renvoie l'id. */
async function createExpense(tenantId, userId, data, file) {
  const conn = await pool.getConnection();
  // Bug corrigé (audit comptabilité avancée du 06/10/2026) : le justificatif est écrit sur disque AVANT
  // l'écriture GL (voir plus bas) — si celle-ci échoue (ex. aucun exercice comptable ouvert) et fait
  // échouer toute la transaction, le fichier restait orphelin sur disque, sans jamais être rattaché à
  // aucune dépense réelle. Suit le chemin écrit pour le nettoyer si la transaction ne va pas au bout.
  let writtenReceiptPath = null;
  try {
    await assertPeriodOpen(tenantId, data.expenseDate);

    // Un `unitId` exige un `propertyId` (l'unité doit appartenir à ce Bien) ;
    // les deux, si fournis, doivent exister dans l'entreprise courante.
    if (data.propertyId) {
      const [propRows] = await conn.query('SELECT id FROM properties WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id: data.propertyId,
        tenantId,
      });
      if (!propRows[0]) throw new ApiError(404, 'Bien introuvable');
    }
    if (data.unitId) {
      if (!data.propertyId) throw new ApiError(400, 'Sélectionnez le Bien avant son Unité');
      const [unitRows] = await conn.query(
        'SELECT id FROM property_units WHERE id = :id AND property_id = :propertyId AND tenant_id = :tenantId LIMIT 1',
        { id: data.unitId, propertyId: data.propertyId, tenantId },
      );
      if (!unitRows[0]) throw new ApiError(404, 'Unité introuvable pour ce Bien');
    }

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.expenseDate);
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'expense', data.idempotencyKey);

    // "À crédit" : récupère ou crée le fournisseur par nom (pas de module
    // fournisseurs complet — juste assez pour un tiers identifiable et
    // réutilisable, voir migration 048). Recherche insensible aux espaces
    // superflus uniquement ; deux libellés légèrement différents pour le
    // même fournisseur créent volontairement deux fiches distinctes plutôt
    // que de deviner un rapprochement flou.
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
      `INSERT INTO expenses (tenant_id, category, label, amount, expense_date, payment_method, payment_status, paid_at, supplier_id, notes, property_id, unit_id, recorded_by)
       VALUES (:tenantId, :category, :label, :amount, :expenseDate, :paymentMethod, :paymentStatus, :paidAt, :supplierId, :notes, :propertyId, :unitId, :by)`,
      {
        tenantId,
        category: data.category,
        label: data.label,
        amount: data.amount,
        expenseDate: data.expenseDate,
        paymentMethod: data.paymentStatus === 'paid' ? data.paymentMethod : null,
        paymentStatus: data.paymentStatus,
        paidAt: data.paymentStatus === 'paid' ? data.expenseDate : null,
        supplierId,
        notes: data.notes,
        propertyId: data.propertyId ?? null,
        unitId: data.unitId ?? null,
        by: userId,
      },
    );
    const expenseId = result.insertId;

    if (file) {
      const ext = assertUploadType(file, { pdf: true, label: 'Justificatif' }); // image OU PDF
      const dir = path.join(UPLOADS_ROOT, `tenants/${tenantId}/expenses`);
      await fs.mkdir(dir, { recursive: true });
      const rel = `tenants/${tenantId}/expenses/${randomFileName(String(expenseId), ext)}`;
      await fs.writeFile(path.join(UPLOADS_ROOT, rel), file.buffer);
      writtenReceiptPath = rel;
      await conn.query('UPDATE expenses SET receipt_path = :path WHERE id = :id', { path: rel, id: expenseId });
    }

    // Module comptabilité SYSCOHADA (nouveau) — voir le commentaire identique
    // dans routes/leases.js `recordRentPayment` : rien ne change pour une
    // entreprise qui n'a pas activé le module. `salaires` pointe vers la
    // règle dédiée `salaire_paye` (décision validée), pas une règle de
    // dépense générique.
    if (await isModuleActive(conn, tenantId)) {
      const operationType = EXPENSE_CATEGORY_TO_OPERATION_TYPE[data.category];
      if (!operationType) {
        throw new Error(`Catégorie de dépense sans correspondance comptable : ${data.category}`);
      }
      const posting = await resolveExpensePosting(conn, {
        tenantId,
        propertyId: data.propertyId,
        entryDate: data.expenseDate,
        categoryOperationType: operationType,
      });
      await genererEcriture(conn, {
        tenantId,
        operationType: posting.operationType,
        entryDate: data.expenseDate,
        amount: data.amount,
        // "À crédit" : pas de mode de règlement (rien n'est payé) — la
        // ligne dynamique `tresorerie_ou_fournisseur` retombe alors sur le
        // fournisseur (401) via `context.supplierId`. Voir glAccountResolver.
        paymentMethod: data.paymentStatus === 'paid' ? data.paymentMethod : undefined,
        narrationVars: { libelle: data.label, mois: data.expenseDate.slice(0, 7), employe: data.label },
        sourceTable: 'expenses',
        sourceId: expenseId,
        createdBy: userId,
        context: { supplierId, ...posting.context },
      });

      // Notifie le DG si la dépense dépasse le seuil paramétré (décision
      // validée) — jamais de notification si aucun seuil n'a été fixé.
      const [[tenantRow]] = await conn.query('SELECT gl_expense_alert_threshold FROM tenants WHERE id = :id', {
        id: tenantId,
      });
      if (tenantRow.gl_expense_alert_threshold != null && data.amount > Number(tenantRow.gl_expense_alert_threshold)) {
        await notifyDg(conn, {
          tenantId,
          type: 'expense_threshold',
          message: `Dépense de ${data.amount} FCFA au-dessus du seuil (${data.label})`,
          entityTable: 'expenses',
          entityId: expenseId,
        });
      }
    }

    await conn.commit();
    return expenseId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    // Le justificatif a été écrit sur disque AVANT ce point (voir plus haut) — hors de la transaction
    // SQL, donc jamais annulé par le rollback : nettoyé explicitement ici pour ne pas laisser un
    // fichier orphelin (ex. échec de l'écriture GL faute d'exercice comptable ouvert).
    if (writtenReceiptPath) await fs.unlink(path.join(UPLOADS_ROOT, writtenReceiptPath)).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Corrige une dépense ; renvoie la ligne mise à jour (avec auteur et fournisseur). */
async function updateExpense(tenantId, id, data) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadExpense(pool, tenantId, id);
    await assertPeriodOpen(tenantId, existing.expense_date);
    if (data.expenseDate !== undefined) {
      await assertPeriodOpen(tenantId, data.expenseDate);
    }
    // Une dépense "à crédit" ne peut pas se voir attribuer un mode de
    // règlement par cette route générique — ça sauterait la génération de
    // l'écriture de règlement (voir POST /expenses/:id/pay, dédiée à ça).
    if (data.paymentMethod !== undefined && existing.payment_status === 'unpaid') {
      throw new ApiError(409, 'Cette dépense est à crédit — utilisez "Régler" pour enregistrer son paiement.');
    }

    const fields = [];
    const params = { id };
    if (data.category !== undefined) { fields.push('category = :category'); params.category = data.category; }
    if (data.label !== undefined) { fields.push('label = :label'); params.label = data.label; }
    if (data.amount !== undefined) { fields.push('amount = :amount'); params.amount = data.amount; }
    if (data.expenseDate !== undefined) { fields.push('expense_date = :expenseDate'); params.expenseDate = data.expenseDate; }
    if (data.paymentMethod !== undefined) { fields.push('payment_method = :paymentMethod'); params.paymentMethod = data.paymentMethod; }
    if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

    if (fields.length > 0) {
      await conn.beginTransaction();
      // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
      // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
      await assertPeriodOpenLocked(conn, tenantId, existing.expense_date);
      if (data.expenseDate !== undefined) {
        await assertPeriodOpenLocked(conn, tenantId, data.expenseDate);
      }
      await conn.query(`UPDATE expenses SET ${fields.join(', ')} WHERE id = :id`, params);
      await conn.commit();
    }

    const [rows] = await pool.query(
      `SELECT e.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role,
              s.name AS supplier_name
       FROM expenses e JOIN users u ON u.id = e.recorded_by LEFT JOIN suppliers s ON s.id = e.supplier_id
       WHERE e.id = :id`,
      { id },
    );
    return rows[0];
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Règle une dépense « à crédit » (solde la dette fournisseur, sort la trésorerie). */
async function payExpense(tenantId, userId, id, data) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadExpense(conn, tenantId, id);
    if (existing.payment_status !== 'unpaid') throw new ApiError(409, 'Cette dépense est déjà réglée.');
    await assertPeriodOpen(tenantId, data.paidAt);

    const [supplierRows] = await conn.query('SELECT name FROM suppliers WHERE id = :id', { id: existing.supplier_id });
    const supplierName = supplierRows[0]?.name ?? 'Fournisseur';

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.paidAt);

    // Bug corrigé (audit sécurité) : la vérification `payment_status !==
    // 'unpaid'` ci-dessus se fait AVANT la transaction, sans verrou — un
    // double-clic ou une requête relancée pouvait passer les deux fois cette
    // vérification puis régler la dépense deux fois (deux écritures GL pour
    // un seul vrai paiement). `FOR UPDATE` sérialise les tentatives
    // concurrentes ; l'UPDATE conditionné à `payment_status = 'unpaid'`
    // (vérifié via `affectedRows`) est le filet de sécurité final, même
    // schéma que `rent_payments`/`utility_payments`.
    const [[locked]] = await conn.query(
      'SELECT payment_status FROM expenses WHERE id = :id AND tenant_id = :tenantId FOR UPDATE',
      { id, tenantId },
    );
    if (!locked || locked.payment_status !== 'unpaid') {
      throw new ApiError(409, 'Cette dépense est déjà réglée.');
    }

    const [updateResult] = await conn.query(
      `UPDATE expenses SET payment_status = :status, payment_method = :method, paid_at = :paidAt
       WHERE id = :id AND payment_status = 'unpaid'`,
      { status: 'paid', method: data.paymentMethod, paidAt: data.paidAt, id },
    );
    if (updateResult.affectedRows === 0) throw new ApiError(409, 'Cette dépense est déjà réglée.');

    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'reglement_fournisseur',
        entryDate: data.paidAt,
        amount: Number(existing.amount),
        paymentMethod: data.paymentMethod,
        narrationVars: { fournisseur: supplierName },
        // Haute #6 (étape 51) : `sourceTable` distinct de l'engagement ('expenses' ci-dessus, à la
        // création) — MÊME principe que `glActivationService.js` (rattrapage), qui utilise déjà
        // 'expense_settlements' pour ne jamais confondre les deux dans la déduplication. Avant ce
        // correctif, les deux événements partageaient (source_table='expenses', source_id=id) : si le
        // module était suspendu puis réactivé, le rattrapage ne reconnaissait jamais ce règlement déjà
        // posté en direct (il cherchait 'expense_settlements', jamais 'expenses') et en reposait un
        // second, en double.
        sourceTable: 'expense_settlements',
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

/** Fournisseurs déjà utilisés (autocomplétion + total dû), pas un module CRM complet. */
async function listSuppliers(tenantId) {
  // Étape 51bis (Basse #7) : ne sommait que les dépenses impayées — un fournisseur UNIQUEMENT lié à
  // une immobilisation achetée « à crédit » (même flux `supplier_id`, voir createFixedAssetSchema)
  // affichait `totalOwed: 0` alors qu'il lui était réellement dû de l'argent. Deux sous-requêtes
  // corrélées (jamais un second LEFT JOIN direct, qui multiplierait les lignes dépenses × immobilisations
  // du même fournisseur et fausserait la somme) plutôt qu'une jointure.
  const [rows] = await pool.query(
    `SELECT s.id, s.name,
            (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
               WHERE e.supplier_id = s.id AND e.deleted_at IS NULL AND e.payment_status = 'unpaid')
            + (SELECT COALESCE(SUM(fa.acquisition_cost), 0) FROM fixed_assets fa
               WHERE fa.supplier_id = s.id AND fa.payment_status = 'unpaid') AS total_owed
     FROM suppliers s
     WHERE s.tenant_id = :tenantId
     ORDER BY s.name ASC`,
    { tenantId },
  );
  return rows;
}

/** Suppression logique d'une dépense (justification obligatoire) ; extourne ses écritures GL validées. */
async function deleteExpense(tenantId, userId, id, reason) {
  const conn = await pool.getConnection();
  try {
    const existing = await loadExpense(pool, tenantId, id);
    await assertPeriodOpen(tenantId, existing.expense_date);

    // Bug corrigé (audit fermeture du mois, point 5, 16/10/2026) : SI une écriture GL validée existe
    // pour cette dépense, son extourne plus bas est datée AUJOURD'HUI (date de l'écriture MIROIR
    // elle-même, jamais celle de la dépense annulée, déjà vérifiée ci-dessus) — jamais vérifiée contre
    // la clôture du mois jusqu'ici. Même principe que le correctif déjà en place sur l'extourne MANUELLE.
    const todayIso = new Date().toISOString().slice(0, 10);
    const [existingGlEntries] = await pool.query(
      `SELECT id FROM gl_entries
       WHERE tenant_id = :tenantId AND source_table IN ('expenses', 'expense_settlements') AND source_id = :id AND status = 'validee'`,
      { tenantId, id },
    );
    if (existingGlEntries.length > 0) await assertPeriodOpen(tenantId, todayIso);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, existing.expense_date);
    if (existingGlEntries.length > 0) await assertPeriodOpenLocked(conn, tenantId, todayIso);
    await conn.query(
      'UPDATE expenses SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: userId, reason, id },
    );

    // Étape 51bis (Moyenne #5) : supprimer une dépense déjà comptabilisée ne contre-passait jamais son
    // écriture GL — la dépense disparaissait du tableau de bord simple (filtré sur `deleted_at`), mais
    // restait indéfiniment dans le bilan/compte de résultat SYSCOHADA, divergence permanente entre les
    // deux vues. Extourne les DEUX écritures possibles (engagement + règlement si la dépense était « à
    // crédit » et déjà réglée, voir Haute #6 — `sourceTable` distincts) — même précédent que l'annulation
    // d'un paiement de loyer (`DELETE /:leaseId/payments/:paymentId`, routes/leases.js).
    const [glEntryRows] = await conn.query(
      `SELECT id, status FROM gl_entries
       WHERE tenant_id = :tenantId AND source_table IN ('expenses', 'expense_settlements') AND source_id = :id`,
      { tenantId, id },
    );
    for (const entry of glEntryRows) {
      if (entry.status !== 'validee') continue;
      await extourneEcriture(conn, {
        tenantId,
        entryId: entry.id,
        entryDate: new Date().toISOString().slice(0, 10),
        userId,
        reason: `Dépense supprimée — ${reason}`,
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

module.exports = {
  loadExpense,
  listExpenses,
  createExpense,
  updateExpense,
  payExpense,
  listSuppliers,
  deleteExpense,
};
