-- Point de sortie complet : lignes libres (main-d'œuvre, pénalités, réparations faites par le locataire),
-- loyers dus bruts (avant plafond de la caution) et solde négatif (ce que le locataire doit encore) avec
-- sa résolution (il règle la différence, ou il effectue les réparations).
ALTER TABLE move_out_reports
  ADD COLUMN extra_lines JSON NULL AFTER other_deductions_note,
  ADD COLUMN rent_owed_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER rent_arrears_amount,
  ADD COLUMN balance_due_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER rent_owed_amount,
  ADD COLUMN balance_resolution ENUM('paid','repairs_by_tenant') NULL AFTER balance_due_amount,
  ADD COLUMN balance_payment_method VARCHAR(20) NULL AFTER balance_resolution,
  ADD COLUMN balance_note VARCHAR(255) NULL AFTER balance_payment_method;
