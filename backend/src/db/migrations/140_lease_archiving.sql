-- Archivage manuel du locataire sortant (demande utilisateur, 2026-11-03 : « une fois le paiement
-- effectué on doit avoir un bouton archivé... sans ça le locataire ne peut pas aller dans l'archive »).
--
-- Jusqu'ici, la validation d'un PV de sortie faisait passer `leases.status` à 'ended' IMMÉDIATEMENT
-- (voir services/moveOutReport.js `finalizeMoveOut`), et c'est CE statut qui décide seul si le
-- locataire apparaît dans l'onglet « Archives » (services/renters.js `listRenters`) — avant même que
-- le remboursement de caution/complément (`payout_status`) soit réglé. On NE TOUCHE PAS à `status`
-- (il garde son effet métier immédiat : libération de l'unité, fin de bail) — on ajoute un flag
-- D'AFFICHAGE séparé, posé par un geste humain explicite (DG ou comptable, jamais automatique), même
-- principe que `owners.mandate_ended_at` (migration 092). Tant qu'il n'est pas posé, le locataire
-- n'apparaît ni en « Actifs » ni en « Archives » sur la fiche Locataires — il reste visible dans la
-- nouvelle boîte « État des lieux » (voir services/inspection.js `listInProgressInspections`) jusqu'à
-- ce que quelqu'un clique sur « Archivé ».
ALTER TABLE leases
  ADD COLUMN archived_at DATETIME NULL AFTER status,
  ADD COLUMN archived_by INT UNSIGNED NULL AFTER archived_at,
  ADD CONSTRAINT fk_leases_archived_by FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL;

-- Baux déjà terminés avant cette migration : considérés archivés d'office (aucune régression sur
-- l'existant — sans quoi tous les locataires déjà sortis disparaîtraient de l'archive au déploiement).
UPDATE leases SET archived_at = COALESCE(end_date, NOW()) WHERE status = 'ended';
