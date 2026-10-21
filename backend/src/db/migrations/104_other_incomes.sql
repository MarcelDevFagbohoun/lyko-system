-- Autres entrées d'argent du cabinet (21/10/2026) : honoraires/prestations hors gérance, intérêts, remboursements,
-- subventions, dons… — tout produit encaissé qui n'est ni un loyer, ni des frais d'agence, ni une commission de vente.
-- 100 % produit du cabinet (jamais reversé à un propriétaire). Suppression logique avec justification, comme `expenses`.
CREATE TABLE other_incomes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  category ENUM('prestation','commission','interets','remboursement','subvention_don','autre') NOT NULL DEFAULT 'autre',
  label VARCHAR(150) NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  income_date DATE NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL,
  payer_name VARCHAR(150) NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(255) NULL,
  receipt_path VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  deleted_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_other_incomes_tenant_date (tenant_id, income_date),
  CONSTRAINT fk_other_incomes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_other_incomes_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comptabilité avancée : compte 7588 + 3 règles (706 / 771 / 7588) pour les entreprises dont le plan est déjà initialisé
-- (les nouvelles les obtiennent via db/seedGeneralLedger.js). Idempotent.
INSERT INTO gl_accounts (tenant_id, code, system_key, label, class, account_type, is_control_account, is_system)
SELECT DISTINCT a.tenant_id, '7588', NULL, 'Autres produits divers de gestion courante', 7, 'produit', 0, 1
FROM gl_accounts a
WHERE NOT EXISTS (SELECT 1 FROM gl_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '7588');

INSERT INTO gl_posting_rules (tenant_id, operation_type, label, journal_id, narration_template, is_validated_by_accountant)
SELECT r.tenant_id, t.op, t.label, r.journal_id, 'Autre entrée — {libelle}', 0
FROM gl_posting_rules r
JOIN (
  SELECT 'produit_service_encaisse' AS op, 'Autre entrée — prestation / commission (706)' AS label
  UNION ALL SELECT 'produit_financier_encaisse', 'Autre entrée — intérêts (771)'
  UNION ALL SELECT 'produit_divers_encaisse', 'Autre entrée — produit divers (7588)'
) t
WHERE r.operation_type = 'loyer_encaisse'
  AND NOT EXISTS (SELECT 1 FROM gl_posting_rules x WHERE x.tenant_id = r.tenant_id AND x.operation_type = t.op);

INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
SELECT n.id, 1, 'debit', NULL, 'tresorerie_mode_paiement', 'montant_total', NULL
FROM gl_posting_rules n
WHERE n.operation_type IN ('produit_service_encaisse','produit_financier_encaisse','produit_divers_encaisse')
  AND NOT EXISTS (SELECT 1 FROM gl_posting_rule_lines l WHERE l.rule_id = n.id);

INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
SELECT n.id, 2, 'credit', a.id, NULL, 'montant_total', NULL
FROM gl_posting_rules n
JOIN gl_accounts a ON a.tenant_id = n.tenant_id
 AND a.code = CASE n.operation_type WHEN 'produit_service_encaisse' THEN '706' WHEN 'produit_financier_encaisse' THEN '771' ELSE '7588' END
WHERE n.operation_type IN ('produit_service_encaisse','produit_financier_encaisse','produit_divers_encaisse')
  AND (SELECT COUNT(*) FROM gl_posting_rule_lines l WHERE l.rule_id = n.id) = 1;
