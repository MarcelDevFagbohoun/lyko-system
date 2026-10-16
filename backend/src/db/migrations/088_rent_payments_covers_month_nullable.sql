-- Refonte de la clôture (étape 2/5, 2026-10-16) : bug trouvé en testant le chemin non-calendaire —
-- la migration 085 a ajouté `covers_period_start` mais a oublié de retirer la contrainte `NOT NULL`
-- héritée de `covers_month` (migration 004), qui doit pourtant rester NULL pour tout bail
-- non-calendaire (voir `recordRentPayment`, routes/leases.js, et la doc de `covers_period_start`
-- dans la migration 085). Sans ce correctif, tout paiement sur un bail non-calendaire échoue avec
-- "Column 'covers_month' cannot be null".
ALTER TABLE rent_payments
  MODIFY COLUMN covers_month CHAR(7) NULL COMMENT 'AAAA-MM — rempli seulement pour un bail calendaire, voir covers_period_start';
