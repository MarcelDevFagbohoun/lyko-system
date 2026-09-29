-- Cautions supplémentaires (étape 43, demande directe de l'utilisateur, 2026-09-28) : en plus de la
-- caution de loyer déjà existante (`leases.deposit_amount`, INCHANGÉE par cette migration), une
-- entreprise peut proposer jusqu'à 3 cautions optionnelles, chacune activable indépendamment :
--   - SBEE (garantie contre les impayés d'électricité du locataire)
--   - SONEB (garantie contre les impayés d'eau)
--   - Peinture (garantie contre les frais de remise en peinture à la sortie)
-- DÉCISIONS EXPLICITES DE L'UTILISATEUR : (1) SBEE/SONEB sont des garanties contre les impayés de
-- charges, jamais un remboursement de frais d'installation de compteur ; (2) un dépassement de la
-- retenue peinture au-delà de cette caution retombe sur la caution de loyer ; (3) toutes les cautions
-- passent par le MÊME compte comptable (165, déjà utilisé pour la caution de loyer) — le type de
-- caution se lit dans le libellé de chaque écriture, pas dans un sous-compte séparé ; (4) toujours une
-- saisie manuelle du montant à la création du bail, jamais un montant suggéré.
ALTER TABLE tenants
  ADD COLUMN deposit_sbee_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN deposit_soneb_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN deposit_peinture_enabled TINYINT(1) NOT NULL DEFAULT 0;

-- Une ligne par caution supplémentaire RÉELLEMENT prise sur un bail (jamais une ligne pour un type non
-- demandé à ce locataire précis). Cycle de vie propre à chacune, indépendant des autres et de la
-- caution de loyer : reçue, puis restituée (en tout ou partie) à la sortie.
CREATE TABLE lease_deposits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  type ENUM('sbee', 'soneb', 'peinture') NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  status ENUM('held', 'returned') NOT NULL DEFAULT 'held',
  received_at DATE NULL,
  received_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL,
  returned_at DATE NULL,
  returned_amount DECIMAL(12,0) NULL,
  returned_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL,
  -- Ce qui a été retenu sur CETTE caution précise (peinture : saisie manuelle plafonnée à `amount` ;
  -- SBEE/SONEB : solde impayé du locataire sur ses charges, plafonné à `amount`).
  deduction_amount DECIMAL(12,0) NOT NULL DEFAULT 0,
  deduction_note VARCHAR(255) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Une seule caution de chaque type par bail (jamais deux lignes "peinture" sur le même bail).
  UNIQUE KEY uq_lease_deposits_lease_type (lease_id, type),
  KEY idx_lease_deposits_tenant (tenant_id),
  CONSTRAINT fk_lease_deposits_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_deposits_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_deposits_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retenue peinture au décompte de sortie — même principe que `other_deductions_amount`/`_note` déjà
-- existants sur cette table, mais imputée à la caution peinture (si elle existe sur ce bail) plutôt
-- qu'à la caution de loyer ; le dépassement, lui, rejoint `total_deductions` (caution de loyer).
ALTER TABLE move_out_reports
  ADD COLUMN peinture_deduction_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER other_deductions_note,
  ADD COLUMN peinture_deduction_note VARCHAR(255) NULL AFTER peinture_deduction_amount;
