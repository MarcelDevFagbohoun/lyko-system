-- Audit comptable du 23/09/2026, anomalie A3 : aucune fonctionnalité
-- n'existait pour annuler/corriger un paiement de loyer déjà enregistré
-- (contrairement aux dépenses et aux charges SONEB/SBEE, qui ont déjà une
-- suppression logique tracée depuis la migration 016). Même principe ici :
-- suppression LOGIQUE (jamais un DELETE physique) — le paiement reste
-- consultable par le DG avec sa justification obligatoire, mais disparaît
-- des totaux/calculs normaux (arriérés, recette, tableau de bord...).
ALTER TABLE rent_payments
  ADD COLUMN deleted_at DATETIME NULL AFTER kkiapay_transaction_id,
  ADD COLUMN deleted_by INT UNSIGNED NULL AFTER deleted_at,
  ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_by,
  ADD CONSTRAINT fk_rent_payments_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE RESTRICT;
