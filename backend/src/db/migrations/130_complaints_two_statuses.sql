-- Simplification du statut des plaintes (demande utilisateur, 2026-10-28) :
-- deux statuts seulement, « non_resolue » (rouge) et « resolue » (vert) —
-- les anciens statuts intermédiaires « ouverte »/« en_cours » fusionnent dans
-- « non_resolue », et « fermee » (clôturée après vérification) fusionne dans
-- « resolue ». La catégorie reste en base pour l'historique mais n'est plus
-- utilisée par l'application (plus de champ catégorie dans les formulaires).
--
-- Ordre impératif : on élargit d'abord l'ENUM pour accepter la valeur
-- « non_resolue » EN PLUS des anciennes (un ENUM ne peut recevoir que des
-- valeurs qu'il connaît déjà), on bascule les lignes existantes, puis
-- seulement là on rétrécit l'ENUM aux deux valeurs finales.

ALTER TABLE complaints MODIFY status ENUM('ouverte', 'en_cours', 'resolue', 'fermee', 'non_resolue') NOT NULL DEFAULT 'ouverte';
UPDATE complaints SET status = 'resolue' WHERE status = 'fermee';
UPDATE complaints SET status = 'non_resolue' WHERE status IN ('ouverte', 'en_cours');
ALTER TABLE complaints MODIFY status ENUM('non_resolue', 'resolue') NOT NULL DEFAULT 'non_resolue';

ALTER TABLE complaint_events MODIFY from_status ENUM('ouverte', 'en_cours', 'resolue', 'fermee', 'non_resolue') NULL;
ALTER TABLE complaint_events MODIFY to_status ENUM('ouverte', 'en_cours', 'resolue', 'fermee', 'non_resolue') NULL;
UPDATE complaint_events SET to_status = 'resolue' WHERE to_status = 'fermee';
UPDATE complaint_events SET to_status = 'non_resolue' WHERE to_status IN ('ouverte', 'en_cours');
UPDATE complaint_events SET from_status = 'resolue' WHERE from_status = 'fermee';
UPDATE complaint_events SET from_status = 'non_resolue' WHERE from_status IN ('ouverte', 'en_cours');
ALTER TABLE complaint_events MODIFY from_status ENUM('non_resolue', 'resolue') NULL;
ALTER TABLE complaint_events MODIFY to_status ENUM('non_resolue', 'resolue') NULL;
