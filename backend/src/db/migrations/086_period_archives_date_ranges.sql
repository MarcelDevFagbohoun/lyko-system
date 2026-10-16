-- Refonte de la clôture (étape 2/5, 2026-10-16) : même traitement que `accounting_periods` (migration
-- 084) pour les deux tables de figement "à la clôture" — `period CHAR(7)` ne peut représenter que des
-- mois civils, devient nullable (peuplé uniquement en rythme calendaire), remplacé comme identité
-- réelle par `period_start`/`period_end DATE NOT NULL`. Nécessaire AVANT de généraliser l'appel à ces
-- deux fonctions pour tout rythme dans la route de clôture (sinon le premier INSERT pour un tenant
-- non-calendaire échoue sur la contrainte NOT NULL de `period`).

ALTER TABLE lease_balance_snapshots
  MODIFY COLUMN period CHAR(7) NULL COMMENT 'AAAA-MM — rempli seulement en rythme calendaire',
  ADD COLUMN period_start DATE NULL AFTER period,
  ADD COLUMN period_end DATE NULL AFTER period_start;

UPDATE lease_balance_snapshots
  SET period_start = CONCAT(period, '-01'),
      period_end = LAST_DAY(CONCAT(period, '-01'))
  WHERE period_start IS NULL;

ALTER TABLE lease_balance_snapshots
  MODIFY COLUMN period_start DATE NOT NULL,
  MODIFY COLUMN period_end DATE NOT NULL,
  DROP KEY uq_lease_balance_snapshots,
  ADD UNIQUE KEY uq_lease_balance_snapshots_start (tenant_id, period_start, lease_id);

ALTER TABLE monthly_renter_archive
  MODIFY COLUMN period CHAR(7) NULL COMMENT 'AAAA-MM — rempli seulement en rythme calendaire',
  ADD COLUMN period_start DATE NULL AFTER period,
  ADD COLUMN period_end DATE NULL AFTER period_start;

UPDATE monthly_renter_archive
  SET period_start = CONCAT(period, '-01'),
      period_end = LAST_DAY(CONCAT(period, '-01'))
  WHERE period_start IS NULL;

ALTER TABLE monthly_renter_archive
  MODIFY COLUMN period_start DATE NOT NULL,
  MODIFY COLUMN period_end DATE NOT NULL,
  DROP KEY uq_monthly_renter_archive,
  DROP KEY idx_monthly_renter_archive_tenant_period,
  ADD UNIQUE KEY uq_monthly_renter_archive_start (tenant_id, period_start, lease_id),
  ADD KEY idx_monthly_renter_archive_tenant_start (tenant_id, period_start);
