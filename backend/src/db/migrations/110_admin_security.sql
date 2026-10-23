-- Back-office : double authentification (TOTP) et journal d'audit des actions d'administration.
ALTER TABLE platform_admins
  ADD COLUMN totp_secret_enc TEXT NULL,
  ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN totp_last_step BIGINT NULL;

CREATE TABLE platform_admin_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NULL,
  admin_email VARCHAR(190) NULL,
  action VARCHAR(60) NOT NULL,
  target VARCHAR(80) NULL,
  details TEXT NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pa_audit_created (created_at),
  KEY idx_pa_audit_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
