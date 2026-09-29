-- Audit état des lieux (étape 48) : réserves du locataire notées par l'agent
-- au moment de la signature, et réouverture d'une fiche déjà finalisée
-- (correction d'une erreur de saisie, DG uniquement, motif obligatoire).
-- Réouvrir invalide les deux signatures existantes (il faut resigner) ; pour
-- la sortie, la réouverture NE touche PAS le bail/l'unité déjà libérés ni
-- les cautions déjà réglées (des faits déjà survenus), seul le contenu de la
-- fiche redevient modifiable — voir routes/leases.js.
ALTER TABLE move_in_reports
  ADD COLUMN tenant_reserves TEXT NULL AFTER general_notes,
  ADD COLUMN reopened_at DATETIME NULL AFTER finalized_by,
  ADD COLUMN reopened_by INT UNSIGNED NULL AFTER reopened_at,
  ADD COLUMN reopen_reason TEXT NULL AFTER reopened_by,
  ADD CONSTRAINT fk_move_in_reports_reopened_by FOREIGN KEY (reopened_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE move_out_reports
  ADD COLUMN tenant_reserves TEXT NULL AFTER general_notes,
  ADD COLUMN reopened_at DATETIME NULL AFTER finalized_by,
  ADD COLUMN reopened_by INT UNSIGNED NULL AFTER reopened_at,
  ADD COLUMN reopen_reason TEXT NULL AFTER reopened_by,
  ADD CONSTRAINT fk_move_out_reports_reopened_by FOREIGN KEY (reopened_by) REFERENCES users(id) ON DELETE SET NULL;
