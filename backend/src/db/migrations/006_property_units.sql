-- Étape 4 (refonte) : séparation Bien / Unité locative.
--
-- Un Bien (immeuble/villa/maison) porte l'identité du propriétaire (nom +
-- téléphone : simples champs descriptifs pour l'instant, formalisés en
-- entité à part à l'étape 5) et peut contenir plusieurs Unités locatives,
-- chacune avec son propre statut, loyer et compteurs SONEB/SBEE.
--
-- Cette migration CONVERTIT les données déjà saisies (chaque Bien existant
-- devient un Bien + une Unité unique reprenant son loyer/statut) au lieu de
-- les effacer.

-- 1) Nouvelle table des unités locatives.
CREATE TABLE property_units (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  designation ENUM('studio','chambre_salon','chambre_salon_sanitaire_cuisine','appartement_2ch','appartement_3ch','autre') NOT NULL DEFAULT 'autre',
  designation_custom VARCHAR(150) NULL,
  status ENUM('libre','loue','reserve') NOT NULL DEFAULT 'libre',
  monthly_rent DECIMAL(12,0) NOT NULL,
  soneb_meter_number VARCHAR(50) NULL,
  sbee_meter_number VARCHAR(50) NULL,
  furnished TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_code (tenant_id, code),
  KEY idx_units_tenant (tenant_id),
  KEY idx_units_property (property_id),
  CONSTRAINT fk_units_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_units_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Étoffer properties (désormais "Bien" : bâtiment + propriétaire) sans
--    casser les colonnes existantes tout de suite — elles migrent d'abord.
ALTER TABLE properties
  ADD COLUMN code VARCHAR(30) NULL AFTER id,
  ADD COLUMN owner_name VARCHAR(150) NULL AFTER code,
  ADD COLUMN owner_phone VARCHAR(20) NULL AFTER owner_name,
  ADD COLUMN levels TINYINT UNSIGNED NULL AFTER property_type,
  ADD COLUMN photo_paths JSON NULL AFTER levels;

-- 3) Code du Bien (BIEN-001, BIEN-002, ... par entreprise) puis migration de
--    chaque Bien existant vers une Unité unique reprenant loyer/statut/libellé.
UPDATE properties p
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS rn
  FROM properties
) ranked ON ranked.id = p.id
SET p.code = CONCAT('BIEN-', LPAD(ranked.rn, 3, '0'));

INSERT INTO property_units
  (tenant_id, property_id, code, designation, designation_custom, status, monthly_rent)
SELECT
  p.tenant_id, p.id, CONCAT(p.code, '-U01'), 'autre', p.label,
  CASE p.status WHEN 'occupied' THEN 'loue' ELSE 'libre' END,
  p.monthly_rent
FROM properties p;

UPDATE properties SET owner_name = 'Propriétaire à renseigner' WHERE owner_name IS NULL;

-- 4) Répercuter sur les baux : ils référencent désormais l'unité, plus le bien.
ALTER TABLE leases ADD COLUMN unit_id INT UNSIGNED NULL AFTER property_id;

UPDATE leases l
JOIN property_units u ON u.property_id = l.property_id
SET l.unit_id = u.id;

ALTER TABLE leases
  DROP FOREIGN KEY fk_leases_property,
  MODIFY COLUMN unit_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_leases_unit FOREIGN KEY (unit_id) REFERENCES property_units(id) ON DELETE CASCADE,
  DROP COLUMN property_id;

-- 5) Nettoyer properties : label/loyer/statut déménagent au niveau unité ;
--    property_type devient le type de bâtiment (nouvelle liste) ; owner_name
--    et code obligatoires désormais.
UPDATE properties SET property_type = 'autre';

ALTER TABLE properties
  DROP COLUMN label,
  DROP COLUMN monthly_rent,
  DROP COLUMN status,
  MODIFY COLUMN property_type ENUM('villa','duplex','immeuble','maison_simple','autre') NOT NULL DEFAULT 'autre',
  MODIFY COLUMN code VARCHAR(30) NOT NULL,
  MODIFY COLUMN owner_name VARCHAR(150) NOT NULL,
  ADD UNIQUE KEY uq_properties_code (tenant_id, code);
