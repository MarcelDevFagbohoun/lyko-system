-- Moyens de paiement (21/10/2026) : envoi d'argent (salaires, reversements propriétaires, paiements libres) via
-- FedaPay Payouts, avec traçabilité complète. Activé par entreprise (`fedapay_enabled`, 0 par défaut) : sans
-- activation, rien ne change et les paiements restent enregistrés manuellement comme avant.
--
-- Principe de sécurité central : l'effet métier (versement, fiche de paie, dépense, écriture comptable) n'est
-- appliqué QUE lorsque FedaPay confirme l'envoi (statut relu côté serveur, jamais fourni par le client).

ALTER TABLE tenants
  ADD COLUMN fedapay_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN fedapay_sandbox TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN fedapay_secret_key_enc TEXT NULL,
  ADD COLUMN payments_per_order_limit DECIMAL(12,0) NOT NULL DEFAULT 500000,
  ADD COLUMN payments_daily_limit DECIMAL(12,0) NOT NULL DEFAULT 2000000;

CREATE TABLE payment_orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  reference CHAR(18) NOT NULL,
  purpose ENUM('salaire','reversement_proprietaire','autre') NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'XOF',
  status ENUM('created','processing','sent','failed') NOT NULL DEFAULT 'created',
  beneficiary_type ENUM('employee','owner','other') NOT NULL,
  beneficiary_user_id INT UNSIGNED NULL,
  beneficiary_owner_id INT UNSIGNED NULL,
  beneficiary_name VARCHAR(150) NOT NULL,
  beneficiary_phone VARCHAR(20) NOT NULL,
  beneficiary_email VARCHAR(190) NULL,
  operator ENUM('mtn','moov') NOT NULL,
  label VARCHAR(190) NOT NULL,
  context_json TEXT NULL,
  fedapay_payout_id VARCHAR(64) NULL,
  provider_status VARCHAR(30) NULL,
  failure_reason VARCHAR(255) NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  applied_at DATETIME NULL,
  applied_ref VARCHAR(40) NULL,
  last_checked_at DATETIME NULL,
  check_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_orders_reference (reference),
  UNIQUE KEY uq_payment_orders_idem (tenant_id, idempotency_key),
  UNIQUE KEY uq_payment_orders_fedapay (fedapay_payout_id),
  KEY idx_payment_orders_tenant_created (tenant_id, created_at),
  KEY idx_payment_orders_status (status),
  CONSTRAINT fk_payment_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Journal d'audit en ajout seul, chaîné par hachage (chaque ligne contient le hachage de la précédente du même
-- cabinet) : toute modification ou suppression d'une ligne passée rompt la chaîne et se détecte à la vérification.
CREATE TABLE payment_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(200) NULL,
  details TEXT NULL,
  prev_hash CHAR(64) NOT NULL,
  hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_payment_audit_tenant (tenant_id, id),
  KEY idx_payment_audit_order (order_id),
  CONSTRAINT fk_payment_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trace des e-mails de paiement (adresse masquée : jamais l'adresse complète dans ce journal).
CREATE TABLE payment_notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NULL,
  source_table VARCHAR(40) NULL,
  source_id INT UNSIGNED NULL,
  recipient_role ENUM('beneficiary','payer','dg') NOT NULL,
  recipient_masked VARCHAR(190) NOT NULL,
  status ENUM('sent','failed','skipped') NOT NULL,
  error VARCHAR(190) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_notifications_order (order_id),
  KEY idx_payment_notifications_source (tenant_id, source_table, source_id),
  CONSTRAINT fk_payment_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verrouillage de la re-saisie du mot de passe (5 échecs → 15 minutes), par utilisateur.
CREATE TABLE payment_reauth_state (
  user_id INT UNSIGNED NOT NULL,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
