-- Frais d'agence pris DIRECTEMENT au locataire à la signature du bail —
-- 100% produit du cabinet, jamais reversé ni compté dans la recette du
-- propriétaire (contrairement à `deposit_amount`/`opening_debt_amount`, qui
-- appartiennent respectivement au locataire et suivent la répartition
-- commission/propriétaire habituelle). Même schéma que `deposit_amount`/
-- `deposit_received_at`/`deposit_received_method` (migration 045) : montant
-- déclaratif + trace de l'encaissement réel (date/mode), nécessaire pour
-- générer la contrepartie comptable (`frais_agence_encaisse`, compte 706).
ALTER TABLE leases
  ADD COLUMN entry_fee_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER up_to_date_at_onboarding,
  ADD COLUMN entry_fee_received_at DATE NULL AFTER entry_fee_amount,
  ADD COLUMN entry_fee_received_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL AFTER entry_fee_received_at;
