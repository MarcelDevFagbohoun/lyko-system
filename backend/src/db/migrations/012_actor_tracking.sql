-- Traçabilité « qui a fait quoi » : chaque opération doit pouvoir être
-- attribuée à son auteur (DG, comptable ou agent). Les paiements, versements,
-- dépenses, plaintes (déclaration) et états des lieux le faisaient déjà côté
-- base (recorded_by/conducted_by/created_by) mais sans exposer le RÔLE ; les
-- créations de Bien/Unité/Propriétaire/Locataire/Bail n'étaient pas du tout
-- tracées. Colonnes nullables : les enregistrements déjà existants n'ont pas
-- d'auteur connu (antérieurs à ce suivi) plutôt que d'inventer une valeur.
ALTER TABLE properties
  ADD COLUMN created_by INT UNSIGNED NULL AFTER owner_id,
  ADD CONSTRAINT fk_properties_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE property_units
  ADD COLUMN created_by INT UNSIGNED NULL AFTER property_id,
  ADD CONSTRAINT fk_units_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE owners
  ADD COLUMN created_by INT UNSIGNED NULL AFTER tenant_id,
  ADD CONSTRAINT fk_owners_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE renters
  ADD COLUMN created_by INT UNSIGNED NULL AFTER tenant_id,
  ADD CONSTRAINT fk_renters_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE leases
  ADD COLUMN created_by INT UNSIGNED NULL AFTER renter_id,
  ADD CONSTRAINT fk_leases_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;

-- Plaintes : la déclaration (created_by) existait déjà, mais pas qui a
-- résolu le dossier — une opération distincte, parfois par une autre
-- personne que celle qui a déclaré ou pris en charge.
ALTER TABLE complaints
  ADD COLUMN resolved_by INT UNSIGNED NULL AFTER resolved_at,
  ADD CONSTRAINT fk_complaints_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE RESTRICT;
