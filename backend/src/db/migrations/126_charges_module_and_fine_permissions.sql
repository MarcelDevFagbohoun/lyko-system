-- 1) Module Charges (SONEB/SBEE) activable par entreprise (Paramètres). Activé par défaut : aucun changement
--    pour les entreprises existantes.
ALTER TABLE tenants
  ADD COLUMN charges_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER activities;

-- 2) Permissions fines (2026-10-26). Pour ne couper l'accès de personne, chaque employé reçoit les nouvelles
--    permissions là où il pouvait déjà faire l'action ; la direction retire ensuite ce qu'elle veut.
INSERT IGNORE INTO user_permissions (user_id, permission_key)
SELECT DISTINCT user_id, 'loyers_encaisser' FROM user_permissions WHERE permission_key IN ('locataires', 'comptabilite');
INSERT IGNORE INTO user_permissions (user_id, permission_key)
SELECT DISTINCT user_id, 'reversements_proprietaires' FROM user_permissions WHERE permission_key IN ('proprietaires', 'comptabilite');
INSERT IGNORE INTO user_permissions (user_id, permission_key)
SELECT DISTINCT user_id, 'charges_enregistrer' FROM user_permissions WHERE permission_key = 'charges';
INSERT IGNORE INTO user_permissions (user_id, permission_key)
SELECT DISTINCT user_id, 'depenses_enregistrer' FROM user_permissions WHERE permission_key = 'comptabilite';
