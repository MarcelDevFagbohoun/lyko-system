-- Retrait complet de KKiaPay (remplacé par FedaPay). Les anciens paiements « kkiapay » (Mobile Money / carte) deviennent
-- « mobile_money » ; l'identifiant de transaction en ligne perd son nom historique ; les clés KKiaPay des entreprises sont supprimées.
ALTER TABLE rent_payments MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay','caution') NOT NULL;
UPDATE rent_payments SET payment_method = 'mobile_money' WHERE payment_method = 'kkiapay';
ALTER TABLE rent_payments
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','caution') NOT NULL,
  CHANGE COLUMN kkiapay_transaction_id online_transaction_id VARCHAR(64) NULL,
  RENAME INDEX uk_rent_payments_kkiapay_tx TO uk_rent_payments_online_tx;

ALTER TABLE utility_payments MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NOT NULL DEFAULT 'especes';
UPDATE utility_payments SET payment_method = 'mobile_money' WHERE payment_method = 'kkiapay';
ALTER TABLE utility_payments
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'especes',
  CHANGE COLUMN kkiapay_transaction_id online_transaction_id VARCHAR(64) NULL,
  RENAME INDEX uk_utility_payments_kkiapay_tx TO uk_utility_payments_online_tx;

ALTER TABLE utility_charges MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NULL;
UPDATE utility_charges SET payment_method = 'mobile_money' WHERE payment_method = 'kkiapay';
ALTER TABLE utility_charges MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque') NULL;

ALTER TABLE gl_entry_lines MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NULL;
UPDATE gl_entry_lines SET payment_method = 'mobile_money' WHERE payment_method = 'kkiapay';
ALTER TABLE gl_entry_lines MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque') NULL
  COMMENT 'Renseigné uniquement sur les lignes de trésorerie (classe 5) — mêmes valeurs que rent_payments.payment_method';

ALTER TABLE payment_links CHANGE COLUMN kkiapay_transaction_id online_transaction_id VARCHAR(64) NULL;

ALTER TABLE tenants
  DROP COLUMN kkiapay_enabled,
  DROP COLUMN kkiapay_sandbox,
  DROP COLUMN kkiapay_public_key,
  DROP COLUMN kkiapay_private_key_enc,
  DROP COLUMN kkiapay_secret_key_enc;
