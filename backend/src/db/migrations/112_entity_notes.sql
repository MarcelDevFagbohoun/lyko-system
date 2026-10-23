-- Notes écrites en « messages » datés : fil de notes par locataire, propriétaire ou bien. Chaque note
-- garde son auteur, son rôle (couleur de la bulle) et son horodatage ; une note n'est jamais modifiée
-- (piste d'audit). Les anciennes notes uniques (renters.notes, owners.notes) sont reprises comme première bulle.
CREATE TABLE IF NOT EXISTS entity_notes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  entity_type ENUM('renter','owner','property') NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  body VARCHAR(2000) NOT NULL,
  author_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_entity_notes_entity (tenant_id, entity_type, entity_id, created_at),
  CONSTRAINT fk_entity_notes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_entity_notes_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO entity_notes (tenant_id, entity_type, entity_id, body, author_id, created_at)
SELECT tenant_id, 'renter', id, LEFT(notes, 2000), notes_updated_by, COALESCE(notes_updated_at, created_at)
FROM renters WHERE notes IS NOT NULL AND TRIM(notes) <> '';

INSERT INTO entity_notes (tenant_id, entity_type, entity_id, body, author_id, created_at)
SELECT tenant_id, 'owner', id, LEFT(notes, 2000), created_by, created_at
FROM owners WHERE notes IS NOT NULL AND TRIM(notes) <> '';
