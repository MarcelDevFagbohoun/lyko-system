-- Étape 8 (ajustement demandé après validation) : clôture mensuelle des
-- comptes. Une fois un mois clôturé par le DG, plus aucune écriture
-- financière (paiement de loyer, versement propriétaire, dépense, charge
-- SONEB/SBEE) datée dans ce mois ne peut être créée, modifiée ou supprimée —
-- traçabilité et intégrité des recettes du mois. Volontairement pas de
-- « rouvrir » : une clôture est un acte définitif (cohérent avec la demande
-- de rigueur/traçabilité) ; si un besoin de réouverture apparaît, ce sera une
-- décision explicite à ajouter plus tard, pas un défaut.
CREATE TABLE accounting_periods (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL COMMENT 'AAAA-MM',
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounting_periods (tenant_id, period),
  CONSTRAINT fk_accounting_periods_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_accounting_periods_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
