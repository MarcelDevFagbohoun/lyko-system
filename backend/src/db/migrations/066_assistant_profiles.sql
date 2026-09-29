-- Assistant IA — mémoire du profil : comment l'assistant doit appeler la personne et quelle est sa
-- fonction. Conservé SANS limite de durée (contrairement aux conversations) tant que la personne ne
-- l'efface pas : elle peut le modifier ou l'oublier à tout moment. Un profil par utilisateur, privé.
CREATE TABLE assistant_profiles (
  user_id INT UNSIGNED NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  job_title VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_assistant_profiles_tenant (tenant_id),
  CONSTRAINT fk_assistant_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_assistant_profiles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
