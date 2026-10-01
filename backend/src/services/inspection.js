'use strict';

const { INSPECTION_ZONES, LEGACY_CONDITION_TO_NEW, INSPECTION_CONDITION_RANK } = require('../constants/inspection');
const { toActor } = require('../utils/actor');
const { pool } = require('../config/db');
const { toProtectedFileUrl } = require('../utils/uploads');

/** Élément vide (nouvelle zone/nouvel élément, ou remise à zéro pour la sortie). */
function emptyItem(key, label, custom = false) {
  return { key, label, custom, condition: null, comment: null, photoUrls: [], deduction: 0 };
}

/** Copie profonde des zones standards (nouvelle fiche d'entrée, ou de sortie sans fiche d'entrée). */
function cloneMasterZones() {
  return INSPECTION_ZONES.map((zone) => ({
    key: zone.key,
    label: zone.label,
    custom: false,
    items: zone.items.map((item) => emptyItem(item.key, item.label)),
  }));
}

/**
 * Copie les zones/éléments d'une fiche source (l'entrée) pour amorcer la
 * fiche de sortie : même structure (donc mêmes `key` de zone/élément, y
 * compris les zones/éléments personnalisés ajoutés à l'entrée) — condition
 * pour que la comparaison automatique puisse faire correspondre les postes
 * un par un. État/commentaire/photo/retenue remis à zéro : l'agent doit
 * réévaluer chaque poste au moment de la sortie, jamais recopier l'entrée.
 */
function cloneZonesFrom(sourceZones) {
  return sourceZones.map((zone) => ({
    key: zone.key,
    label: zone.label,
    custom: !!zone.custom,
    items: zone.items.map((item) => emptyItem(item.key, item.label, !!item.custom)),
  }));
}

function slugifyLegacyLabel(label) {
  return (
    String(label)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'poste'
  );
}

/**
 * Normalise la colonne `items` telle que stockée en base vers la forme
 * `zones[]` utilisée partout côté API/frontend — y compris pour les fiches
 * antérieures à la refonte par zones (forme `[{label,condition,comment,...}]`,
 * conditions `bon/moyen/mauvais`). Ces anciennes fiches ne sont JAMAIS
 * réécrites : uniquement normalisées à l'affichage, dans un unique « zone »
 * synthétique qui les regroupe.
 *
 * `photoUrls` (étape 48, galerie jusqu'à 3 photos) remplace l'ancien champ
 * `photoUrl` (singulier) — une fiche déjà stockée avec l'ancienne forme est
 * remontée en tableau à un seul élément, jamais réécrite en base pour autant
 * (même principe que la compatibilité des anciennes conditions ci-dessus).
 */
function normalizePhotoUrls(item) {
  if (Array.isArray(item.photoUrls)) return item.photoUrls;
  return item.photoUrl ? [item.photoUrl] : [];
}

function normalizeStoredItems(rawItems) {
  if (Array.isArray(rawItems)) {
    return [
      {
        key: 'general',
        label: 'Éléments vérifiés (ancien format)',
        custom: true,
        items: rawItems.map((it) => ({
          key: slugifyLegacyLabel(it.label),
          label: it.label,
          custom: true,
          condition: LEGACY_CONDITION_TO_NEW[it.condition] ?? null,
          comment: it.comment ?? null,
          photoUrls: [],
          deduction: Number(it.deduction || 0),
        })),
      },
    ];
  }
  const zones = rawItems?.zones ?? [];
  return zones.map((zone) => ({
    ...zone,
    items: zone.items.map((item) => ({ ...item, photoUrls: normalizePhotoUrls(item) })),
  }));
}

/** `{zone, item}` du poste ciblé, ou `null` si la zone/l'élément n'existe pas dans cette fiche. */
function findItem(zones, zoneKey, itemKey) {
  const zone = zones.find((z) => z.key === zoneKey);
  if (!zone) return null;
  const item = zone.items.find((it) => it.key === itemKey);
  if (!item) return null;
  return { zone, item };
}

/** Libellés "Zone > Élément" des postes sans état renseigné — vide = fiche prête à finaliser. */
function getMissingConditionLabels(zones) {
  const missing = [];
  for (const zone of zones) {
    for (const item of zone.items) {
      if (!item.condition) missing.push(`${zone.label} > ${item.label}`);
    }
  }
  return missing;
}

function sumDeductions(zones) {
  let total = 0;
  for (const zone of zones) {
    for (const item of zone.items) total += Number(item.deduction || 0);
  }
  return total;
}

/**
 * Montant de retenue d'un élément à partir de ses lignes de facturation
 * (catalogue) si l'agent en a choisi au moins une — prix unitaire × quantité,
 * sommés. Sans ligne de facturation, le montant libre déjà saisi fait foi
 * (compatibilité avec la saisie manuelle historique, avant le catalogue).
 * Ne fait jamais confiance à un `item.deduction` envoyé par le client EN
 * MÊME TEMPS que des lignes : les lignes sont alors la seule source de vérité,
 * pour ne jamais désynchroniser le détail affiché et le total retenu.
 */
function computeItemDeduction(item) {
  if (item.billing && Array.isArray(item.billing.lines) && item.billing.lines.length > 0) {
    return item.billing.lines.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.quantity), 0);
  }
  return Number(item.deduction || 0);
}

/** Applique `computeItemDeduction` à chaque élément, EN PLACE (mute `item.deduction`). */
function recomputeItemDeductions(zones) {
  for (const zone of zones) {
    for (const item of zone.items) {
      item.deduction = computeItemDeduction(item);
    }
  }
}

/**
 * Compare l'état d'un même poste entre l'entrée et la sortie — même échelle
 * ordonnée que la comparaison déjà faite côté frontend
 * (`frontend/lib/inspection-comparison.ts`), dupliquée ici volontairement
 * (pas de paquet partagé entre l'API et le frontend dans ce projet) pour que
 * le PV de sortie (PDF, généré uniquement côté serveur) puisse expliquer
 * pourquoi un poste a été facturé, même sans passer par le frontend.
 */
function compareCondition(moveInCondition, moveOutCondition) {
  if (!moveInCondition || !moveOutCondition) return 'unrated';
  const a = INSPECTION_CONDITION_RANK[moveInCondition];
  const b = INSPECTION_CONDITION_RANK[moveOutCondition];
  if (b < a) return 'degraded';
  if (b > a) return 'improved';
  return 'same';
}

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function isoDateTime(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/**
 * Sérialisation publique commune entrée/sortie. `row` doit porter les
 * colonnes jointes `conductor_*`/`finalizer_*` (voir `toActor`) — sinon
 * `conductedBy`/`finalizedBy` restent `null`.
 */
function toPublicInspectionReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    conductedAt: isoDate(row.conducted_at),
    zones: normalizeStoredItems(row.items),
    generalNotes: row.general_notes,
    // Réserves du locataire (étape 48) — notées par l'agent avant finalisation,
    // jamais un accès en écriture du locataire lui-même (voir docs/AVANCEMENT.md).
    tenantReserves: row.tenant_reserves,
    finalizedAt: isoDateTime(row.finalized_at),
    tenantSignatureUrl: row.tenant_signature_path ? toProtectedFileUrl(row.tenant_signature_path) : null,
    agentSignatureUrl: row.agent_signature_path ? toProtectedFileUrl(row.agent_signature_path) : null,
    conductedBy: toActor(row.conductor_first_name, row.conductor_last_name, row.conductor_role),
    finalizedBy: toActor(row.finalizer_first_name, row.finalizer_last_name, row.finalizer_role),
    // Réouverture (étape 48, correction DG) — historique de la DERNIÈRE
    // réouverture seulement (pas un journal multi-événements, voir
    // `services/activity.js` pour le journal complet du cabinet).
    reopenedAt: isoDateTime(row.reopened_at),
    reopenedBy: toActor(row.reopener_first_name, row.reopener_last_name, row.reopener_role),
    reopenReason: row.reopen_reason,
  };
}

/** `toPublicInspectionReport` + les champs propres à la sortie (caution/retenues). */
function toPublicMoveOutReport(row) {
  const base = toPublicInspectionReport(row);
  if (!base) return null;
  return {
    ...base,
    otherDeductionsAmount: Number(row.other_deductions_amount),
    otherDeductionsNote: row.other_deductions_note,
    // Caution peinture (étape 43) — distincte de la caution de loyer ci-dessus, voir
    // services/leaseDeposits.js. Le dépassement éventuel est déjà inclus dans `totalDeductions`/
    // `netRefund` ci-dessous (calculé par la route au moment de la finalisation).
    peintureDeductionAmount: Number(row.peinture_deduction_amount),
    peintureDeductionNote: row.peinture_deduction_note,
    depositAmount: Number(row.deposit_amount),
    totalDeductions: Number(row.total_deductions),
    netRefund: Number(row.net_refund),
    // Bug corrigé (audit étape 48) : stocké et exigé à la finalisation depuis
    // toujours, mais jamais renvoyé côté API jusqu'ici — ni affiché à l'écran,
    // ni sur le PV. Un PV signé annonçant un remboursement sans jamais dire
    // comment il est réglé.
    refundPaymentMethod: row.refund_payment_method,
    // Régularisation comptable manuelle d'une caution avec retenue (étape 48)
    // — voir routes/tasks.js « Mes tâches » et routes/leases.js POST .../gl-regularized.
    glRegularizedAt: isoDateTime(row.gl_regularized_at),
    glRegularizedBy: toActor(row.regularizer_first_name, row.regularizer_last_name, row.regularizer_role),
  };
}

/**
 * Restitutions de caution avec retenue jamais comptabilisées (étape 48,
 * audit) — voir routes/leases.js POST .../finalize (aucune écriture postée
 * dès qu'il y a une retenue, le sort comptable n'étant pas tranché) et
 * routes/tasks.js/dashboard.js (les deux surfaces qui l'affichent : le
 * comptable dans « Mes tâches », le DG sur son tableau de bord). Reste
 * présent tant que personne ne l'a marqué réglé (`gl_regularized_at`).
 */
async function listPendingDepositRegularizations(tenantId) {
  const [rows] = await pool.query(
    `SELECT mo.lease_id, mo.total_deductions, mo.finalized_at, r.id AS renter_id, r.first_name, r.last_name
     FROM move_out_reports mo
     JOIN leases l ON l.id = mo.lease_id
     JOIN renters r ON r.id = l.renter_id
     WHERE mo.tenant_id = :tenantId AND mo.status = 'finalized'
       AND mo.total_deductions > 0 AND mo.gl_regularized_at IS NULL
     ORDER BY mo.finalized_at ASC
     LIMIT 20`,
    { tenantId },
  );
  return rows.map((r) => ({
    leaseId: r.lease_id,
    renterId: r.renter_id,
    renterName: `${r.first_name} ${r.last_name}`,
    totalDeductions: Number(r.total_deductions),
    finalizedAt: r.finalized_at,
  }));
}

module.exports = {
  INSPECTION_CONDITION_RANK,
  listPendingDepositRegularizations,
  cloneMasterZones,
  cloneZonesFrom,
  normalizeStoredItems,
  findItem,
  getMissingConditionLabels,
  sumDeductions,
  computeItemDeduction,
  recomputeItemDeductions,
  compareCondition,
  toPublicInspectionReport,
  toPublicMoveOutReport,
  isoDate,
};
