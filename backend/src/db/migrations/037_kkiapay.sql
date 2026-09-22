-- Paiement en ligne optionnel via KKiaPay (agrégateur béninois Mobile
-- Money/carte) : chaque entreprise choisit d'activer ou non l'encaissement
-- en ligne, avec son PROPRE compte KKiaPay (3 clés propres à chaque
-- entreprise, KKiaPay n'a pas de notion de sous-comptes/paiement fractionné
-- côté Lyko). `kkiapay_enabled = 0` (défaut) : rien ne change, l'entreprise
-- continue d'enregistrer ses paiements manuellement comme aujourd'hui.
--
-- Clé privée/secrète chiffrées (`*_enc`, voir `utils/encryption.js`) — la
-- clé publique seule est sans risque, elle est faite pour être embarquée
-- côté client (widget de paiement).
ALTER TABLE tenants
  ADD COLUMN kkiapay_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER signature_path,
  ADD COLUMN kkiapay_sandbox TINYINT(1) NOT NULL DEFAULT 1 AFTER kkiapay_enabled,
  ADD COLUMN kkiapay_public_key VARCHAR(255) NULL AFTER kkiapay_sandbox,
  ADD COLUMN kkiapay_private_key_enc TEXT NULL AFTER kkiapay_public_key,
  ADD COLUMN kkiapay_secret_key_enc TEXT NULL AFTER kkiapay_private_key_enc;

-- `kkiapay_transaction_id` : clé d'idempotence au niveau base de données —
-- un webhook KKiaPay peut être livré plusieurs fois (retries), la contrainte
-- UNIQUE empêche un double enregistrement même si la garde applicative (delai
-- de 2 minutes, pensée pour un double-clic humain) ne s'applique pas à ce cas.
--
-- `recorded_by` devient NULLABLE : un paiement confirmé par KKiaPay n'a pas
-- d'employé qui l'a saisi — même raisonnement que `complaints.created_by`
-- rendu nullable pour les plaintes déposées depuis le portail locataire
-- (022_renter_portal.sql). Le paiement est « en ligne » si et seulement si
-- `kkiapay_transaction_id IS NOT NULL` ; pas de colonne de plus pour ça.
ALTER TABLE rent_payments
  MODIFY COLUMN recorded_by INT UNSIGNED NULL,
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NOT NULL DEFAULT 'especes',
  ADD COLUMN kkiapay_transaction_id VARCHAR(64) NULL AFTER notes,
  ADD UNIQUE KEY uk_rent_payments_kkiapay_tx (kkiapay_transaction_id);

ALTER TABLE utility_payments
  MODIFY COLUMN recorded_by INT UNSIGNED NULL,
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NOT NULL DEFAULT 'especes',
  ADD COLUMN kkiapay_transaction_id VARCHAR(64) NULL AFTER notes,
  ADD UNIQUE KEY uk_utility_payments_kkiapay_tx (kkiapay_transaction_id);

-- Liens de paiement générés par le personnel (pour un locataire sans
-- portail actif) : même schéma de token que le portail locataire/
-- propriétaire — seule l'empreinte SHA-256 est stockée, le lien en clair
-- n'est révélé qu'une fois à la génération, jamais relu ensuite.
CREATE TABLE payment_links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  kind ENUM('loyer','charge') NOT NULL,
  lease_id INT UNSIGNED NULL,
  charge_id INT UNSIGNED NULL,
  amount DECIMAL(12,0) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status ENUM('pending','paid','expired','cancelled') NOT NULL DEFAULT 'pending',
  kkiapay_transaction_id VARCHAR(64) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_links_token (token_hash),
  KEY idx_payment_links_tenant (tenant_id),
  KEY idx_payment_links_lease (lease_id),
  KEY idx_payment_links_charge (charge_id),
  CONSTRAINT fk_payment_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_links_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_links_charge FOREIGN KEY (charge_id) REFERENCES utility_charges(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_payment_links_kind CHECK (
    (kind = 'loyer' AND lease_id IS NOT NULL AND charge_id IS NULL) OR
    (kind = 'charge' AND charge_id IS NOT NULL AND lease_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
