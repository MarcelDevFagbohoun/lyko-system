-- Photo de profil personnelle de l'employé (étape 47, refonte de « Mon
-- compte »), purement visuelle dans l'app — jamais utilisée sur un document
-- PDF (le cachet/la signature restent le seul mécanisme légal là-dessus).
ALTER TABLE users
  ADD COLUMN avatar_path VARCHAR(255) NULL AFTER signature_path;
