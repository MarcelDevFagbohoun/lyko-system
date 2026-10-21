-- Règlement des arriérés de loyer via la caution à la sortie (demande utilisateur, 2026-10-18) :
-- jusqu'ici, un locataire quittant les lieux en devant encore du loyer voyait cette dette
-- simplement DISPARAÎTRE (`leases.status = 'ended'` exclut immédiatement le bail de
-- `listPortfolioArrears`, voir rentTracking.js) sans jamais être réellement réglée ni déduite de
-- sa caution — la caution ne protégeait que contre les dégradations, jamais contre un impayé.
-- `rent_arrears_amount` fige ce qui a été prélevé sur CETTE caution pour régler du loyer en
-- retard (even NULL = 0 pour toutes les sorties déjà finalisées avant cette étape, jamais
-- recalculé rétroactivement sur l'historique).
ALTER TABLE move_out_reports
  ADD COLUMN rent_arrears_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER peinture_overflow_amount;

-- Nouveau mode de règlement RÉSERVÉ aux lignes générées automatiquement par ce règlement (jamais
-- sélectionnable manuellement dans le formulaire d'enregistrement d'un paiement de loyer) — voir
-- routes/leases.js `POST /:leaseId/move-out-report/finalize`.
ALTER TABLE rent_payments
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay','caution') NOT NULL;
