-- Historique des relances (demande utilisateur, 2026-10-28) : chaque clic sur « Relancer » (loyer en
-- retard, alerte prédictive, charge SONEB/SBEE impayée) enregistre désormais sa date et son auteur ;
-- un retour (ce que le locataire a répondu / ce qui a été convenu) peut être ajouté après coup. Même
-- schéma polymorphe que `entity_notes` (migration 112) : pas de FK sur entity_id (bail OU facture de
-- charge), juste un index composite.
CREATE TABLE IF NOT EXISTS relance_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  entity_type ENUM('bail', 'charge') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  sent_at DATE NOT NULL,
  sent_by INT UNSIGNED NOT NULL,
  outcome_note VARCHAR(1000) NULL,
  outcome_recorded_at DATETIME NULL,
  outcome_recorded_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_relance_log_entity (tenant_id, entity_type, entity_id, sent_at),
  CONSTRAINT fk_relance_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_relance_log_sent_by FOREIGN KEY (sent_by) REFERENCES users(id),
  CONSTRAINT fk_relance_log_outcome_by FOREIGN KEY (outcome_recorded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
