-- « Biens à vendre » (demande utilisateur, 2026-10-18) : catalogue INTERNE (jamais publié
-- publiquement pour l'instant — décision explicite) des biens (maisons, terrains…) que le cabinet
-- est chargé de vendre. Concept entièrement SÉPARÉ des Biens locatifs (`properties`/`property_units` —
-- unités, loyer, baux) : un terrain à vendre n'a ni unité ni loyer. Visible uniquement par les
-- employés à qui le DG a accordé la permission `biens_a_vendre` (voir constants/permissions.js).
--
-- `owner_id` NULLABLE (décision explicite de l'utilisateur) : un bien à vendre peut ne pas avoir de
-- fiche Propriétaire liée (bien propre au cabinet, ou propriétaire pas encore saisi).
-- `photo_paths` JSON (comme `marketplace_listings`) plutôt qu'une table séparée — jusqu'à 6 photos,
-- gérées une par une (ajout/retrait), jamais remplacées en bloc à chaque modification (un bien à
-- vendre est un dossier VIVANT, mis à jour régulièrement — remplacer systématiquement toutes les
-- photos à chaque modification risquerait de les effacer par erreur sur une simple mise à jour de prix).
-- Suppression LOGIQUE avec justification obligatoire (même principe que dépenses/charges/loyers) :
-- une fiche créée par erreur reste corrigeable sans jamais effacer la trace.
CREATE TABLE sale_properties (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NULL,
  type ENUM('villa','duplex','immeuble','maison_simple','terrain','autre') NOT NULL,
  title VARCHAR(150) NOT NULL,
  address VARCHAR(255) NULL,
  price DECIMAL(14,0) NOT NULL,
  surface_m2 DECIMAL(10,2) NULL,
  description TEXT NULL,
  status ENUM('en_vente','en_negociation','vendu','retire') NOT NULL DEFAULT 'en_vente',
  photo_paths JSON NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME NULL,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  deleted_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_sale_properties_tenant (tenant_id, deleted_at),
  KEY idx_sale_properties_owner (owner_id),
  CONSTRAINT fk_sale_properties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_properties_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL,
  CONSTRAINT fk_sale_properties_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_properties_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_sale_properties_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
