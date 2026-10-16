-- Refonte de la clôture (étape 1/5, 2026-10-16) : `accounting_periods.period` (AAAA-MM) ne peut
-- représenter qu'un mois calendaire — une période "jour fixe" (ex. 5 octobre au 4 novembre) chevauche
-- deux mois civils et n'a pas d'étiquette AAAA-MM correcte. `period_start`/`period_end` (dates réelles,
-- même principe que `gl_fiscal_years.start_date`/`end_date`, migration 040) deviennent l'identité
-- réelle, rythme-agnostique, d'une période. `period` devient NULLABLE : rempli uniquement pour les
-- entreprises restées en rythme 'calendaire' (affichage/compatibilité), NULL pour les autres — MySQL
-- traite plusieurs NULL comme distincts dans un index UNIQUE, donc `uq_accounting_periods` continue de
-- fonctionner sans modification pour les entreprises calendaires.
--
-- Cette table ne contient QUE des périodes déjà CLÔTURÉES, comme avant cette migration — la période
-- OUVERTE reste un concept calculé (jamais une ligne), voir `accountingPeriods.js`.
ALTER TABLE accounting_periods
  MODIFY COLUMN period CHAR(7) NULL COMMENT 'AAAA-MM — rempli seulement en rythme calendaire',
  ADD COLUMN period_start DATE NULL AFTER fiscal_year_id,
  ADD COLUMN period_end DATE NULL AFTER period_start;

-- Rétro-remplissage : chaque période déjà clôturée l'a forcément été sous l'ancien régime, donc
-- toujours un mois calendaire complet (1er au dernier jour du mois).
UPDATE accounting_periods
  SET period_start = CONCAT(period, '-01'),
      period_end = LAST_DAY(CONCAT(period, '-01'))
  WHERE period_start IS NULL;

ALTER TABLE accounting_periods
  MODIFY COLUMN period_start DATE NOT NULL,
  MODIFY COLUMN period_end DATE NOT NULL,
  ADD UNIQUE KEY uq_accounting_periods_start (tenant_id, period_start),
  ADD KEY idx_accounting_periods_tenant_end (tenant_id, period_end);
