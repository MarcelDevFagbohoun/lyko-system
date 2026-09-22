'use strict';

/** Catégorie d'une immobilisation du cabinet (matériel propre à l'agence). */
const FIXED_ASSET_CATEGORIES = [
  { key: 'informatique', label: 'Matériel informatique' },
  { key: 'mobilier', label: 'Mobilier de bureau' },
  { key: 'transport', label: 'Matériel de transport' },
];
const FIXED_ASSET_CATEGORY_KEYS = FIXED_ASSET_CATEGORIES.map((c) => c.key);

module.exports = { FIXED_ASSET_CATEGORIES, FIXED_ASSET_CATEGORY_KEYS };
