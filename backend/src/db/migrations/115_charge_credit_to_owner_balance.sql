-- Les charges SONEB/SBEE encaissées ne sont plus reversées directement au propriétaire : elles sont ajoutées à son solde
-- (transfert interne, kind = 'balance'), puis versées avec le reste depuis le menu Paiements.
-- Les anciens reversements réellement payés (espèces, virement…) gardent kind = 'cash' et ne touchent pas le solde.
ALTER TABLE owner_charge_remittances
  ADD COLUMN kind ENUM('cash','balance') NOT NULL DEFAULT 'cash' AFTER payment_method;
