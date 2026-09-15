'use strict';

/**
 * Modèle standard d'un état des lieux (étape 13, idée n°9 : refonte par
 * zones). Chaque zone/élément a un `key` stable (jamais dérivé du label à
 * l'exécution, pour ne pas dépendre d'un slug sensible aux accents) — utilisé
 * pour retrouver un élément dans l'arbre JSON stocké, et pour faire
 * correspondre les postes entre la fiche d'entrée et celle de sortie lors de
 * la comparaison automatique.
 */
const INSPECTION_ZONES = [
  {
    key: 'devanture',
    label: 'Devanture',
    items: [
      { key: 'porte_entree', label: "Porte d'entrée" },
      { key: 'auvent', label: 'Auvent' },
      { key: 'terrasse', label: 'Terrasse' },
      { key: 'portail', label: 'Portail' },
      { key: 'cloture', label: 'Clôture' },
      { key: 'eclairage_exterieur', label: 'Éclairage extérieur' },
      { key: 'boite_lettres', label: 'Boîte aux lettres' },
      { key: 'sonnette_interphone', label: 'Sonnette/interphone' },
    ],
  },
  {
    key: 'chambre',
    label: 'Chambre',
    items: [
      { key: 'lampe', label: 'Lampe' },
      { key: 'brasseur_ventilateur', label: 'Brasseur/ventilateur' },
      { key: 'climatiseur', label: 'Climatiseur' },
      { key: 'prise_electrique', label: 'Prise électrique' },
      { key: 'interrupteur', label: 'Interrupteur' },
      { key: 'poste_televiseur', label: 'Poste téléviseur' },
      { key: 'sol_carrelage', label: 'Sol/carrelage' },
      { key: 'plafond', label: 'Plafond' },
      { key: 'murs_peinture', label: 'Murs/peinture' },
      { key: 'fenetre', label: 'Fenêtre' },
      { key: 'moustiquaire', label: 'Moustiquaire' },
      { key: 'porte', label: 'Porte' },
    ],
  },
  {
    key: 'salon',
    label: 'Salon',
    items: [
      { key: 'lampe', label: 'Lampe' },
      { key: 'brasseur_ventilateur', label: 'Brasseur/ventilateur' },
      { key: 'prises_electriques', label: 'Prises électriques' },
      { key: 'sol_carrelage', label: 'Sol/carrelage' },
      { key: 'plafond', label: 'Plafond' },
      { key: 'murs_peinture', label: 'Murs/peinture' },
      { key: 'fenetre', label: 'Fenêtre' },
    ],
  },
  {
    key: 'cuisine',
    label: 'Cuisine',
    items: [
      { key: 'evier', label: 'Évier' },
      { key: 'robinetterie', label: 'Robinetterie' },
      { key: 'sol_carrelage', label: 'Sol/carrelage' },
      { key: 'plafond', label: 'Plafond' },
      { key: 'prises_electriques', label: 'Prises électriques' },
      { key: 'placards', label: 'Placards' },
      { key: 'carrelage_mural', label: 'Carrelage mural' },
      { key: 'hotte', label: 'Hotte' },
    ],
  },
  {
    key: 'douche_sdb',
    label: 'Douche/Salle de bain',
    items: [
      { key: 'lavabo', label: 'Lavabo' },
      { key: 'colonne_douche', label: 'Colonne de douche' },
      { key: 'wc_toilette', label: 'WC/toilette' },
      { key: 'robinetterie', label: 'Robinetterie' },
      { key: 'sol_carrelage', label: 'Sol/carrelage' },
      { key: 'carrelage_mural', label: 'Carrelage mural' },
      { key: 'miroir', label: 'Miroir' },
      { key: 'porte_serviette', label: 'Porte-serviette' },
    ],
  },
];

// Échelle ORDONNÉE (décision produit, confirmée avec l'utilisateur) : BE est
// le meilleur état, ME le pire, SR (Sous Réserve) un état intermédiaire —
// utilisée pour détecter une dégradation entre l'entrée et la sortie
// (`services/inspection.js`, `compareInspectionReports`). Rang plus élevé = meilleur état.
const INSPECTION_CONDITIONS = ['BE', 'ME', 'SR'];
const INSPECTION_CONDITION_RANK = { BE: 2, SR: 1, ME: 0 };

// Ancien système (avant la refonte par zones) : conservé uniquement pour
// normaliser à l'affichage les fiches déjà enregistrées avec cette forme —
// jamais utilisé pour une nouvelle fiche. « moyen » est le plus proche
// conceptuellement de « Sous Réserve » (état imparfait mais pas franchement
// mauvais) parmi BE/ME/SR ; ce mappage est purement cosmétique, en lecture.
const LEGACY_CONDITION_TO_NEW = { bon: 'BE', moyen: 'SR', mauvais: 'ME' };

module.exports = {
  INSPECTION_ZONES,
  INSPECTION_CONDITIONS,
  INSPECTION_CONDITION_RANK,
  LEGACY_CONDITION_TO_NEW,
};
