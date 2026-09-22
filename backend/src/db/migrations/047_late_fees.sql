-- Pénalité de retard (livrable "comptabilité complète", section 6 du cahier
-- des charges : "rappels WhatsApp aux locataires en retard, avec une
-- écriture ou une pénalité optionnelle selon règle paramétrable"). Jusqu'ici
-- purement absente : aucune table ne permettait d'appliquer/tracer une
-- pénalité, malgré la règle comptable `penalite_retard` déjà présente dans
-- le seed depuis le livrable 3. Montant TOUJOURS saisi manuellement (jamais
-- un pourcentage/barème automatique — un choix de politique commerciale,
-- pas une règle comptable, hors périmètre de ce qu'on invente ici).
CREATE TABLE late_fees (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12, 0) NOT NULL,
  applied_at DATE NOT NULL,
  reason VARCHAR(255) NULL,
  applied_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_late_fees_lease (lease_id),
  KEY idx_late_fees_tenant (tenant_id, applied_at),
  CONSTRAINT fk_late_fees_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_late_fees_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_late_fees_applied_by FOREIGN KEY (applied_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_late_fees_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
