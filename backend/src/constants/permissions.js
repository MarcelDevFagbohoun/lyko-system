'use strict';

/**
 * Catalogue des permissions assignables par le DG à un employé (section 5).
 * Le DG a toujours accès à tout (contrôlé par le rôle, pas par cette table) ;
 * ce catalogue ne s'applique qu'aux rôles 'comptable' et 'agent'.
 *
 * Les clés correspondent aux modules du cahier des charges — la plupart de
 * ces modules n'existent pas encore (ils arrivent aux étapes 4+) : assigner
 * une permission aujourd'hui prépare simplement les accès de l'employé pour
 * quand le module sera construit.
 */
const PERMISSIONS = [
  { key: 'locataires', label: 'Locataires' },
  { key: 'proprietaires', label: 'Propriétaires' },
  { key: 'etats_des_lieux', label: 'États des lieux & sorties' },
  { key: 'plaintes', label: 'Plaintes & réclamations' },
  { key: 'comptabilite', label: 'Comptabilité & finances' },
  { key: 'charges', label: 'Charges & redevances (SONEB/SBEE)' },
  { key: 'documents_juridiques', label: 'Actes & baux' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Pré-cochées à la création selon le rôle choisi (section 5, exemples donnés) —
// le DG peut les ajuster librement avant de valider.
const DEFAULT_PERMISSIONS_BY_ROLE = {
  agent: ['locataires', 'plaintes', 'etats_des_lieux'],
  comptable: ['comptabilite', 'charges'],
};

module.exports = { PERMISSIONS, PERMISSION_KEYS, DEFAULT_PERMISSIONS_BY_ROLE };
