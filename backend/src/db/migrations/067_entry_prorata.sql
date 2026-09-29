-- Prorata d'entrée (étape 42, demande directe de l'utilisateur, 2026-09-28) : un locataire qui entre
-- en cours de mois paie, à la signature, le nombre de jours réellement occupés avant la première
-- échéance normale (diviseur forfaitaire de 30 jours) — plutôt que le mois entier ou rien du tout.
-- Payé UNE FOIS à la signature (comme la caution et les frais d'agence), jamais un montant qui revient
-- chaque mois : ces colonnes se lisent comme `deposit_amount`/`entry_fee_amount` déjà existantes.
--
-- Montant et nombre de jours toujours calculés par le SERVEUR (jamais transmis par le client) à partir
-- de `monthly_rent`/`start_date`/`rent_due_day`, puis figés à la création — jamais recalculés
-- silencieusement après coup si ces champs changent ensuite.
ALTER TABLE leases
  ADD COLUMN entry_proration ENUM('aucun', 'prorata') NOT NULL DEFAULT 'aucun' AFTER up_to_date_at_onboarding,
  ADD COLUMN entry_prorata_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER entry_proration,
  ADD COLUMN entry_prorata_days SMALLINT UNSIGNED NULL AFTER entry_prorata_amount,
  -- Première échéance normale (voir `firstRegularDueDate`) — à partir de cette date, le bail suit le
  -- cycle mensuel habituel ; gardée pour l'affichage/l'audit, jamais recalculée après coup.
  ADD COLUMN entry_prorata_due_date DATE NULL AFTER entry_prorata_days,
  ADD COLUMN entry_prorata_received_at DATETIME NULL AFTER entry_prorata_due_date,
  ADD COLUMN entry_prorata_received_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL AFTER entry_prorata_received_at;

-- Réglage par défaut de l'entreprise (Paramètres) — repris à la création d'un bail si l'agent n'a rien
-- choisi explicitement, comme `default_rent_timing`. Défaut 'aucun' : aucun bail existant ne change de
-- comportement tant que le DG n'active rien.
ALTER TABLE tenants
  ADD COLUMN default_entry_proration ENUM('aucun', 'prorata') NOT NULL DEFAULT 'aucun';
