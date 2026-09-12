-- ─────────────────────────────────────────────────────────────
-- Provisionnement de la base Lyko System.
-- À exécuter UNE FOIS avec un compte MySQL administrateur :
--
--   sudo mysql < backend/scripts/bootstrap-db.sql
--     ou
--   mysql -u root -p < backend/scripts/bootstrap-db.sql
--
-- Mot de passe DEV ci-dessous (déjà reporté dans backend/.env et docker-compose.yml).
-- EN PRODUCTION : changez-le ici ET dans backend/.env avant exécution.
-- ─────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS lyko_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Utilisateur applicatif dédié (jamais root pour l'application).
CREATE USER IF NOT EXISTS 'lyko'@'localhost' IDENTIFIED BY 'lyko_dev_password';
CREATE USER IF NOT EXISTS 'lyko'@'127.0.0.1' IDENTIFIED BY 'lyko_dev_password';
ALTER USER 'lyko'@'localhost' IDENTIFIED BY 'lyko_dev_password';
ALTER USER 'lyko'@'127.0.0.1' IDENTIFIED BY 'lyko_dev_password';

GRANT ALL PRIVILEGES ON lyko_system.* TO 'lyko'@'localhost';
GRANT ALL PRIVILEGES ON lyko_system.* TO 'lyko'@'127.0.0.1';

FLUSH PRIVILEGES;
