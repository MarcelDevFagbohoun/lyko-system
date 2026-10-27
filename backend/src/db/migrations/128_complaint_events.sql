-- Suivi des plaintes : journal daté de chaque dossier (signalement, changements de statut, commentaires), et lien de
-- suivi propre à chaque plainte pour le locataire.
--
-- complaint_events est un journal : ses lignes ne sont jamais modifiées ni supprimées (piste d'audit).
--   visibility = 'tenant'   : visible par le locataire (page de suivi) et par l'équipe ;
--   visibility = 'internal' : visible par l'équipe seulement. C'est le serveur qui filtre, jamais l'écran.
--   author_user_id   : employé auteur ; author_renter_id : le locataire quand il écrit lui-même (jamais les deux : règle appliquée par le code, MySQL 8 refuse un CHECK sur une colonne à ON DELETE SET NULL).
--   is_estimated = 1 : événement reconstitué pour une plainte antérieure à ce journal ; sa date est approximative.
-- complaints.tracking_token : jeton du lien de suivi de CETTE plainte (lecture de ses événements visibles et réponse du
-- locataire, rien d'autre). Stocké en clair, comme le lien de partage d'une quittance (migration 039) : on doit pouvoir
-- le renvoyer plus tard sans invalider un lien déjà donné. Différent du lien du portail, qui ouvre bien plus de choses.
CREATE TABLE complaint_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  complaint_id INT UNSIGNED NOT NULL,
  event_type ENUM('reported','status_changed','comment') NOT NULL,
  from_status ENUM('ouverte','en_cours','resolue','fermee') NULL,
  to_status ENUM('ouverte','en_cours','resolue','fermee') NULL,
  body TEXT NULL,
  visibility ENUM('tenant','internal') NOT NULL DEFAULT 'internal',
  author_user_id INT UNSIGNED NULL,
  author_renter_id INT UNSIGNED NULL,
  is_estimated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_complaint_events_complaint (complaint_id, id),
  KEY idx_complaint_events_tenant (tenant_id),
  CONSTRAINT fk_complaint_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_complaint_events_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_complaint_events_user FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_complaint_events_renter FOREIGN KEY (author_renter_id) REFERENCES renters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE complaints
  ADD COLUMN tracking_token VARCHAR(64) NULL AFTER resolution_note,
  ADD UNIQUE KEY uq_complaints_tracking_token (tracking_token);

-- Reprise des plaintes existantes : leur signalement (date réelle) puis, selon l'état actuel, un événement de statut
-- dont la date est approximative (is_estimated = 1) car l'historique exact n'a jamais été conservé.
INSERT INTO complaint_events (tenant_id, complaint_id, event_type, to_status, visibility, author_user_id, author_renter_id, created_at)
SELECT c.tenant_id, c.id, 'reported', 'ouverte', 'tenant',
       IF(c.reported_via_portal = 1, NULL, c.created_by),
       IF(c.reported_via_portal = 1, (SELECT l.renter_id FROM leases l WHERE l.id = c.lease_id), NULL),
       c.created_at
FROM complaints c;

INSERT INTO complaint_events (tenant_id, complaint_id, event_type, from_status, to_status, visibility, author_user_id, is_estimated, created_at)
SELECT c.tenant_id, c.id, 'status_changed', 'ouverte', c.status, 'tenant',
       IF(c.status = 'resolue', c.resolved_by, NULL), 1,
       CASE WHEN c.status = 'resolue' AND c.resolved_at IS NOT NULL THEN GREATEST(TIMESTAMP(c.resolved_at), c.created_at)
            ELSE GREATEST(c.updated_at, c.created_at) END
FROM complaints c
WHERE c.status <> 'ouverte';

-- La note de résolution déjà saisie reste dans l'historique de l'équipe (interne : elle n'a jamais été montrée au locataire).
INSERT INTO complaint_events (tenant_id, complaint_id, event_type, body, visibility, author_user_id, is_estimated, created_at)
SELECT c.tenant_id, c.id, 'comment', c.resolution_note, 'internal', c.resolved_by, 1,
       GREATEST(COALESCE(TIMESTAMP(c.resolved_at), c.updated_at), c.created_at)
FROM complaints c
WHERE c.resolution_note IS NOT NULL AND TRIM(c.resolution_note) <> '';
