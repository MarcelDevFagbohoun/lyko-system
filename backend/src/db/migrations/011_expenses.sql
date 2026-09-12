-- Étape 8 : module Comptabilité & finances (périmètre réduit, validé avec
-- l'utilisateur : journal de dépenses + tableau de bord des flux — pas de
-- rapprochement bancaire, pas de grand livre SYSCOHADA, pas de mandats de
-- gérance chiffrés). Les entrées (loyers, rent_payments) et sorties vers les
-- propriétaires (owner_payouts) existent déjà depuis les étapes 4 et 5 ;
-- ce module ajoute la brique manquante : les dépenses de fonctionnement du
-- cabinet, et un tableau de bord qui consolide les trois flux.
CREATE TABLE expenses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  category ENUM('loyer_bureau','salaires','fournitures','entretien','transport','communication','marketing','taxes','autre') NOT NULL DEFAULT 'autre',
  label VARCHAR(150) NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'especes',
  notes VARCHAR(255) NULL,
  receipt_path VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_tenant (tenant_id),
  KEY idx_expenses_date (expense_date),
  CONSTRAINT fk_expenses_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_expenses_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
