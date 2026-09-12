-- Étape 9bis — Relevé de compteurs par immeuble (SONEB / SBEE).
--
-- Constat terrain (tableur du cabinet) : chaque immeuble a UN compteur
-- principal (l'abonnement de la régie) et des décompteurs par unité. Chaque
-- mois : relever tous les décompteurs, appliquer un tarif unique (ex. 225
-- FCFA/unité), relever le compteur principal + saisir le montant de la
-- facture reçue, puis comparer « Total décompteur » vs « Compteur » — la
-- différence (parties communes, fuites, usage bailleur) est AFFICHÉE, jamais
-- refacturée automatiquement (décision explicite de l'utilisateur).
--
-- On réutilise `property_units.soneb_meter_number` / `sbee_meter_number`
-- (déjà présents depuis 006) comme identité du décompteur : une unité
-- participe au relevé d'un fluide dès qu'elle a un n° de compteur pour ce
-- fluide. Le compteur principal tient en quelques colonnes sur `properties`.

-- 1) Configuration du sous-comptage, par bien et par fluide.
ALTER TABLE properties
  ADD COLUMN soneb_submetered TINYINT(1) NOT NULL DEFAULT 0 AFTER photo_paths,
  ADD COLUMN sbee_submetered TINYINT(1) NOT NULL DEFAULT 0 AFTER soneb_submetered,
  ADD COLUMN soneb_unit_price DECIMAL(10,2) NULL AFTER sbee_submetered,
  ADD COLUMN sbee_unit_price DECIMAL(10,2) NULL AFTER soneb_unit_price,
  ADD COLUMN soneb_main_meter_number VARCHAR(50) NULL AFTER sbee_unit_price,
  ADD COLUMN sbee_main_meter_number VARCHAR(50) NULL AFTER soneb_main_meter_number,
  ADD COLUMN soneb_account_number VARCHAR(50) NULL AFTER sbee_main_meter_number,
  ADD COLUMN sbee_account_number VARCHAR(50) NULL AFTER soneb_account_number;

-- 2) Un relevé = (immeuble, fluide, période). Porte le compteur principal et
--    le tarif figé au moment de la création.
CREATE TABLE utility_reading_batches (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  utility_type ENUM('soneb','sbee') NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  main_reading_start INT UNSIGNED NULL,
  main_reading_end INT UNSIGNED NULL,
  main_invoice_amount DECIMAL(12,0) NULL,
  status ENUM('brouillon','valide') NOT NULL DEFAULT 'brouillon',
  validated_at DATETIME NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batch_period (tenant_id, property_id, utility_type, period_start),
  KEY idx_batch_tenant (tenant_id),
  KEY idx_batch_property (property_id),
  CONSTRAINT fk_batch_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Une ligne de relevé par unité (décompteur). `lease_id` et `charge_id`
--    sont figés à la validation (facture générée dans utility_charges).
CREATE TABLE utility_readings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  batch_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NULL,
  reading_start INT UNSIGNED NOT NULL DEFAULT 0,
  reading_end INT UNSIGNED NOT NULL DEFAULT 0,
  amount DECIMAL(12,0) NOT NULL DEFAULT 0,
  charge_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reading_unit (batch_id, unit_id),
  KEY idx_reading_tenant (tenant_id),
  KEY idx_reading_batch (batch_id),
  KEY idx_reading_unit (unit_id),
  CONSTRAINT fk_reading_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_reading_batch FOREIGN KEY (batch_id) REFERENCES utility_reading_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_reading_unit FOREIGN KEY (unit_id) REFERENCES property_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_reading_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE SET NULL,
  CONSTRAINT fk_reading_charge FOREIGN KEY (charge_id) REFERENCES utility_charges(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
