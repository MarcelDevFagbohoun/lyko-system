-- Référentiel de prix pour la facturation des dégradations constatées à
-- l'état des lieux de sortie (demande directe de l'utilisateur : "une liste
-- contenant tous les éléments de la maison et leurs prix"). Un seul
-- catalogue par entreprise (pas par Bien) — cohérent avec le modèle de
-- zones/éléments déjà commun à tous les baux (`constants/inspection.js`).
-- Le prix est TOUT COMPRIS (matériel + pose) — décision explicite de
-- l'utilisateur : pas de ligne de main d'œuvre séparée.
-- Volontairement PAS de clé étrangère depuis `move_in_reports`/
-- `move_out_reports.items` (JSON) vers cette table : la ligne choisie au
-- moment de l'état des lieux est copiée (libellé + prix), jamais une
-- référence vive — supprimer une entrée du catalogue plus tard ne doit
-- jamais modifier un état des lieux déjà enregistré.
CREATE TABLE inspection_price_catalog (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  label VARCHAR(150) NOT NULL,
  price DECIMAL(12, 0) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inspection_price_catalog_tenant (tenant_id),
  CONSTRAINT fk_inspection_price_catalog_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_inspection_price_catalog_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_inspection_price_catalog_price CHECK (price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
