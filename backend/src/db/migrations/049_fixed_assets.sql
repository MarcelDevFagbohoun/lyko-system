-- Immobilisations du cabinet (matériel propre — jamais les biens gérés pour
-- le compte des propriétaires, qui n'appartiennent pas au cabinet). Dernier
-- des 6 points de complétude identifiés : aujourd'hui, aucune trace des
-- ordinateurs/mobilier/véhicule éventuels de l'agence, ni de leur perte de
-- valeur dans le temps (amortissement), pourtant exigée par SYSCOHADA dès
-- qu'une entreprise détient de tels biens.
CREATE TABLE fixed_assets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  label VARCHAR(150) NOT NULL,
  category ENUM('informatique', 'mobilier', 'transport') NOT NULL,
  acquisition_date DATE NOT NULL,
  acquisition_cost DECIMAL(12, 0) NOT NULL,
  useful_life_years TINYINT UNSIGNED NOT NULL COMMENT 'Durée d''amortissement linéaire, en années',
  -- Même schéma "à crédit" que les dépenses (migration 048) : un achat
  -- d'immobilisation peut aussi être réglé plus tard.
  payment_status ENUM('paid', 'unpaid') NOT NULL DEFAULT 'paid',
  payment_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL,
  supplier_id INT UNSIGNED NULL,
  paid_at DATE NULL,
  status ENUM('active', 'disposed') NOT NULL DEFAULT 'active',
  disposed_at DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fixed_assets_tenant (tenant_id, status),
  CONSTRAINT fk_fixed_assets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixed_assets_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_fixed_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_fixed_assets_cost CHECK (acquisition_cost > 0),
  CONSTRAINT chk_fixed_assets_life CHECK (useful_life_years > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une ligne par MOIS comptabilisé pour une immobilisation donnée — jamais
-- un calcul recalculé à la volée : chaque mois d'amortissement est un acte
-- SAISI (un clic), pas un automatisme, avec sa propre écriture comptable
-- traçable (`gl_entries.source_table` = 'fixed_asset_depreciations').
CREATE TABLE fixed_asset_depreciations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  fixed_asset_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL COMMENT 'AAAA-MM',
  amount DECIMAL(12, 0) NOT NULL,
  recorded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fixed_asset_depreciations (fixed_asset_id, period),
  CONSTRAINT fk_fixed_asset_depreciations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixed_asset_depreciations_asset FOREIGN KEY (fixed_asset_id) REFERENCES fixed_assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_fixed_asset_depreciations_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_fixed_asset_depreciations_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
