-- Oubli dans 037_kkiapay.sql : `utility_charges.payment_method` (résumé
-- dénormalisé du dernier règlement, voir `utility_payments`) n'avait pas
-- reçu la valeur `kkiapay` comme `rent_payments`/`utility_payments`.
ALTER TABLE utility_charges
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NULL;
