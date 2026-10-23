-- Montée en gamme avec crédit au prorata + suivi des paiements échoués.
ALTER TABLE subscription_payments
  ADD COLUMN kind ENUM('purchase','renewal','upgrade') NOT NULL DEFAULT 'purchase' AFTER months,
  ADD COLUMN credit_applied INT UNSIGNED NOT NULL DEFAULT 0 AFTER amount,
  ADD COLUMN credit_days INT UNSIGNED NULL AFTER credit_applied,
  ADD COLUMN upgraded_from_plan ENUM('demarrage','pro','entreprise') NULL AFTER credit_days,
  ADD COLUMN consumed_at DATETIME NULL,
  ADD COLUMN failure_reason VARCHAR(60) NULL,
  ADD COLUMN failure_notified_at DATETIME NULL,
  ADD COLUMN admin_alerted_at DATETIME NULL;

-- Les anciens paiements : un premier achat reste « purchase », les autres « renewal ».
UPDATE subscription_payments SET kind = IF(is_first_purchase = 1, 'purchase', 'renewal');

-- Un paiement encaissé par FedaPay mais non activé (montant différent, par exemple) devient une anomalie à traiter à la main.
ALTER TABLE subscription_payments
  MODIFY COLUMN status ENUM('pending','paid','failed','refunded','anomaly') NOT NULL DEFAULT 'pending';
