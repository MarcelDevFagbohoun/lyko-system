-- Contact d'un proche (personne à prévenir) à la création d'un locataire — demande utilisateur,
-- 2026-11-05. Facultatif (ni l'un ni l'autre champ n'est obligatoire).
ALTER TABLE renters
  ADD COLUMN emergency_contact_name VARCHAR(150) NULL AFTER notes,
  ADD COLUMN emergency_contact_phone VARCHAR(20) NULL AFTER emergency_contact_name;
