-- Offre « essai gratuit » (1 mois, toutes les fonctionnalités) : nouvelle clé de plan_key, accordée
-- automatiquement à l'inscription quand elle est la seule offre active (voir planCatalog.js / entitlements.js).
-- Coupure automatique à l'échéance : même mécanique que les offres payantes (current_period_end).
ALTER TABLE tenant_subscriptions
  MODIFY plan_key ENUM('demarrage','pro','entreprise','interne','partenaire','essai-gratuit') NULL;
