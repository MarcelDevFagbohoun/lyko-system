-- Demande directe de l'utilisateur (2026-11-05) : retrait de la signature électronique tactile des
-- états des lieux — jamais utilisée en pratique (tous les écrans finalisaient déjà en
-- `printedSignatures = true`, PV signé à la main après impression). Code mort supprimé côté
-- backend/frontend ; ces deux colonnes ne sont plus jamais écrites ni lues.
ALTER TABLE move_in_reports
  DROP COLUMN tenant_signature_path,
  DROP COLUMN agent_signature_path;
ALTER TABLE move_out_reports
  DROP COLUMN tenant_signature_path,
  DROP COLUMN agent_signature_path;
