-- Audit sécurité (2026-10-30, point 6) : le ralentisseur de connexion par compte (`middleware/loginThrottle.js`)
-- ne vivait qu'en mémoire du process Node — remis à zéro à chaque redémarrage/déploiement (un attaquant en
-- cours de blocage repart propre), et non partagé si l'infra passe un jour à plusieurs instances derrière un
-- load-balancer (chaque instance compte ses échecs séparément, divisant d'autant l'efficacité du seuil).
--
-- `throttle_key` = exactement la clé utilisée côté applicatif (`phone:<numéro ou email>` pour /login,
-- `id:<identifiant>` pour /login-employee) — PAS une clé étrangère vers `users` : un échec sur un
-- identifiant qui n'existe même pas doit pouvoir être compté (sinon l'absence de ralentissement sur les
-- identifiants inconnus deviendrait elle-même un signal d'énumération de comptes).
CREATE TABLE IF NOT EXISTS login_throttle (
  throttle_key VARCHAR(191) NOT NULL PRIMARY KEY,
  failures SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at DATETIME NULL,
  locked_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_login_throttle_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
