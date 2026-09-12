'use strict';

const { ROLE_LABELS } = require('../constants/roles');

/**
 * Construit l'attribution « qui a fait quoi » (nom + rôle) à partir de
 * colonnes jointes sur `users` (ex. `u.first_name AS foo_first_name`).
 * Retourne null si la jointure n'a rien donné (ex. FK nullable non
 * renseignée sur d'anciens enregistrements antérieurs à ce suivi).
 */
function toActor(firstName, lastName, role) {
  if (!firstName) return null;
  return { name: `${firstName} ${lastName}`, role, roleLabel: ROLE_LABELS[role] ?? role };
}

module.exports = { toActor };
