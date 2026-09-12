'use strict';

/** Catégorie d'une dépense de fonctionnement du cabinet (section 8). */
const EXPENSE_CATEGORIES = [
  { key: 'loyer_bureau', label: 'Loyer du bureau' },
  { key: 'salaires', label: 'Salaires & charges sociales' },
  { key: 'fournitures', label: 'Fournitures & équipement' },
  { key: 'entretien', label: 'Entretien & réparations' },
  { key: 'transport', label: 'Transport & déplacements' },
  { key: 'communication', label: 'Communication (téléphone, internet)' },
  { key: 'marketing', label: 'Marketing & publicité' },
  { key: 'taxes', label: 'Taxes & redevances' },
  { key: 'autre', label: 'Autre' },
];
const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key);

const EXPENSE_PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

module.exports = { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, EXPENSE_PAYMENT_METHODS };
