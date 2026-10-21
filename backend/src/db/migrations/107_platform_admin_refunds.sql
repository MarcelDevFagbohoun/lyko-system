-- SaaS (étape 3) : back-office de la plateforme et remboursements sous garantie.
CREATE TABLE platform_admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_refunds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  payment_id INT UNSIGNED NOT NULL,
  status ENUM('requested','approved','rejected','details_received','processing','paid','failed') NOT NULL DEFAULT 'requested',
  reason TEXT NOT NULL,
  requested_by INT UNSIGNED NULL,
  amount_paid INT UNSIGNED NOT NULL,
  fee_amount INT UNSIGNED NULL,
  refund_amount INT UNSIGNED NULL,
  admin_note VARCHAR(500) NULL,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  token_hash CHAR(64) NULL,
  token_expires_at DATETIME NULL,
  payee_name VARCHAR(120) NULL,
  payee_phone VARCHAR(20) NULL,
  payee_operator ENUM('mtn','moov') NULL,
  payout_id VARCHAR(64) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_refunds_token (token_hash),
  KEY idx_subscription_refunds_status (status, created_at),
  KEY idx_subscription_refunds_payment (payment_id),
  CONSTRAINT fk_subscription_refunds_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_refunds_payment FOREIGN KEY (payment_id) REFERENCES subscription_payments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
