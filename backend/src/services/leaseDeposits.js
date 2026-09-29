'use strict';

/**
 * Cautions supplémentaires (étape 43, demande directe de l'utilisateur, 2026-09-28) — SBEE/SONEB
 * (garantie contre les impayés de charges) et peinture (garantie contre les frais de remise en
 * peinture), chacune optionnelle et indépendante de la caution de loyer déjà existante
 * (`leases.deposit_amount`, jamais touchée ici).
 *
 * Reçues à la signature (comme la caution de loyer), restituées à la sortie — en tout ou partie :
 *   - SBEE/SONEB : la part retenue règle RÉELLEMENT le solde impayé du locataire sur ses charges
 *     (`utility_payments`, via `recordUtilityPayment` déjà utilisé partout ailleurs pour un règlement de
 *     charge) — jamais une simple ligne comptable isolée : les charges de ce locataire ne doivent plus
 *     apparaître impayées après coup, et le propriétaire doit pouvoir recevoir ce qui a été recouvré,
 *     exactement comme n'importe quel autre règlement de charge.
 *   - Peinture : la part retenue est une saisie MANUELLE de l'agent (aucune donnée structurée ne permet
 *     de distinguer automatiquement une dégradation "peinture" dans le catalogue de l'état des lieux) ;
 *     un dépassement au-delà de cette caution retombe sur la caution de loyer (décision explicite).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { ADDITIONAL_DEPOSIT_TYPES, ADDITIONAL_DEPOSIT_LABELS, enabledAdditionalDepositTypes } = require('../constants/leaseDeposits');
const { UTILITY_TYPES } = require('../constants/charges');
const { recordUtilityPayment } = require('../routes/charges');

const UTILITY_TYPE_LABELS = Object.fromEntries(UTILITY_TYPES.map((t) => [t.key, t.label]));

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

function toPublic(row) {
  return {
    type: row.type,
    typeLabel: ADDITIONAL_DEPOSIT_LABELS[row.type] ?? row.type,
    amount: Number(row.amount),
    status: row.status,
    receivedAt: isoDate(row.received_at),
    receivedMethod: row.received_method,
    returnedAt: isoDate(row.returned_at),
    returnedAmount: row.returned_amount != null ? Number(row.returned_amount) : null,
    returnedMethod: row.returned_method,
    deductionAmount: Number(row.deduction_amount),
    deductionNote: row.deduction_note,
  };
}

/** Cautions supplémentaires d'un bail, dans l'ordre du catalogue (SBEE, SONEB, peinture). */
async function listLeaseDeposits(tenantId, leaseId, db = pool) {
  const [rows] = await db.query('SELECT * FROM lease_deposits WHERE tenant_id = :tenantId AND lease_id = :leaseId', {
    tenantId,
    leaseId,
  });
  const byType = new Map(rows.map((r) => [r.type, r]));
  return ADDITIONAL_DEPOSIT_TYPES.map((t) => byType.get(t.key)).filter(Boolean).map(toPublic);
}

/**
 * Enregistre, à la signature du bail, les cautions supplémentaires effectivement demandées à CE
 * locataire — `entries` = `{ sbee?: {amount, paymentMethod, paidAt}, soneb?: {...}, peinture?: {...} }`.
 * Un type absent d'`entries`, ou dont le montant est 0, n'insère aucune ligne : « optionnelle » veut
 * dire qu'une caution non demandée sur ce bail précis ne doit laisser aucune trace, jamais une ligne à 0.
 * `enabledTenantRow` : la ligne `tenants` déjà chargée par l'appelant (jamais relue ici), pour vérifier
 * qu'un type demandé est bien activé pour cette entreprise — sinon ignoré silencieusement (le formulaire
 * ne propose déjà que les types activés ; un type non activé envoyé quand même est simplement ignoré,
 * jamais une erreur qui bloquerait la création du bail pour un détail de configuration).
 */
async function recordAdditionalDeposits(conn, { tenantId, leaseId, renterName, createdBy, entries, enabledTenantRow }) {
  const enabled = new Set(enabledAdditionalDepositTypes(enabledTenantRow).map((t) => t.key));
  for (const type of ADDITIONAL_DEPOSIT_TYPES.map((t) => t.key)) {
    const entry = entries?.[type];
    const amount = Number(entry?.amount ?? 0);
    if (!enabled.has(type) || !amount || amount <= 0) continue;

    const paymentMethod = entry.paymentMethod;
    const paidAt = entry.paidAt;
    const [result] = await conn.query(
      `INSERT INTO lease_deposits (tenant_id, lease_id, type, amount, status, received_at, received_method, created_by)
       VALUES (:tenantId, :leaseId, :type, :amount, 'held', :paidAt, :paymentMethod, :createdBy)`,
      { tenantId, leaseId, type, amount, paidAt, paymentMethod, createdBy },
    );

    if (paymentMethod && (await isModuleActive(conn, tenantId))) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'caution_supplementaire_recue',
        entryDate: paidAt,
        amount,
        paymentMethod,
        narrationVars: { type: ADDITIONAL_DEPOSIT_LABELS[type], locataire: renterName },
        sourceTable: 'lease_deposits',
        // L'id de la ligne elle-même (jamais `leaseId`, partagé par plusieurs types sur le même bail) :
        // `backfillOne` dédoublonne par (source_table, source_id) SEUL, sans regarder `operation_type`
        // — un identifiant partagé ferait ignorer la seconde caution d'un même bail comme "déjà faite".
        sourceId: result.insertId,
        createdBy,
        context: { leaseId },
      });
    }
  }
}

/**
 * Solde impayé (facturé − encaissé, plafonné à 0) d'un locataire sur un fluide donné, factures
 * supprimées logiquement exclues — même règle que partout ailleurs dans le module Charges.
 */
async function getUnpaidUtilityBalance(conn, tenantId, leaseId, utilityType) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(uc.amount), 0) AS billed, COALESCE(SUM(pt.paid_total), 0) AS paid
     FROM utility_charges uc
     LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
     WHERE uc.tenant_id = :tenantId AND uc.lease_id = :leaseId AND uc.utility_type = :utilityType AND uc.deleted_at IS NULL`,
    { tenantId, leaseId, utilityType },
  );
  return Math.max(0, Number(row.billed) - Number(row.paid));
}

/**
 * Règle, jusqu'à `maxAmount` FCFA, les factures impayées/partielles d'un locataire pour un fluide,
 * de la plus ancienne à la plus récente (comme un vrai règlement) — réutilise `recordUtilityPayment`
 * (routes/charges.js), seul endroit qui insère dans `utility_payments` : ce règlement met donc à jour le
 * statut des factures ET permet au propriétaire de recevoir ce qui a été recouvré, exactement comme
 * n'importe quel autre encaissement de charge. Renvoie le montant réellement réglé (peut être < `maxAmount`
 * si le locataire devait moins).
 */
async function settleUnpaidUtilityCharges(conn, { tenantId, leaseId, utilityType, maxAmount, paidAt, createdBy }) {
  if (maxAmount <= 0) return 0;
  const [charges] = await conn.query(
    `SELECT uc.*, COALESCE(pt.paid_total, 0) AS paid_total
     FROM utility_charges uc
     LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
     WHERE uc.tenant_id = :tenantId AND uc.lease_id = :leaseId AND uc.utility_type = :utilityType
       AND uc.deleted_at IS NULL AND uc.status <> 'payee'
     ORDER BY uc.billed_at ASC, uc.id ASC`,
    { tenantId, leaseId, utilityType },
  );
  let remaining = maxAmount;
  let settled = 0;
  for (const charge of charges) {
    if (remaining <= 0) break;
    const owed = Number(charge.amount) - Number(charge.paid_total);
    if (owed <= 0) continue;
    const toPay = Math.min(owed, remaining);
    await recordUtilityPayment(conn, {
      tenantId,
      charge,
      amount: toPay,
      paymentMethod: 'especes', // convention : la source réelle est la caution, pas un mode de paiement classique — voir la note ci-dessous
      paidAt,
      notes: `Réglé via la caution ${UTILITY_TYPE_LABELS[utilityType]} à la sortie du locataire.`,
      recordedBy: createdBy,
    });
    remaining -= toPay;
    settled += toPay;
  }
  return settled;
}

/**
 * Vérifie qu'un mode de règlement est fourni pour toute caution supplémentaire encore détenue dont
 * une part sera réellement rendue — AVANT toute écriture. Exportée séparément pour être appelée à la
 * fois tôt par la route (sur `pool`, avant tout fichier écrit sur disque — signatures) ET, comme
 * filet de sécurité, par `finalizeAdditionalDeposits` ci-dessous juste avant d'écrire.
 * Renvoie `{ rows, peintureOverflow }` (les lignes tenues + le dépassement de la retenue peinture,
 * réutilisés par `finalizeAdditionalDeposits` pour ne jamais recalculer deux fois).
 */
async function checkAdditionalDepositRefunds(conn, { tenantId, leaseId, peintureDeductionAmount = 0, refundMethods = {} }) {
  const [rows] = await conn.query(
    "SELECT * FROM lease_deposits WHERE tenant_id = :tenantId AND lease_id = :leaseId AND status = 'held'",
    { tenantId, leaseId },
  );
  if (rows.length === 0) return { rows: [], peintureOverflow: 0 };

  for (const row of rows) {
    if (row.type === 'peinture') continue; // le montant rendu (donc si un mode est requis) dépend du calcul ci-dessous
    if (row.type === 'sbee' || row.type === 'soneb') {
      const unpaid = await getUnpaidUtilityBalance(conn, tenantId, leaseId, row.type);
      const returned = Math.max(0, Number(row.amount) - Math.min(unpaid, Number(row.amount)));
      if (returned > 0 && !refundMethods[row.type]) {
        throw new ApiError(400, `Indiquez comment la caution ${ADDITIONAL_DEPOSIT_LABELS[row.type]} sera restituée.`);
      }
    }
  }
  const peintureRow = rows.find((r) => r.type === 'peinture');
  let peintureOverflow = 0;
  if (peintureRow) {
    const deduction = Math.min(Number(peintureDeductionAmount), Number(peintureRow.amount));
    peintureOverflow = Math.max(0, Number(peintureDeductionAmount) - Number(peintureRow.amount));
    const returned = Number(peintureRow.amount) - deduction;
    if (returned > 0 && !refundMethods.peinture) {
      throw new ApiError(400, 'Indiquez comment la caution peinture sera restituée.');
    }
  }
  return { rows, peintureOverflow };
}

/**
 * Décompte de sortie des cautions supplémentaires — appelé DANS la même transaction que la
 * finalisation de l'état des lieux (`routes/leases.js`). Pour chaque caution encore détenue sur ce
 * bail : SBEE/SONEB règlent le solde impayé réel (plafonné à la caution) ; peinture applique la
 * retenue saisie par l'agent (plafonnée à la caution, l'éventuel dépassement étant renvoyé à
 * l'appelant pour qu'il l'ajoute à la caution de LOYER — décision explicite de l'utilisateur).
 *
 * `refundMethods` : `{ sbee?, soneb?, peinture? }`, requis pour tout type dont il reste un montant à
 * rendre (> 0) — vérifié avant toute écriture (`checkAdditionalDepositRefunds`), jamais après coup.
 *
 * Renvoie `{ deposits: [...], peintureOverflow }`.
 */
async function finalizeAdditionalDeposits(conn, { tenantId, leaseId, moveOutDate, peintureDeductionAmount = 0, peintureDeductionNote = null, refundMethods = {}, renterName, createdBy }) {
  const { rows, peintureOverflow } = await checkAdditionalDepositRefunds(conn, { tenantId, leaseId, peintureDeductionAmount, refundMethods });
  if (rows.length === 0) return { deposits: [], peintureOverflow: 0 };

  const results = [];
  for (const row of rows) {
    let deduction = 0;
    let deductionNote = null;
    if (row.type === 'sbee' || row.type === 'soneb') {
      const unpaid = await getUnpaidUtilityBalance(conn, tenantId, leaseId, row.type);
      const toDeduct = Math.min(unpaid, Number(row.amount));
      deduction = await settleUnpaidUtilityCharges(conn, { tenantId, leaseId, utilityType: row.type, maxAmount: toDeduct, paidAt: moveOutDate, createdBy });
    } else if (row.type === 'peinture') {
      deduction = Math.min(Number(peintureDeductionAmount), Number(row.amount));
      deductionNote = peintureDeductionNote;
    }
    const returned = Number(row.amount) - deduction;
    const method = returned > 0 ? refundMethods[row.type] : null;

    await conn.query(
      `UPDATE lease_deposits
       SET status = 'returned', returned_at = :moveOutDate, returned_amount = :returned, returned_method = :method,
           deduction_amount = :deduction, deduction_note = :deductionNote
       WHERE id = :id`,
      { moveOutDate, returned, method, deduction, deductionNote, id: row.id },
    );

    if (returned > 0 && (await isModuleActive(conn, tenantId))) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'caution_supplementaire_restituee',
        entryDate: moveOutDate,
        amount: returned,
        paymentMethod: method,
        narrationVars: { type: ADDITIONAL_DEPOSIT_LABELS[row.type], locataire: renterName },
        // Label SYNTHÉTIQUE distinct de 'lease_deposits' ci-dessus (même principe que 'lease_entry_fees'/
        // 'lease_entry_prorata' ailleurs — jamais une vraie table) : `backfillOne` dédoublonne par
        // (source_table, source_id) SEUL, sans regarder `operation_type` — la réception et la
        // restitution de la MÊME ligne partageraient le même `source_id` (l'id de la ligne) sans ce
        // second label, et la seconde écriture serait ignorée à tort comme "déjà faite".
        sourceTable: 'lease_deposits_return',
        sourceId: row.id,
        createdBy,
        context: { leaseId },
      });
    }

    results.push({ type: row.type, amount: Number(row.amount), deduction, returned, method });
  }

  return { deposits: results, peintureOverflow };
}

module.exports = {
  listLeaseDeposits,
  recordAdditionalDeposits,
  getUnpaidUtilityBalance,
  settleUnpaidUtilityCharges,
  checkAdditionalDepositRefunds,
  finalizeAdditionalDeposits,
  toPublic,
};
