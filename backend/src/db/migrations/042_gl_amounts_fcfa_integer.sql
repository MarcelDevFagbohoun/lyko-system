-- Correction : le FCFA n'a pas de subdivision (pas de centimes), tout le
-- reste du projet stocke les montants en DECIMAL(12,0) (rent_payments,
-- expenses, owner_payouts...). Les colonnes du module comptable avaient été
-- créées en DECIMAL(14,2) par erreur d'harmonisation — corrigé avant toute
-- donnée réelle (aucune ligne n'existe encore dans ces tables).
ALTER TABLE gl_entry_lines
  MODIFY COLUMN amount DECIMAL(14, 0) NOT NULL;

ALTER TABLE gl_posting_rule_lines
  MODIFY COLUMN fixed_amount DECIMAL(14, 0) NULL;

ALTER TABLE gl_bank_reconciliations
  MODIFY COLUMN statement_balance DECIMAL(14, 0) NOT NULL,
  MODIFY COLUMN book_balance DECIMAL(14, 0) NOT NULL;

ALTER TABLE gl_bank_reconciliation_lines
  MODIFY COLUMN bank_amount DECIMAL(14, 0) NOT NULL;

ALTER TABLE tenants
  MODIFY COLUMN gl_expense_alert_threshold DECIMAL(14, 0) NULL;
