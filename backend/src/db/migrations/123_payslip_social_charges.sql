-- Détail social des fiches de paie (option « Paie » des réglages comptables) : montants figés au
-- moment du paiement, jamais recalculés. Tous à 0 tant que le niveau de paie reste « net seul ».
ALTER TABLE payslips
  ADD COLUMN cnss_employee_amount DECIMAL(14,0) NOT NULL DEFAULT 0 AFTER net_amount,
  ADD COLUMN cnss_employer_amount DECIMAL(14,0) NOT NULL DEFAULT 0 AFTER cnss_employee_amount,
  ADD COLUMN its_amount DECIMAL(14,0) NOT NULL DEFAULT 0 AFTER cnss_employer_amount;
