-- Demande directe de l'utilisateur : le DG fixe un délai (date limite) sur
-- une tâche libre assignée à un employé précis ; tant qu'elle n'est pas
-- marquée terminée, elle apparaît dans son tableau de bord avec un
-- décompte (« aujourd'hui », « reste N jour(s) », ou en retard passé la
-- date). `completed_at` NULL = pas encore terminée ; l'employé assigné (ou
-- le DG) la marque lui-même — jamais de résolution automatique.
CREATE TABLE tasks_assigned (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NULL,
  assigned_to INT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  completed_at DATETIME NULL,
  completed_by INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tasks_assigned_tenant (tenant_id),
  KEY idx_tasks_assigned_to (assigned_to),
  CONSTRAINT fk_tasks_assigned_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assigned_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tasks_assigned_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
