-- Étape 9 : module Charges & redevances (SONEB/SBEE).
--
-- Périmètre validé avec l'utilisateur : un registre des factures SONEB/eau
-- et SBEE/électricité à la charge du locataire — relevés (index début/fin,
-- informatifs) ou montant direct de facture, statut payée/impayée — sur le
-- même principe que le registre des paiements de loyer (rent_payments), mais
-- pour les fluides. Pas de calcul automatique de tarif par tranche (aucun
-- barème SONEB/SBEE fiable à coder en dur) : le montant est toujours saisi
-- directement par la personne qui enregistre la facture.
CREATE TABLE utility_charges (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  utility_type ENUM('soneb','sbee') NOT NULL,
  period_label VARCHAR(50) NOT NULL,
  reading_start INT UNSIGNED NULL,
  reading_end INT UNSIGNED NULL,
  amount DECIMAL(12,0) NOT NULL,
  billed_at DATE NOT NULL,
  status ENUM('impayee','payee') NOT NULL DEFAULT 'impayee',
  paid_at DATE NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NULL,
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  paid_recorded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_utility_charges_tenant (tenant_id),
  KEY idx_utility_charges_lease (lease_id),
  CONSTRAINT fk_utility_charges_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_utility_charges_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_utility_charges_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_utility_charges_paid_recorded_by FOREIGN KEY (paid_recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
