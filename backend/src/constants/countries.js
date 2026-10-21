'use strict';

/**
 * Pays proposés au sélecteur de l'inscription (demande utilisateur, 2026-10-18) — Bénin + pays
 * limitrophes/UEMOA (zone CFA, activité réelle de l'entreprise), pas une liste mondiale.
 * Détermine le format de téléphone attendu (voir `validators/auth.js`, `libphonenumber-js`).
 * `callingCode` est affiché à titre indicatif (préfixe international) ; la validation réelle du
 * numéro passe entièrement par `libphonenumber-js`, jamais par une regex maison par pays.
 */
const REGISTRATION_COUNTRIES = [
  { code: 'BJ', label: 'Bénin', callingCode: '229' },
  { code: 'TG', label: 'Togo', callingCode: '228' },
  { code: 'NE', label: 'Niger', callingCode: '227' },
  { code: 'BF', label: 'Burkina Faso', callingCode: '226' },
  { code: 'CI', label: "Côte d'Ivoire", callingCode: '225' },
  { code: 'ML', label: 'Mali', callingCode: '223' },
  { code: 'SN', label: 'Sénégal', callingCode: '221' },
  { code: 'GW', label: 'Guinée-Bissau', callingCode: '245' },
];

const REGISTRATION_COUNTRY_CODES = REGISTRATION_COUNTRIES.map((c) => c.code);

module.exports = { REGISTRATION_COUNTRIES, REGISTRATION_COUNTRY_CODES };
