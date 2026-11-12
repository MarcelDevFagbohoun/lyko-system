-- Détail des impayés déclarés à l'entrée d'un locataire déjà en place (demande utilisateur,
-- 2026-11-12) : « donner au niveau des impayés des options comme impayés loyer, impayé factures
-- SBEE, impayé SONEB, impayé frais des poubelles et autres » avec sélection des mois concernés.
--
-- Purement ADDITIF : `leases.opening_debt_amount` et `lease_opening_debt_payments` (migration 055)
-- restent la source de vérité pour tout ce qui existait déjà (comptabilité, commissions, suivi des
-- retards, étape 36 étant alimentée en SOMME des postes ci-dessous au moment de la création du bail —
-- aucun de ces consommateurs n'a besoin de changer). Ces deux tables ne font qu'ajouter le détail par
-- type + mois, et son propre règlement poste par poste : chaque paiement d'un poste crée AUSSI,
-- automatiquement, la ligne `lease_opening_debt_payments` correspondante (voir
-- `payOpeningDebtItem`, services/leasePayments.js) — jamais les deux de façon indépendante, pour que
-- la somme des postes reste toujours égale au solde que lit déjà tout le reste de l'application.
CREATE TABLE lease_opening_debt_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  debt_type ENUM('loyer', 'sbee', 'soneb', 'poubelle', 'autre') NOT NULL,
  -- AAAA-MM — même convention que `rent_payments.covers_month`. Demandé même pour `autre`.
  period_month CHAR(7) NOT NULL,
  -- Libellé libre, surtout utile pour `autre` (ex. « Frais de réparation »).
  label VARCHAR(150) NULL,
  amount DECIMAL(12,0) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lodi_lease (lease_id),
  KEY idx_lodi_tenant (tenant_id),
  CONSTRAINT fk_lodi_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodi_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodi_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_lodi_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Règlement d'UN poste précis. `lease_payment_id` pointe vers la ligne `lease_opening_debt_payments`
-- créée dans le même mouvement (toujours exactement une pour une) — c'est elle qui porte le montant,
-- le mode de paiement, la date et l'écriture comptable ; cette table n'ajoute que le lien vers le poste.
CREATE TABLE lease_opening_debt_item_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  lease_payment_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lodip_item (item_id),
  KEY idx_lodip_tenant (tenant_id),
  UNIQUE KEY uq_lodip_lease_payment (lease_payment_id),
  CONSTRAINT fk_lodip_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodip_item FOREIGN KEY (item_id) REFERENCES lease_opening_debt_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_lodip_lease_payment FOREIGN KEY (lease_payment_id) REFERENCES lease_opening_debt_payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lodip_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_lodip_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
