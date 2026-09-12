-- Étape 3 : gestion des employés et permissions.
-- must_change_password : forcé à 1 à la création par le DG (mot de passe temporaire) ;
-- remis à 0 par POST /api/auth/change-password.
-- status : permet au DG de désactiver un compte sans le supprimer.
-- user_permissions : accès par module, assignés/ajustés par le DG (rôle 'dg' exempté,
-- accès total contrôlé par le rôle lui-même).

ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
  ADD COLUMN status ENUM('active','disabled') NOT NULL DEFAULT 'active' AFTER must_change_password;

CREATE TABLE user_permissions (
  user_id INT UNSIGNED NOT NULL,
  permission_key VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, permission_key),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
