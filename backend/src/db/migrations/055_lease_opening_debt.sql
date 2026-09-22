-- Dette existante à l'entrée d'un locataire (onboarding d'une entreprise
-- avec des locataires déjà en place, certains déjà en retard AVANT d'utiliser
-- Lyko System) — décision explicite de l'utilisateur après discussion : un
-- champ sur le bail (montant déclaré une fois, immuable) plutôt qu'un
-- système de mouvements générique, réglé au fil du temps via ses propres
-- paiements (table dédiée, même principe que `rent_payments`/`late_fees` —
-- jamais un compteur dénormalisé : le solde restant se calcule toujours en
-- sommant les paiements réels, jamais stocké).
ALTER TABLE leases
  ADD COLUMN opening_debt_amount DECIMAL(12,0) NOT NULL DEFAULT 0
    COMMENT 'Dette déjà due par le locataire à la création du bail (solde historique importé), 0 si aucune'
    AFTER deposit_status;

CREATE TABLE lease_opening_debt_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  payment_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NOT NULL,
  paid_at DATE NOT NULL,
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lease_opening_debt_payments_lease (lease_id),
  KEY idx_lease_opening_debt_payments_tenant (tenant_id, paid_at),
  CONSTRAINT fk_lodp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodp_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodp_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_lodp_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Solde figé à chaque clôture de mois (audit) — un mois clôturé ne doit
-- jamais changer d'avis sur ce qui était dû à cette date-là, même si la
-- logique de calcul de `computeArrears` évolue plus tard. INSERT-only,
-- jamais modifiée après coup ; une ligne par bail actif par mois clôturé.
CREATE TABLE lease_balance_snapshots (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL COMMENT 'AAAA-MM, mois clôturé',
  lease_id INT UNSIGNED NOT NULL,
  amount_due DECIMAL(12,0) NOT NULL COMMENT 'Loyers en retard + solde de dette initiale restant, au moment de la clôture',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lease_balance_snapshots (tenant_id, period, lease_id),
  KEY idx_lease_balance_snapshots_lease (lease_id),
  CONSTRAINT fk_lbs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lbs_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
