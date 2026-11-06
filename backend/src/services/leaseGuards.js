'use strict';

const { ApiError } = require('../middleware/error');

/**
 * Archivage du locataire sortant (migration 140) : demande utilisateur, 2026-11-06 — « qu'on ne puisse
 * effectuer aucune opération ou action sur son dossier après l'archive ». Tout reste CONSULTABLE
 * (paiements, plaintes, factures, relances, pénalités, contrat, PV de sortie...) — rien n'est masqué
 * ni supprimé — mais plus aucune écriture n'est acceptée une fois `leases.archived_at` posé. Pour
 * corriger quelque chose après coup, il faut d'abord rouvrir la sortie (`services/moveOutReport.js`
 * `reopenMoveOut`), qui lève automatiquement l'archivage.
 *
 * Volontairement une fonction à part (plutôt que posée dans chaque `loadLease`/`loadActiveLease`
 * existant) : ces chargeurs servent À LA FOIS des lectures (qui doivent rester possibles) et des
 * écritures (qui doivent être bloquées) — seuls les points d'entrée d'ÉCRITURE appellent ce garde,
 * explicitement, juste après avoir chargé le bail (ou l'entité qui s'y rattache).
 */
function assertLeaseNotArchived(lease) {
  if (lease?.archived_at) {
    throw new ApiError(409, "Ce locataire est archivé : son dossier est en lecture seule. Réouvrez sa sortie pour pouvoir le modifier.");
  }
}

module.exports = { assertLeaseNotArchived };
