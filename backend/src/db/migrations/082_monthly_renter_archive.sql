-- Demande explicite de l'utilisateur (16/10/2026) : à la clôture d'un mois, archiver pour chaque
-- locataire concerné "le point du mois" complet (loyer, charges SONEB/SBEE, pénalités de retard,
-- note) — consultable mais jamais modifiable, même principe que `lease_balance_snapshots`
-- (INSERT-only, figé pour toujours) mais avec l'image complète du mois, pas seulement le solde dû.
-- Les trois volets variables sont stockés en JSON (comme `move_out_reports.items`) plutôt qu'en
-- colonnes séparées : leur forme suit celle déjà calculée ailleurs (`rentMonthState`, listes de
-- charges/pénalités) et n'a pas besoin d'être interrogée en SQL, seulement relue telle quelle.
CREATE TABLE monthly_renter_archive (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL COMMENT 'AAAA-MM, le mois clôturé',
  lease_id INT UNSIGNED NOT NULL,
  renter_id INT UNSIGNED NOT NULL,
  rent_payload JSON NOT NULL,
  charges_payload JSON NOT NULL,
  late_fees_payload JSON NOT NULL,
  -- Copie de `renters.notes` au moment de la clôture — la note vivante est remise à zéro juste
  -- après (décision explicite de l'utilisateur), cette colonne est désormais la SEULE trace de ce
  -- qu'elle disait pour ce mois.
  notes_snapshot TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_monthly_renter_archive (tenant_id, period, lease_id),
  KEY idx_monthly_renter_archive_tenant_period (tenant_id, period),
  CONSTRAINT fk_mra_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_mra_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_mra_renter FOREIGN KEY (renter_id) REFERENCES renters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
