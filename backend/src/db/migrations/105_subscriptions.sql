-- SaaS (étape 1) : abonnement par entreprise. Les offres (prix, limites, fonctions) vivent dans le code
-- (constants/plans.js) ; cette table ne garde que l'état de l'abonnement de chaque entreprise.
CREATE TABLE tenant_subscriptions (
  tenant_id INT UNSIGNED NOT NULL,
  plan_key ENUM('demarrage','pro','entreprise','interne') NULL,
  status ENUM('pending_payment','active','expired','cancelled','refunded') NOT NULL DEFAULT 'pending_payment',
  period_months TINYINT UNSIGNED NULL,
  started_at DATETIME NULL,
  current_period_end DATETIME NULL,
  first_purchase_at DATETIME NULL,
  refund_eligible_until DATETIME NULL,
  founder_price TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id),
  KEY idx_tenant_subscriptions_status_end (status, current_period_end),
  CONSTRAINT fk_tenant_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trace de tout changement d'abonnement (qui, quoi, quand).
CREATE TABLE subscription_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  actor VARCHAR(80) NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subscription_events_tenant (tenant_id, created_at),
  CONSTRAINT fk_subscription_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rattrapage : toutes les entreprises existantes passent en offre « interne » (accès complet, sans limite ni expiration).
INSERT INTO tenant_subscriptions (tenant_id, plan_key, status)
SELECT t.id, 'interne', 'active' FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id = t.id);

INSERT INTO subscription_events (tenant_id, event_type, actor, details)
SELECT s.tenant_id, 'backfill_interne', 'migration 105', 'Entreprise existante avant le SaaS : offre interne'
FROM tenant_subscriptions s WHERE s.plan_key = 'interne'
  AND NOT EXISTS (SELECT 1 FROM subscription_events e WHERE e.tenant_id = s.tenant_id AND e.event_type = 'backfill_interne');
