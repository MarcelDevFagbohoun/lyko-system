-- Demande directe de l'utilisateur : « toutes les opérations effectuées sur la
-- plateforme doivent être datées ». Complète, avec une date propre à
-- l'opération, trois écrans où seul l'auteur était visible jusqu'ici (voir
-- aussi le pointage de `Attribution` côté frontend, qui exposait déjà
-- `created_at`/`resolved_at` sans les afficher, corrigé sans migration).
ALTER TABLE properties
  ADD COLUMN agent_assigned_at DATETIME NULL AFTER agent_id,
  ADD COLUMN location_set_at DATETIME NULL AFTER longitude;

ALTER TABLE owners
  ADD COLUMN portal_link_created_at DATETIME NULL AFTER portal_token_hash;

ALTER TABLE renters
  ADD COLUMN portal_link_created_at DATETIME NULL AFTER portal_token_hash;
