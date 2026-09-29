-- Assistant IA (chat Claude) — étape A : fondations.
--
-- Désactivé par défaut pour TOUS les cabinets : les données envoyées à
-- l'assistant quittent la plateforme (traitement par Anthropic), donc chaque
-- DG doit l'activer lui-même et confirmer explicitement (consentement daté et
-- attribué). Aucun comportement existant ne change.
ALTER TABLE tenants
  ADD COLUMN assistant_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN assistant_monthly_quota INT UNSIGNED NOT NULL DEFAULT 300,
  ADD COLUMN assistant_consent_at DATETIME NULL,
  ADD COLUMN assistant_consent_by INT UNSIGNED NULL,
  ADD CONSTRAINT fk_tenants_assistant_consent_by FOREIGN KEY (assistant_consent_by) REFERENCES users(id) ON DELETE SET NULL;

-- Conversations : privées à leur auteur (jamais visibles d'un autre employé, pas
-- même du DG), supprimées pour de bon à la demande (ON DELETE CASCADE sur les
-- messages) et purgées automatiquement passé le délai de conservation.
CREATE TABLE assistant_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_assistant_conv_user (tenant_id, user_id, updated_at),
  CONSTRAINT fk_assistant_conv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_assistant_conv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assistant_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_assistant_msg_conv (conversation_id, id),
  CONSTRAINT fk_assistant_msg_conv FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_assistant_msg_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consommation : une ligne par message envoyé au modèle (le quota mensuel compte
-- ces lignes) — jamais le texte de la conversation, seulement des compteurs.
-- Sert aussi à mesurer le coût réel (jetons en entrée, sortie, cache).
CREATE TABLE assistant_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  model VARCHAR(60) NOT NULL,
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cache_read_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cache_write_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  outcome ENUM('ok', 'truncated', 'refused', 'aborted') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_assistant_usage_month (tenant_id, created_at),
  CONSTRAINT fk_assistant_usage_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
