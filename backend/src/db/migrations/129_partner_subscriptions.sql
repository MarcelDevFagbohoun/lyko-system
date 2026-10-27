-- Abonnement partenaire : offert par la plateforme pour une durée en mois, avec les fonctions choisies une à une.
-- Ni prix ni paiement : la ligne d'abonnement porte tout (offre « partenaire », échéance, fonctions, limites facultatives).
ALTER TABLE tenant_subscriptions
  MODIFY plan_key ENUM('demarrage','pro','entreprise','interne','partenaire') NULL,
  ADD COLUMN partner_features TEXT NULL AFTER founder_price,
  ADD COLUMN partner_limits TEXT NULL AFTER partner_features,
  ADD COLUMN partner_note VARCHAR(300) NULL AFTER partner_limits,
  ADD COLUMN partner_since DATETIME NULL AFTER partner_note;
