-- Photo figée du bilan détaillé d'un mois à sa clôture (demande utilisateur, 2026-10-21 : « visualiser les
-- mois antérieurs : entrées, versements, point locataires, point propriétaires, dépenses »).
-- Décision : « photo figée + reconstruction » — un mois clôturé garde le bilan tel qu'il était au moment de
-- la clôture ; la reconstruction à la demande (même calcul, données actuelles) sert à détecter un écart
-- (régularisation postérieure). INSERT/UPSERT par la route de clôture uniquement.
CREATE TABLE accounting_period_bilans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  snapshot LONGTEXT NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounting_period_bilans (tenant_id, period),
  CONSTRAINT fk_apb_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
