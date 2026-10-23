-- Reversement d'une caution détenue par le cabinet au propriétaire (à sa demande, ou pour tout motif justifié),
-- et récupération éventuelle auprès de lui. La caution reste DUE au locataire : le cabinet la garde en créance
-- sur le propriétaire (compte 4673 en comptabilité avancée) jusqu'à sa récupération.
--   to_owner   : le cabinet remet de l'argent au propriétaire (sortie de trésorerie)
--   from_owner : le propriétaire rend une partie de cette caution (entrée de trésorerie)
-- Table distincte de `owner_payouts` : ce n'est PAS une recette du propriétaire, elle ne touche ni son solde
-- séquestre ni la commission.
CREATE TABLE owner_deposit_transfers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  deposit_type ENUM('loyer','sbee','soneb','peinture') NOT NULL,
  direction ENUM('to_owner','from_owner') NOT NULL DEFAULT 'to_owner',
  amount DECIMAL(12,0) NOT NULL,
  paid_at DATE NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'virement',
  motive VARCHAR(255) NOT NULL,
  requested_by_owner TINYINT(1) NOT NULL DEFAULT 1,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_odt_owner (tenant_id, owner_id, paid_at),
  KEY idx_odt_lease (tenant_id, lease_id, deposit_type),
  CONSTRAINT fk_odt_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_odt_owner FOREIGN KEY (owner_id) REFERENCES owners (id),
  CONSTRAINT fk_odt_lease FOREIGN KEY (lease_id) REFERENCES leases (id),
  CONSTRAINT fk_odt_user FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_odt_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
