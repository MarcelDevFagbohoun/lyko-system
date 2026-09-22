-- Fournisseurs à crédit — jusqu'ici, TOUTE dépense était considérée réglée
-- immédiatement (espèces/mobile money/virement/chèque au moment de la
-- saisie). Aucune place pour « on doit 50 000 FCFA à l'électricien, à payer
-- le mois prochain » — une agence qui grandit a presque toujours ce besoin
-- (comptes fournisseurs). `suppliers` reste volontairement minimal (pas un
-- module CRM fournisseurs complet) : juste assez pour un tiers identifiable
-- et un compte auxiliaire 401 par fournisseur.
CREATE TABLE suppliers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_name (tenant_id, name),
  CONSTRAINT fk_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_suppliers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `payment_method` devient NULL tant que la dépense n'est pas réglée (une
-- dépense "à crédit" n'a pas encore de mode de règlement). `payment_status`
-- démarre à 'paid' par défaut : AUCUN comportement existant ne change pour
-- une dépense déjà enregistrée ou pour une saisie qui ne coche jamais "à
-- crédit". `paid_at` distinct de `expense_date` : la dépense peut être
-- engagée un jour et réglée un autre (le cas "à crédit" par définition).
ALTER TABLE expenses
  MODIFY COLUMN payment_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL,
  ADD COLUMN supplier_id INT UNSIGNED NULL AFTER unit_id,
  ADD COLUMN payment_status ENUM('paid', 'unpaid') NOT NULL DEFAULT 'paid' AFTER payment_method,
  ADD COLUMN paid_at DATE NULL AFTER payment_status,
  ADD CONSTRAINT fk_expenses_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;

-- Rétroactif : toute dépense EXISTANTE était de fait payée à sa date de
-- saisie (comportement historique, avant l'existence même de "à crédit").
UPDATE expenses SET paid_at = expense_date WHERE payment_status = 'paid';
