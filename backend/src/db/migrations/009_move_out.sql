-- Étape 6 : module Sorties de locataires.
--
-- Formalise le départ d'un locataire (jusqu'ici possible uniquement via
-- « libérer l'unité », sans état des lieux ni décompte de caution) : un état
-- des lieux de sortie chiffre les retenues, calcule le net à restituer, puis
-- termine le bail et libère l'unité en une seule opération. Montants figés
-- au moment de la sortie (comme les quittances) : la caution ou les
-- déductions ne doivent pas bouger rétroactivement si le bail est modifié
-- plus tard.
CREATE TABLE move_out_reports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  conducted_at DATE NOT NULL,
  items JSON NOT NULL,
  general_notes TEXT NULL,
  other_deductions_amount DECIMAL(12,0) NOT NULL DEFAULT 0,
  other_deductions_note VARCHAR(255) NULL,
  deposit_amount DECIMAL(12,0) NOT NULL,
  total_deductions DECIMAL(12,0) NOT NULL,
  net_refund DECIMAL(12,0) NOT NULL,
  conducted_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_move_out_lease (lease_id),
  KEY idx_move_out_tenant (tenant_id),
  CONSTRAINT fk_move_out_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_move_out_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_move_out_conducted_by FOREIGN KEY (conducted_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
