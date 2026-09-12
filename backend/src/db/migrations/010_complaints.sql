-- Étape 7 : module Plaintes & réclamations.
--
-- Une plainte est rattachée à un bail (donc à un locataire + une unité + un
-- bien, tous dérivables sans duplication) — cohérent avec le reste du modèle
-- (paiements, états des lieux). Périmètre volontairement réduit par rapport
-- à la maquette Stitch (annuaire d'artisans, devis contradictoires,
-- imputabilité juridique bailleur/locataire, déduction automatique sur le
-- relevé propriétaire, déclaration d'assurance) : juste le suivi du dossier
-- (catégorie, priorité, statut, photos, note de résolution).
CREATE TABLE complaints (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  category ENUM('plomberie','electricite','serrurerie','climatisation','maconnerie','autre') NOT NULL DEFAULT 'autre',
  title VARCHAR(150) NOT NULL,
  description TEXT NULL,
  priority ENUM('normale','urgente') NOT NULL DEFAULT 'normale',
  status ENUM('ouverte','en_cours','resolue','fermee') NOT NULL DEFAULT 'ouverte',
  photo_paths JSON NULL,
  resolution_note TEXT NULL,
  resolved_at DATE NULL,
  reported_at DATE NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_complaints_code (tenant_id, code),
  KEY idx_complaints_tenant (tenant_id),
  KEY idx_complaints_lease (lease_id),
  CONSTRAINT fk_complaints_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_complaints_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_complaints_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
