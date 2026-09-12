-- Commission du cabinet sur les loyers encaissés pour le compte d'un
-- propriétaire — reprise du « taux de commission » explicitement écarté à
-- l'étape 5 (mandat de gérance non géré), maintenant demandé sous une forme
-- réduite : un taux par Propriétaire (`owners`), historisé (jamais écrasé),
-- pour calculer une recette nette / commission / part propriétaire par Bien
-- et par mois. Les versements (`owner_payouts`, étape 5) restent une saisie
-- manuelle indépendante : ce calcul est une aide à la décision affichée sur
-- la fiche, pas une écriture comptable automatique.

CREATE TABLE owner_commission_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  rate DECIMAL(5,2) NOT NULL,        -- pourcentage, 0.00 à 100.00
  starts_on DATE NOT NULL,
  ends_on DATE NULL,                 -- NULL = taux actif ; jamais écrasé, seulement clôturé
  set_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_commission_rates_tenant (tenant_id),
  KEY idx_commission_rates_owner_period (owner_id, starts_on, ends_on),
  CONSTRAINT fk_commission_rates_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_rates_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_rates_set_by FOREIGN KEY (set_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dépenses rattachables à un Bien (et optionnellement une Unité précise en
-- son sein) pour qu'elles réduisent la recette nette de CE Bien dans le
-- calcul ci-dessus — sans changer la nature des dépenses déjà saisies
-- (fonctionnement du cabinet : loyer bureau, salaires... restent NULL,
-- non rattachées à un bien, exactement comme avant). Colonnes nullables :
-- aucune dépense existante n'est affectée par cette migration.
ALTER TABLE expenses
  ADD COLUMN property_id INT UNSIGNED NULL AFTER category,
  ADD COLUMN unit_id INT UNSIGNED NULL AFTER property_id,
  ADD CONSTRAINT fk_expenses_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_expenses_unit FOREIGN KEY (unit_id) REFERENCES property_units(id) ON DELETE SET NULL,
  ADD KEY idx_expenses_property (property_id);
