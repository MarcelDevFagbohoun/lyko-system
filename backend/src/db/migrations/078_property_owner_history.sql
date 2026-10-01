-- Audit comptable, suite (étape 51bis) : `PATCH /api/properties/:id` pouvait changer `owner_id` sans
-- aucune trace, et TOUTE la comptabilité (séquestre, recette nette, recette cabinet, commission)
-- recalculait systématiquement à partir du propriétaire ACTUEL — jamais celui en vigueur au moment de
-- chaque paiement/dépense. Réattribuer un Bien réécrivait donc silencieusement tout son historique
-- financier à l'ancien ou au nouveau propriétaire. Cette table — même principe que
-- `owner_commission_rates` (starts_on/ends_on, jamais écrasée, seulement clôturée) — permet de résoudre
-- le propriétaire EN VIGUEUR à une date donnée. `properties.owner_id` reste le propriétaire ACTUEL
-- (dénormalisé, utilisé partout ailleurs où seul "aujourd'hui" compte), jamais retiré.
CREATE TABLE property_owner_history (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NULL,                 -- NULL = période actuelle ; jamais écrasée, seulement clôturée
  set_by INT UNSIGNED NULL,          -- NULL pour la ligne de reprise ci-dessous (pas un geste explicite d'un utilisateur)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_owner_history_tenant (tenant_id),
  KEY idx_property_owner_history_property_period (property_id, starts_on, ends_on),
  CONSTRAINT fk_property_owner_history_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_property_owner_history_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CONSTRAINT fk_property_owner_history_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  CONSTRAINT fk_property_owner_history_set_by FOREIGN KEY (set_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reprise : chaque Bien existant obtient une période ouverte (jamais clôturée) avec son propriétaire
-- ACTUEL, démarrant à la création du Bien — comportement inchangé pour toute entreprise qui n'a jamais
-- réattribué de propriétaire (l'écrasante majorité à ce jour).
INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on)
SELECT p.tenant_id, p.id, p.owner_id, DATE(p.created_at)
FROM properties p
WHERE p.owner_id IS NOT NULL;
