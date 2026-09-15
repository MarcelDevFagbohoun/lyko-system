'use strict';

const { INSPECTION_ZONES, LEGACY_CONDITION_TO_NEW, INSPECTION_CONDITION_RANK } = require('../constants/inspection');
const { toActor } = require('../utils/actor');

/** Élément vide (nouvelle zone/nouvel élément, ou remise à zéro pour la sortie). */
function emptyItem(key, label, custom = false) {
  return { key, label, custom, condition: null, comment: null, photoUrl: null, deduction: 0 };
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
 */
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
          photoUrl: null,
          deduction: Number(it.deduction || 0),
        })),
      },
    ];
  }
  return rawItems?.zones ?? [];
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
    finalizedAt: isoDateTime(row.finalized_at),
    tenantSignatureUrl: row.tenant_signature_path ? `/uploads/${row.tenant_signature_path}` : null,
    agentSignatureUrl: row.agent_signature_path ? `/uploads/${row.agent_signature_path}` : null,
    conductedBy: toActor(row.conductor_first_name, row.conductor_last_name, row.conductor_role),
    finalizedBy: toActor(row.finalizer_first_name, row.finalizer_last_name, row.finalizer_role),
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
    depositAmount: Number(row.deposit_amount),
    totalDeductions: Number(row.total_deductions),
    netRefund: Number(row.net_refund),
  };
}

module.exports = {
  INSPECTION_CONDITION_RANK,
  cloneMasterZones,
  cloneZonesFrom,
  normalizeStoredItems,
  findItem,
  getMissingConditionLabels,
  sumDeductions,
  toPublicInspectionReport,
  toPublicMoveOutReport,
  isoDate,
};
