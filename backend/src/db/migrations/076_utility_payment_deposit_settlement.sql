ALTER TABLE utility_payments
  ADD COLUMN settled_from_deposit BOOLEAN NOT NULL DEFAULT 0 AFTER payment_method;
