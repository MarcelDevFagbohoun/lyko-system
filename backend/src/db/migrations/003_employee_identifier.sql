-- Étape 3 (ajustement) : connexion employé par identifiant unique généré
-- automatiquement, distincte de la connexion Admin (DG) par numéro de
-- téléphone. Le champ reste NULL pour le DG (qui continue à se connecter
-- avec son numéro).

ALTER TABLE users
  ADD COLUMN identifier VARCHAR(20) NULL AFTER phone,
  ADD UNIQUE KEY uq_users_identifier (identifier);
