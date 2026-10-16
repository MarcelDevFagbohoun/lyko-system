-- Refonte de la clôture (étape 2/5, 2026-10-16) : `covers_month` (AAAA-MM) ne peut représenter que
-- des mois civils — un bail créé sous un tenant en rythme 'jour_fixe'/'libre' couvre des périodes qui
-- chevauchent deux mois civils et n'ont pas d'étiquette AAAA-MM correcte (même raisonnement que
-- `accounting_periods.period`, migration 084). `covers_period_start` (date réelle, début de la
-- période couverte) devient l'identité rythme-agnostique ; `covers_month` reste en écriture
-- applicative (jamais une colonne générée — un calcul produirait une valeur AAAA-MM fausse plutôt
-- qu'absente pour un bail non-calendaire), peuplée UNIQUEMENT pour les baux calendaire. La garder
-- lisible dans sa forme actuelle évite de toucher `commission.js`/le portail propriétaire (recette
-- par Bien agrégée par mois civil — un besoin différent du loyer dû, voir l'étape 3), qui continuent
-- de fonctionner sans aucune modification pour les 100% de tenants restés calendaire.
ALTER TABLE rent_payments
  ADD COLUMN covers_period_start DATE NULL AFTER covers_month;

-- Rétro-remplissage : chaque paiement existant a forcément été enregistré sous l'ancien régime
-- (uniquement calendaire aujourd'hui), donc `covers_month` est toujours non-null et se backfille
-- intégralement.
UPDATE rent_payments
  SET covers_period_start = STR_TO_DATE(CONCAT(covers_month, '-01'), '%Y-%m-%d')
  WHERE covers_period_start IS NULL;

ALTER TABLE rent_payments
  MODIFY COLUMN covers_period_start DATE NOT NULL,
  ADD KEY idx_rent_payments_lease_period_start (lease_id, covers_period_start);
