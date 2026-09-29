-- Suivi de règlement des pénalités de retard (étape 44bis, demande directe de l'utilisateur : « revenons
-- sur les pénalités »). Jusqu'ici (047_late_fees.sql), une pénalité appliquée n'avait aucun suivi de
-- règlement (ni statut, ni date de paiement) — visible seulement comme une créance permanente en compte
-- 411, jamais soldée. Même principe que `lease_opening_debt_payments` (055) : une pénalité peut être
-- réglée en une fois ou en plusieurs fois, le solde restant se calcule toujours en sommant les paiements
-- réels, jamais stocké.
CREATE TABLE late_fee_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  late_fee_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  payment_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NOT NULL,
  paid_at DATE NOT NULL,
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_late_fee_payments_late_fee (late_fee_id),
  KEY idx_late_fee_payments_tenant (tenant_id, paid_at),
  CONSTRAINT fk_lfp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lfp_late_fee FOREIGN KEY (late_fee_id) REFERENCES late_fees(id) ON DELETE CASCADE,
  CONSTRAINT fk_lfp_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_lfp_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
