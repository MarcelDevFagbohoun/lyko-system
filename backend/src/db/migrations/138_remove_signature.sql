-- Demande directe de l'utilisateur (2026-11-02) : on retire la « signature » téléversée (profil
-- personnel DG/employé ET réglages de l'entreprise) ainsi que les signatures numériques capturées à
-- la finalisation du contrat de bail — seul le CACHET (stamp_path) subsiste, et sur le contrat de
-- bail c'est OBLIGATOIREMENT celui du DG qui doit apparaître (voir services/leaseContractActions.js).
-- Les signatures des états des lieux (move_in_reports/move_out_reports) ne sont PAS concernées : il
-- s'agit là d'une signature manuscrite captée au moment de l'état des lieux, pas d'une image
-- téléversée à l'avance — fonctionnalité distincte, non visée par cette demande.
ALTER TABLE users DROP COLUMN signature_path;
ALTER TABLE tenants DROP COLUMN signature_path;
ALTER TABLE lease_contracts DROP COLUMN tenant_signature_path, DROP COLUMN agent_signature_path;
