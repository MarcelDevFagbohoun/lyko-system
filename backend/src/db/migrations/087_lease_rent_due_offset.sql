-- Refonte de la clôture (étape 2/5, 2026-10-16) : `rent_due_day` (jour du mois CIVIL, 1-28) n'a plus
-- de sens pour un bail créé sous un tenant en rythme 'jour_fixe'/'libre' — une période de ce rythme
-- peut chevaucher deux mois civils. `rent_due_offset_days` (nombre de jours après le début de SA
-- période — ou de la période suivante en 'terme_echu' — où le loyer est dû) le remplace pour ces
-- baux uniquement. Un bail calendaire garde `rent_due_day` exactement comme avant cette migration,
-- aucun changement de comportement. Les deux colonnes sont mutuellement exclusives : un bail en a
-- TOUJOURS exactement une des deux renseignée, jamais les deux, jamais aucune — contrainte CHECK
-- posée en base en plus de la validation applicative, pour qu'aucun bail ne puisse exister sans
-- échéance définie même via un accès direct à la base hors de l'application.
ALTER TABLE leases
  MODIFY COLUMN rent_due_day TINYINT UNSIGNED NULL,
  ADD COLUMN rent_due_offset_days SMALLINT UNSIGNED NULL
    COMMENT 'Jours après le début de la période (ou de la période suivante en terme_echu) où le loyer est dû — baux non-calendaire uniquement, voir rent_due_day'
    AFTER rent_due_day,
  ADD CONSTRAINT chk_leases_rent_due_offset_days CHECK (rent_due_offset_days IS NULL OR rent_due_offset_days BETWEEN 0 AND 27),
  ADD CONSTRAINT chk_leases_rent_due_exactly_one CHECK ((rent_due_day IS NULL) <> (rent_due_offset_days IS NULL));
