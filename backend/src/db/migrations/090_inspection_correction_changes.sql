-- Traçabilité des corrections d'état des lieux (demande utilisateur,
-- 2026-10-17) : au-delà de « corrigée le ... par ... » déjà affiché, le
-- document final doit aussi dire CE QUI a changé, pour la crédibilité du
-- document vis-à-vis du locataire/propriétaire.
-- `pre_reopen_snapshot` capture le contenu (zones/notes/réserves) au moment
-- de la réouverture — un seul emplacement, réécrit à chaque nouvelle
-- réouverture, même principe que `reopened_at`/`reopen_reason` (pas un
-- historique multi-révisions). `correction_changes` est calculé à la
-- refinalisation (comparaison snapshot vs contenu final) puis affiché ; le
-- snapshot est effacé une fois le diff calculé (plus utile).
ALTER TABLE move_in_reports
  ADD COLUMN pre_reopen_snapshot JSON NULL AFTER reopen_reason,
  ADD COLUMN correction_changes JSON NULL AFTER pre_reopen_snapshot;

ALTER TABLE move_out_reports
  ADD COLUMN pre_reopen_snapshot JSON NULL AFTER reopen_reason,
  ADD COLUMN correction_changes JSON NULL AFTER pre_reopen_snapshot;
