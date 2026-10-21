-- Encaissement en ligne des loyers et charges via FedaPay (21/10/2026) : remplace KKiaPay côté interface.
-- Le locataire est redirigé vers la page de paiement hébergée FedaPay ; AUCUNE clé n'est exposée au navigateur.
-- Une « intention » est créée côté serveur AVANT la redirection : c'est elle (et non le navigateur) qui dit à
-- quel bail / quelle facture / quel lien un paiement appartient, et pour quel montant.

ALTER TABLE tenants
  ADD COLUMN fedapay_collect_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN fedapay_webhook_secret_enc TEXT NULL;

CREATE TABLE online_payment_intents (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  reference CHAR(32) NOT NULL,
  kind ENUM('rent','charge') NOT NULL,
  lease_id INT UNSIGNED NULL,
  charge_id INT UNSIGNED NULL,
  link_id INT UNSIGNED NULL,
  amount DECIMAL(12,0) NOT NULL,
  fedapay_transaction_id VARCHAR(64) NULL,
  status ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
  failure_reason VARCHAR(190) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opi_reference (reference),
  UNIQUE KEY uq_opi_transaction (fedapay_transaction_id),
  KEY idx_opi_tenant (tenant_id, created_at),
  CONSTRAINT fk_opi_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
