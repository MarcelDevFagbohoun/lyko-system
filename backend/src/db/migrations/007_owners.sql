-- Étape 5 : module Gestion des propriétaires.
--
-- Le propriétaire devient une entité à part entière (fiche, historique des
-- versements) au lieu d'un simple texte libre porté par le Bien — périmètre
-- volontairement réduit par rapport à la maquette (pas de mandat de gérance,
-- pas de RIB, pas de taux de commission : juste la fiche et les versements
-- saisis manuellement).

CREATE TABLE owners (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(190) NULL,
  address VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_owners_tenant (tenant_id),
  CONSTRAINT fk_owners_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reprise des propriétaires déjà saisis en texte libre sur les Biens : un
-- propriétaire par couple (entreprise, nom, téléphone) distinct, pour ne pas
-- dupliquer la même personne si elle est citée à l'identique sur plusieurs
-- biens (comparaison de téléphone NULL-safe via <=>).
INSERT INTO owners (tenant_id, name, phone)
SELECT DISTINCT tenant_id, owner_name, owner_phone FROM properties;

ALTER TABLE properties ADD COLUMN owner_id INT UNSIGNED NULL AFTER code;

UPDATE properties p
JOIN owners o
  ON o.tenant_id = p.tenant_id
  AND o.name = p.owner_name
  AND o.phone <=> p.owner_phone
SET p.owner_id = o.id;

ALTER TABLE properties
  MODIFY COLUMN owner_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_properties_owner FOREIGN KEY (owner_id) REFERENCES owners(id),
  DROP COLUMN owner_name,
  DROP COLUMN owner_phone;

-- Versements du cabinet au propriétaire (loyers nets reversés) : saisie
-- manuelle par le comptable/DG, avec relevé PDF généré à la demande à partir
-- de cet historique (pas de table séparée pour le PDF, comme les attestations).
CREATE TABLE owner_payouts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  period_label VARCHAR(50) NOT NULL,
  paid_at DATE NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'virement',
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payouts_tenant (tenant_id),
  KEY idx_payouts_owner (owner_id),
  CONSTRAINT fk_payouts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_payouts_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  CONSTRAINT fk_payouts_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
