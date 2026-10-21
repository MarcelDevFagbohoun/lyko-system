-- SaaS (étape 2) : achats d'abonnement via le compte FedaPay de la plateforme.
CREATE TABLE subscription_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  reference CHAR(32) NOT NULL,
  plan_key ENUM('demarrage','pro','entreprise') NOT NULL,
  months TINYINT UNSIGNED NOT NULL,
  amount INT UNSIGNED NOT NULL,
  founder_price TINYINT(1) NOT NULL DEFAULT 0,
  is_first_purchase TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  fedapay_transaction_id VARCHAR(64) NULL,
  invoice_number VARCHAR(30) NULL,
  period_start DATETIME NULL,
  period_end DATETIME NULL,
  paid_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_payments_reference (reference),
  UNIQUE KEY uq_subscription_payments_invoice (invoice_number),
  UNIQUE KEY uq_subscription_payments_tx (fedapay_transaction_id),
  KEY idx_subscription_payments_tenant (tenant_id, created_at),
  CONSTRAINT fk_subscription_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rappels d'expiration déjà envoyés (un par échéance et par seuil), pour ne jamais écrire deux fois.
ALTER TABLE tenant_subscriptions
  ADD COLUMN reminder_sent_for DATETIME NULL AFTER refund_eligible_until,
  ADD COLUMN reminder_days TINYINT UNSIGNED NULL AFTER reminder_sent_for;
