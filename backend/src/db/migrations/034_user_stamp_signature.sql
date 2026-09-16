-- Demande directe de l'utilisateur : sur une quittance, le cachet/la
-- signature apposés doivent être ceux de l'employé qui a réellement
-- encaissé le paiement (comptable ou agent — `rent_payments.recorded_by`),
-- pas seulement ceux de l'entreprise (tenants.stamp_path/signature_path,
-- gérés par le DG dans Réglages). Chaque employé peut désormais téléverser
-- les siens ; à défaut, le document retombe sur ceux de l'entreprise.
ALTER TABLE users
  ADD COLUMN stamp_path VARCHAR(255) NULL AFTER email,
  ADD COLUMN signature_path VARCHAR(255) NULL AFTER stamp_path;
