-- Étape 13 (idée n°1) : portail propriétaire, même mécanique que le portail
-- locataire (022_renter_portal.sql) — lien secret, pas de compte employé.
ALTER TABLE owners
  ADD COLUMN portal_token_hash CHAR(64) NULL AFTER notes,
  ADD UNIQUE KEY uq_owners_portal_token (portal_token_hash);
