-- Notification au DG lors d'une opération comptable sensible (extourne,
-- écriture manuelle, clôture d'exercice, dépense au-dessus d'un seuil) —
-- décision validée avec l'utilisateur. Aucun mécanisme de notification
-- asynchrone générique n'existe ailleurs dans le projet (les "toasts"
-- existants, étape 17, sont éphémères et côté client uniquement, utiles
-- seulement si le DG est connecté au moment précis de l'action) : cette
-- table est dédiée à ce module, volontairement simple (pas de système de
-- notification transverse à toute l'application, hors périmètre demandé).
CREATE TABLE gl_notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL COMMENT 'Le DG destinataire — toujours résolu à la création (un seul DG par tenant)',
  type VARCHAR(40) NOT NULL COMMENT 'ex. entry_reversed, manual_entry, fiscal_year_closed, expense_threshold',
  message VARCHAR(255) NOT NULL,
  entity_table VARCHAR(40) NULL,
  entity_id INT UNSIGNED NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gl_notifications_user_unread (user_id, read_at),
  CONSTRAINT fk_gl_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seuil de dépense déclenchant une notification DG — paramétrable par
-- entreprise plutôt que codé en dur (NULL = pas de seuil, aucune notification
-- automatique liée au montant).
ALTER TABLE tenants
  ADD COLUMN gl_expense_alert_threshold DECIMAL(14, 2) NULL AFTER kkiapay_secret_key_enc;
