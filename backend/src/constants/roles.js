'use strict';

/** Libellés PAR DÉFAUT des rôles (tant que l'entreprise n'a rien choisi
 * dans Réglages). Le rôle `dg` est affiché « Admin » côté interface. */
const ROLE_LABELS = {
  dg: 'Admin',
  comptable: 'Comptable',
  agent: 'Agent',
};

/**
 * Propositions offertes dans le menu déroulant de personnalisation
 * (Réglages, DG uniquement) — demande directe de l'utilisateur : chaque
 * entreprise choisit comment s'appellent ses postes chez elle, plutôt que
 * des libellés fixes imposés à tout le monde. Toujours une liste fermée
 * (jamais de champ libre) : validée aussi côté serveur, et c'est ce nom
 * qui apparaît PARTOUT — journal d'activité, documents PDF, badge, et le
 * sélecteur de poste à la connexion employé.
 */
const ROLE_TITLE_PRESETS = {
  dg: ['Admin', 'Directeur Général', 'Gérant', 'Fondateur', 'PDG'],
  comptable: ['Comptable', 'Chargé(e) de comptabilité', 'Responsable financier', 'Gestionnaire comptable'],
  agent: ['Agent', 'Agent commercial', 'Chargé(e) de clientèle', 'Gestionnaire immobilier', 'Commercial'],
};

/**
 * Libellés effectifs pour une entreprise donnée : colonnes `*_title` sur
 * `tenants` (NULL = valeur par défaut). Accepte soit la ligne `tenants`
 * complète, soit juste les 3 colonnes.
 */
function resolveRoleLabels(tenant) {
  return {
    dg: tenant?.dg_title || ROLE_LABELS.dg,
    comptable: tenant?.comptable_title || ROLE_LABELS.comptable,
    agent: tenant?.agent_title || ROLE_LABELS.agent,
  };
}

module.exports = { ROLE_LABELS, ROLE_TITLE_PRESETS, resolveRoleLabels };
