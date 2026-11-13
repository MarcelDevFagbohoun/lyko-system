-- Suivi des erreurs dans le back-office plateforme (demande utilisateur, 2026-11-13 : « est-ce que
-- les erreurs seront affichées dans le compte admin ? »). Jusqu'ici une erreur 500, une tâche
-- planifiée en échec ou un écran qui plante n'existaient que dans les journaux Docker du serveur :
-- personne ne les voyait avant qu'un client se plaigne.
--
-- Une ligne par erreur DISTINCTE (`fingerprint`), pas par occurrence : la même erreur répétée
-- 500 fois incrémente `occurrences` au lieu de noyer l'écran. Aucune donnée métier n'est stockée
-- (ni corps de requête, ni paramètres d'URL) — seulement le message technique, la pile d'appels,
-- la route et l'entreprise concernée.
CREATE TABLE platform_error_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fingerprint CHAR(40) NOT NULL,
  -- api = erreur 500 d'une requête ; job = tâche planifiée ; process = exception hors requête ;
  -- frontend = écran qui plante dans le navigateur d'un utilisateur.
  kind ENUM('api', 'job', 'process', 'frontend') NOT NULL,
  message VARCHAR(500) NOT NULL,
  stack TEXT NULL,
  -- Où : « POST /api/leases/:id/move-out-report/finalize », nom de la tâche, ou page du navigateur.
  location VARCHAR(255) NULL,
  -- Dernière entreprise / dernier utilisateur touchés (sans clé étrangère : l'historique d'erreurs
  -- doit survivre à la suppression d'une entreprise).
  tenant_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  occurrences INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Posé par l'administrateur (« Corrigé ») ; remis à NULL si la même erreur réapparaît.
  resolved_at DATETIME NULL,
  last_alerted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_error_fingerprint (fingerprint),
  KEY idx_error_open (resolved_at, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
