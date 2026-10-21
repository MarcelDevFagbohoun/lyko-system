-- Acceptation des conditions d'utilisation à l'inscription (preuve : date et version du texte acceptées).
ALTER TABLE tenants
  ADD COLUMN terms_accepted_at DATETIME NULL,
  ADD COLUMN terms_version VARCHAR(20) NULL;
