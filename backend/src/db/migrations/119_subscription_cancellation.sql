-- Annulation d'abonnement : même circuit que le remboursement (demande, examen par l'admin AIM, lien par e-mail,
-- coordonnées de réception). `kind` distingue la garantie historique de l'annulation ; le remboursement d'une annulation
-- est calculé au prorata des jours restants au jour de la demande.
ALTER TABLE subscription_refunds
  ADD COLUMN kind ENUM('guarantee','cancellation') NOT NULL DEFAULT 'guarantee' AFTER status,
  ADD COLUMN days_remaining INT UNSIGNED NULL AFTER amount_paid,
  ADD COLUMN amount_original INT UNSIGNED NULL AFTER days_remaining,
  ADD COLUMN payee_first_name VARCHAR(80) NULL AFTER payee_name,
  ADD COLUMN payee_account_type ENUM('mtn','moov','celtiis','banque','autre') NULL AFTER payee_operator,
  ADD COLUMN payee_account_number VARCHAR(60) NULL AFTER payee_account_type,
  ADD COLUMN payee_account_label VARCHAR(120) NULL AFTER payee_account_number,
  ADD COLUMN payee_other_detail VARCHAR(120) NULL AFTER payee_account_label,
  ADD COLUMN paid_manually TINYINT(1) NOT NULL DEFAULT 0 AFTER paid_at,
  ADD COLUMN paid_reference VARCHAR(120) NULL AFTER paid_manually;
