-- Fiches de paie (demande utilisateur, 2026-10-18) : paiement du salaire d'un employé (comptable,
-- agent ou DG lui-même — décision explicite de l'utilisateur), structuré en salaire de base + primes
-- éventuelles + retenues (ex. avance déjà versée), avec le net à payer calculé et GELÉ (jamais recalculé
-- après coup même si `users.base_salary` change plus tard). Chaque fiche crée une dépense classique
-- (`expenses.category = 'salaires'`, voir routes/accounting.js) pour le montant NET réellement versé —
-- c'est cette dépense qui réduit la recette de l'entreprise (`getCabinetRevenue`/
-- `computeAccountingDashboard`) et qui déclenche l'écriture comptable `salaire_paye` (compte 661) si la
-- comptabilité avancée est active. `expense_id` garde le lien pour l'annulation (étourne la dépense ET
-- son écriture GL, jamais la fiche seule).
--
-- Pas de contrainte UNIQUE sur (tenant_id, user_id, period) : la vérification « déjà payé ce mois »
-- est faite en application (`deleted_at IS NULL`), pour permettre d'annuler puis recréer une fiche
-- erronée sans se heurter à une ligne annulée qui garderait la clé occupée.
CREATE TABLE payslips (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  base_amount DECIMAL(14,0) NOT NULL,
  bonus_amount DECIMAL(14,0) NOT NULL DEFAULT 0,
  bonus_label VARCHAR(255) NULL,
  deduction_amount DECIMAL(14,0) NOT NULL DEFAULT 0,
  deduction_label VARCHAR(255) NULL,
  gross_amount DECIMAL(14,0) NOT NULL,
  net_amount DECIMAL(14,0) NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL,
  paid_at DATE NOT NULL,
  expense_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  deleted_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_payslips_user_period (tenant_id, user_id, period),
  CONSTRAINT fk_payslips_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_payslips_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslips_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_payslips_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslips_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
