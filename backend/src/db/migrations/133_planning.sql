-- Planning (demande utilisateur, 2026-10-30) : objectifs façon OKR (objectif + résultats clés mesurables),
-- tâches suivies en Kanban (à faire / en cours / terminé) et placées dans un calendrier.
-- Remplace les « tâches assignées » (tasks_assigned, migration 036) : leurs lignes sont reprises ci-dessous.
-- Visibilité : une ligne est visible de son propriétaire (owner_id) et de son créateur (created_by) — le DG
-- ne voit donc que ce qui le concerne ou qu'il a lui-même assigné.
CREATE TABLE IF NOT EXISTS planning_objectives (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plan_obj_tenant_owner (tenant_id, owner_id),
  KEY idx_plan_obj_creator (tenant_id, created_by),
  CONSTRAINT fk_plan_obj_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_obj_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_obj_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planning_key_results (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  objective_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  unit VARCHAR(20) NULL,
  target_value DECIMAL(14,2) NOT NULL,
  current_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plan_kr_obj (objective_id),
  CONSTRAINT fk_plan_kr_obj FOREIGN KEY (objective_id) REFERENCES planning_objectives(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planning_tasks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  objective_id INT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(2000) NULL,
  status ENUM('a_faire','en_cours','termine') NOT NULL DEFAULT 'a_faire',
  priority ENUM('basse','normale','haute') NOT NULL DEFAULT 'normale',
  start_date DATE NULL,
  due_date DATE NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plan_task_owner (tenant_id, owner_id, status),
  KEY idx_plan_task_creator (tenant_id, created_by),
  KEY idx_plan_task_due (tenant_id, due_date),
  CONSTRAINT fk_plan_task_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_task_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_task_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_task_obj FOREIGN KEY (objective_id) REFERENCES planning_objectives(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reprise des anciennes tâches assignées.
INSERT INTO planning_tasks (tenant_id, owner_id, created_by, title, description, status, due_date, completed_at, created_at)
SELECT tenant_id, assigned_to, created_by, title, description,
       IF(completed_at IS NULL, 'a_faire', 'termine'), due_date, completed_at, created_at
  FROM tasks_assigned;
