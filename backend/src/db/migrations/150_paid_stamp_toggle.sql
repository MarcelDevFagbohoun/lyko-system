-- Activer/désactiver le tampon « PAYÉ » sur les reçus (demande utilisateur, 2026-11-11 : « chaque
-- employé autorisé doit l'activer ou pas en fonction de son besoin ainsi que l'admin »).
--
-- Deux réglages distincts, parce que tous les reçus tamponnés ne portent pas le cachet d'un employé
-- précis :
--  - `users.show_paid_stamp` : réglage PERSONNEL. S'applique à la quittance de loyer et au reçu
--    d'entrée, qui affichent toujours le cachet de l'employé qui a réellement encaissé
--    (`issuer`/`recorded_by`) — chacun règle ce tampon pour les documents qu'IL délivre. Par défaut à 1
--    (comportement inchangé pour tout le monde).
--  - `tenants.show_paid_stamp_charges` : réglage UNIQUE pour tout le cabinet. Le reçu de charges
--    (SONEB/SBEE) n'est rattaché à aucun employé en particulier (toujours le cachet de l'entreprise),
--    donc un réglage personnel n'a pas de sens ici — un seul interrupteur, réglable par le DG. Par
--    défaut à 1 (comportement inchangé).
ALTER TABLE users ADD COLUMN show_paid_stamp TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN show_paid_stamp_charges TINYINT(1) NOT NULL DEFAULT 1;
