'use strict';

const { ROLE_LABELS } = require('../constants/roles');

/**
 * Construit l'attribution « qui a fait quoi » (nom + rôle) à partir de
 * colonnes jointes sur `users` (ex. `u.first_name AS foo_first_name`).
 * Retourne null si la jointure n'a rien donné (ex. FK nullable non
 * renseignée sur d'anciens enregistrements antérieurs à ce suivi).
 *
 * `roleLabels` : libellés personnalisés de l'entreprise (voir
 * `constants/roles.js` `resolveRoleLabels`) — à défaut, les libellés par
 * défaut (utile pour les rares appelants sans contexte tenant).
 */
function toActor(firstName, lastName, role, roleLabels = ROLE_LABELS) {
  if (!firstName) return null;
  return { name: `${firstName} ${lastName}`, role, roleLabel: roleLabels[role] ?? role };
}

module.exports = { toActor };
