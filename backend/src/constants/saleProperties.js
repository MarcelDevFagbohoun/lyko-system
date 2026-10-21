'use strict';

/**
 * « Biens à vendre » (demande utilisateur, 2026-10-18) — catalogue séparé des Biens locatifs
 * (`constants/properties.js`), qui n'a pas de notion de terrain (un terrain n'a jamais d'unité/loyer).
 */
const SALE_PROPERTY_TYPES = [
  { key: 'villa', label: 'Villa' },
  { key: 'duplex', label: 'Duplex' },
  { key: 'immeuble', label: 'Immeuble' },
  { key: 'maison_simple', label: 'Maison simple' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'autre', label: 'Autre' },
];
const SALE_PROPERTY_TYPE_KEYS = SALE_PROPERTY_TYPES.map((t) => t.key);

/** Suivi régulier (demande utilisateur) — le statut est la trace de ce suivi, pas une simple étiquette. */
const SALE_PROPERTY_STATUSES = [
  { key: 'en_vente', label: 'En vente' },
  { key: 'en_negociation', label: 'En négociation' },
  { key: 'vendu', label: 'Vendu' },
  { key: 'retire', label: 'Retiré' },
];
const SALE_PROPERTY_STATUS_KEYS = SALE_PROPERTY_STATUSES.map((s) => s.key);

module.exports = {
  SALE_PROPERTY_TYPES,
  SALE_PROPERTY_TYPE_KEYS,
  SALE_PROPERTY_STATUSES,
  SALE_PROPERTY_STATUS_KEYS,
};
