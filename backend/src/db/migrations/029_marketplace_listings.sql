-- Marketplace (demande directe de l'utilisateur) : quand une Unité se libère,
-- le comptable, l'agent ou le DG peut publier une annonce (description +
-- photos) sur une page publique partageable (comme les portails locataire/
-- propriétaire, mais sans lien secret : une annonce est faite pour être vue).
--
-- Une seule annonce active par Unité : republier remplace la précédente
-- (description/photos), jamais un doublon — `UNIQUE KEY` sur `unit_id`.
-- La ligne existe = l'annonce est publiée ; la supprimer = la retirer (pas
-- de colonne de statut séparée). Supprimée automatiquement dès qu'un nouveau
-- bail est signé sur cette Unité (voir routes/renters.js) — une annonce
-- redevient nécessaire (et sa description/ses photos potentiellement
-- obsolètes) la prochaine fois que l'Unité se libère.
CREATE TABLE marketplace_listings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  description TEXT NULL,
  photo_paths JSON NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketplace_unit (unit_id),
  KEY idx_marketplace_tenant (tenant_id),
  CONSTRAINT fk_marketplace_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_unit FOREIGN KEY (unit_id) REFERENCES property_units(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketplace_published_by FOREIGN KEY (published_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
