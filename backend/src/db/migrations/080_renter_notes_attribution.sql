-- Demande explicite de l'utilisateur : une note sur un locataire ("information à noter sur sa
-- situation") doit pouvoir être ajoutée par N'IMPORTE QUEL employé (comptable, agent — pas seulement
-- qui a la permission "locataires"), et rester visible/attribuée pour la direction. Ces deux colonnes
-- tracent qui a écrit la note EN VIGUEUR et quand — même principe que `renters.created_by`/`created_at`,
-- mais pour la note (qui peut être modifiée bien après la création de la fiche, par quelqu'un d'autre).
ALTER TABLE renters
  ADD COLUMN notes_updated_by INT UNSIGNED NULL AFTER notes,
  ADD COLUMN notes_updated_at DATETIME NULL AFTER notes_updated_by,
  ADD CONSTRAINT fk_renters_notes_updated_by FOREIGN KEY (notes_updated_by) REFERENCES users(id) ON DELETE SET NULL;
