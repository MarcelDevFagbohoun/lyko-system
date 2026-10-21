'use strict';

/** Catégorie d'une « autre entrée » d'argent du cabinet (hors loyers, frais d'agence, commissions de vente). */
const INCOME_CATEGORIES = [
  { key: 'prestation', label: 'Honoraires / prestation de service' },
  { key: 'commission', label: 'Commission (apport d\'affaires, assurance…)' },
  { key: 'interets', label: 'Intérêts & produits financiers' },
  { key: 'remboursement', label: 'Remboursement reçu' },
  { key: 'subvention_don', label: 'Subvention / don' },
  { key: 'autre', label: 'Autre entrée' },
];
const INCOME_CATEGORY_KEYS = INCOME_CATEGORIES.map((c) => c.key);

module.exports = { INCOME_CATEGORIES, INCOME_CATEGORY_KEYS };
