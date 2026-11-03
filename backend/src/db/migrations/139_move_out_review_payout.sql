-- Workflow de validation DG + décaissement réel du PV de sortie (demande utilisateur, 2026-11-03).
--
-- 1) Validation : un employé (role <> 'dg') ne finalise plus seul un état des lieux de sortie — il le
--    SOUMET, le DG est notifié, peut modifier (tracé dans `review_history`) puis VALIDER (= finalise,
--    déclenche les effets déjà existants : fin de bail, libération de l'unité, cautions) ou REJETER avec
--    une note (le PV repasse en brouillon, peut être soumis plusieurs fois avant validation). Le DG
--    continue de finaliser directement son propre PV sans soumission (demande explicite de
--    l'utilisateur : seuls les PV saisis par un employé passent par ce circuit).
--    `review_history` est un journal EN AJOUT SEUL (jamais réécrit) : chaque soumission, modification,
--    rejet ou validation y ajoute une entrée {type, at, by:{id,name,role}, note?, changedFields?} — c'est
--    l'historique visible demandé par l'utilisateur.
--
-- 2) Décaissement : jusqu'ici le "mode de règlement" choisi à la finalisation n'était qu'une métadonnée
--    (aucun paiement réel déclenché) SAUF dans le cas simple sans retenue, où une écriture comptable
--    "caution restituée" était postée immédiatement à la finalisation (comportement CONSERVÉ tel quel —
--    non concerné par cette migration). Avec une retenue (dégâts) ou un complément dû par le locataire,
--    rien n'était comptabilisé ("à régulariser manuellement"). `payout_status`/`payout_direction`
--    distinguent maintenant la DÉCISION (prise à la validation) de l'EXÉCUTION réelle (bouton « Payer le
--    locataire »/« Encaisser le complément »), avec qui/quand/comment pour la quittance et la caisse.
--    `repair_fee_*` trace le prélèvement, décidé par le DG, des frais de gestion de la réparation sur le
--    solde désormais crédité au propriétaire (voir services/gl/... `caution_restituee_avec_retenue` /
--    `frais_reparation_preleve_proprietaire`, non branchées sur le cas simple existant).
ALTER TABLE move_out_reports
  ADD COLUMN review_status ENUM('draft','submitted','rejected','validated') NOT NULL DEFAULT 'draft' AFTER status,
  ADD COLUMN submitted_at DATETIME NULL AFTER review_status,
  ADD COLUMN submitted_by INT UNSIGNED NULL AFTER submitted_at,
  ADD COLUMN reviewed_at DATETIME NULL AFTER submitted_by,
  ADD COLUMN reviewed_by INT UNSIGNED NULL AFTER reviewed_at,
  ADD COLUMN review_note TEXT NULL AFTER reviewed_by,
  ADD COLUMN review_history JSON NULL AFTER review_note,
  ADD COLUMN payout_status ENUM('not_applicable','pending','paid') NOT NULL DEFAULT 'not_applicable' AFTER review_history,
  ADD COLUMN payout_direction ENUM('refund_to_tenant','collect_from_tenant') NULL AFTER payout_status,
  ADD COLUMN payout_amount DECIMAL(12,0) NULL AFTER payout_direction,
  ADD COLUMN payout_method VARCHAR(20) NULL AFTER payout_amount,
  ADD COLUMN payout_order_id INT UNSIGNED NULL AFTER payout_method,
  ADD COLUMN payout_paid_at DATETIME NULL AFTER payout_order_id,
  ADD COLUMN payout_paid_by INT UNSIGNED NULL AFTER payout_paid_at,
  ADD COLUMN repair_fee_amount DECIMAL(12,0) NULL AFTER payout_paid_by,
  ADD COLUMN repair_fee_note VARCHAR(255) NULL AFTER repair_fee_amount,
  ADD COLUMN repair_fee_charged_at DATETIME NULL AFTER repair_fee_note,
  ADD COLUMN repair_fee_charged_by INT UNSIGNED NULL AFTER repair_fee_charged_at,
  ADD CONSTRAINT fk_move_out_reports_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_move_out_reports_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_move_out_reports_payout_order FOREIGN KEY (payout_order_id) REFERENCES payment_orders(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_move_out_reports_payout_paid_by FOREIGN KEY (payout_paid_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_move_out_reports_repair_fee_by FOREIGN KEY (repair_fee_charged_by) REFERENCES users(id) ON DELETE SET NULL;

-- Fiches déjà finalisées : jamais passées par ce nouveau circuit, considérées validées d'office — aucune
-- régression sur l'existant (y compris le cas simple déjà payé via l'écriture auto-postée à la finalisation).
UPDATE move_out_reports SET review_status = 'validated' WHERE status = 'finalized';
UPDATE move_out_reports
  SET payout_status = 'paid', payout_direction = 'refund_to_tenant', payout_amount = net_refund,
      payout_method = refund_payment_method, payout_paid_at = finalized_at, payout_paid_by = finalized_by
  WHERE status = 'finalized' AND net_refund > 0;
UPDATE move_out_reports
  SET payout_status = 'paid', payout_direction = 'collect_from_tenant', payout_amount = balance_due_amount,
      payout_method = balance_payment_method, payout_paid_at = finalized_at, payout_paid_by = finalized_by
  WHERE status = 'finalized' AND balance_due_amount > 0 AND balance_resolution = 'paid';

-- Nouveau motif d'envoi FedaPay : restitution de caution à un locataire sortant (« Payer le locataire »).
-- Même mécanique que `reversement_proprietaire` (bénéficiaire type 'other', comme un paiement libre —
-- aucune colonne dédiée nécessaire sur `payment_orders`), effet métier appliqué uniquement une fois
-- l'envoi CONFIRMÉ par FedaPay (voir services/payments/orders.js `applyOrder`).
ALTER TABLE payment_orders
  MODIFY COLUMN purpose ENUM('salaire','reversement_proprietaire','reversement_charges','autre','remboursement_caution_locataire') NOT NULL;
