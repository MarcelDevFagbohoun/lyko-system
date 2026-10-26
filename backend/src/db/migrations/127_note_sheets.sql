-- Fiche de notes : un document de texte riche (Markdown restreint) par locataire ou propriétaire, à la place du fil
-- de messages. Les anciennes notes (entity_notes) restent consultables en lecture sous la fiche.
-- `version` sert à détecter deux personnes qui modifient la fiche en même temps (la seconde enregistrement est refusé).
CREATE TABLE IF NOT EXISTS note_sheets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  entity_type ENUM('renter','owner') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  content MEDIUMTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_note_sheets_entity (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_note_sheets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_sheets_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
