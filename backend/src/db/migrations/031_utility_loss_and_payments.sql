-- Étape 23 : répartition configurable de l'écart compteur/décompteur, part de
-- pertes sur la facture, et paiements multiples/partiels sur une facture
-- SONEB/SBEE (même principe que rent_payments pour le loyer).
--
-- Comportement par défaut STRICTEMENT inchangé : `loss_allocation` vaut
-- 'proprietaire' partout (décision d'origine, 020) — seul un Bien où le DG
-- active explicitement 'prorata' verra l'écart réparti sur les factures.

-- 1) Réglage par Bien et par fluide : qui absorbe l'écart compteur/décompteur.
ALTER TABLE properties
  ADD COLUMN soneb_loss_allocation ENUM('proprietaire','prorata') NOT NULL DEFAULT 'proprietaire' AFTER soneb_account_number,
  ADD COLUMN sbee_loss_allocation ENUM('proprietaire','prorata') NOT NULL DEFAULT 'proprietaire' AFTER sbee_account_number;

-- 2) Part de l'écart imputée à une facture (0 par défaut = comportement
--    historique) — distincte du montant de consommation mesurée pour un
--    affichage séparé sur la facture. Statut étendu pour un règlement
--    partiel (la valeur 'payee' reste le solde à 0, jamais renommée).
ALTER TABLE utility_charges
  ADD COLUMN loss_share_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER amount,
  MODIFY COLUMN status ENUM('impayee','partiellement_payee','payee') NOT NULL DEFAULT 'impayee';

-- 3) Paiements successifs sur une facture SONEB/SBEE (miroir de
--    rent_payments) : la somme de ces lignes devient la source de vérité du
--    montant réglé, `utility_charges.status` restant un résumé dérivé.
CREATE TABLE utility_payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  charge_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'especes',
  paid_at DATE NOT NULL,
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_utility_payments_tenant (tenant_id),
  KEY idx_utility_payments_charge (charge_id),
  CONSTRAINT fk_utility_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_utility_payments_charge FOREIGN KEY (charge_id) REFERENCES utility_charges(id) ON DELETE CASCADE,
  CONSTRAINT fk_utility_payments_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Rétro-remplissage : chaque facture déjà marquée payée avant cette étape
--    obtient le paiement correspondant dans la nouvelle table, pour que
--    SUM(utility_payments.amount) reste la source de vérité sans réécrire
--    l'historique déjà validé (les colonnes paid_at/payment_method/
--    paid_recorded_by existantes sur utility_charges restent en place,
--    inchangées, simple résumé du dernier paiement désormais).
INSERT INTO utility_payments (tenant_id, charge_id, amount, payment_method, paid_at, recorded_by, created_at)
SELECT tenant_id, id, amount, COALESCE(payment_method, 'especes'), COALESCE(paid_at, billed_at), COALESCE(paid_recorded_by, recorded_by), NOW()
FROM utility_charges
WHERE status = 'payee';
