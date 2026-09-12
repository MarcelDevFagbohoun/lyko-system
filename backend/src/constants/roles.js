'use strict';

/** Libellés des rôles, utilisés partout où une action doit être attribuée
 * (« qui a fait quoi »). Le rôle `dg` est affiché « Admin » côté interface. */
const ROLE_LABELS = {
  dg: 'Admin',
  comptable: 'Comptable',
  agent: 'Agent',
};

module.exports = { ROLE_LABELS };
