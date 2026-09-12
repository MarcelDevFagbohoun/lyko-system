'use strict';

/** Postes standards d'un état des lieux d'entrée (checklist). */
const INSPECTION_ITEMS = [
  'Murs et peinture',
  'Sol / carrelage',
  'Plafond',
  'Plomberie',
  'Installation électrique',
  'Portes et fenêtres',
  'Cuisine',
  'Sanitaires',
  'Serrures et clés',
];

const INSPECTION_CONDITIONS = ['bon', 'moyen', 'mauvais'];

module.exports = { INSPECTION_ITEMS, INSPECTION_CONDITIONS };
