-- Menu « Paiements » unique : reversement de charges par FedaPay + n° Mobile Money mémorisé par employé.
ALTER TABLE payment_orders
  MODIFY COLUMN purpose ENUM('salaire','reversement_proprietaire','reversement_charges','autre') NOT NULL;

ALTER TABLE users
  ADD COLUMN momo_phone VARCHAR(20) NULL,
  ADD COLUMN momo_operator ENUM('mtn','moov') NULL;
