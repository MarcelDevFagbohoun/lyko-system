-- Poste (intitulé) de chaque employé + liste des postes ajoutés par l'entreprise (suggestions),
-- et réinitialisation du mot de passe de l'admin par code envoyé à son e-mail.
ALTER TABLE users
  ADD COLUMN job_title VARCHAR(60) NULL AFTER role,
  ADD COLUMN password_reset_code_hash VARCHAR(100) NULL,
  ADD COLUMN password_reset_expires_at DATETIME NULL,
  ADD COLUMN password_reset_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE tenant_job_titles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  label VARCHAR(60) NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_job_titles (tenant_id, label),
  CONSTRAINT fk_tenant_job_titles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
