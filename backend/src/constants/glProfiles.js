'use strict';

/**
 * Profils comptables : préréglages des options. Le DG qui n'a pas de notions
 * de comptabilité choisit un profil ; le comptable peut ensuite ajuster chaque
 * option (le profil passe alors à "personnalise").
 *
 * - simple   : comportement historique (rien ne change).
 * - standard : TVA sur commissions, clôture complète, charges sur compte
 *              propriétaire, cessions avec prix de vente.
 * - complet  : standard + paie CNSS/ITS.
 */
const PROFILE_OPTIONS = {
  simple: {
    vatEnabled: false, closingMode: 'simple', utilityAccountMode: 'clients',
    payrollLevel: 'net', irfBase: 'versement', assetSaleProceeds: false,
  },
  standard: {
    vatEnabled: true, closingMode: 'complet', utilityAccountMode: 'proprietaire',
    payrollLevel: 'net', irfBase: 'versement', assetSaleProceeds: true,
  },
  complet: {
    vatEnabled: true, closingMode: 'complet', utilityAccountMode: 'proprietaire',
    payrollLevel: 'complet', irfBase: 'versement', assetSaleProceeds: true,
  },
};

const PROFILE_KEYS = ['simple', 'standard', 'complet', 'personnalise'];

/** Détermine le profil correspondant exactement aux options, sinon "personnalise". */
function detectProfile(opts) {
  for (const [name, preset] of Object.entries(PROFILE_OPTIONS)) {
    if (Object.keys(preset).every((k) => preset[k] === opts[k])) return name;
  }
  return 'personnalise';
}

module.exports = { PROFILE_OPTIONS, PROFILE_KEYS, detectProfile };
