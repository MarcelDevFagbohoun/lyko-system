-- Étape 14 : attribution d'un agent responsable à un Bien (gestion d'un
-- sous-ensemble du portefeuille). Un seul agent à la fois par Bien — voir
-- services/scope.js pour la règle d'accès exacte (un agent SANS AUCUNE
-- attribution garde un accès complet, décision produit délibérée).
ALTER TABLE properties
  ADD COLUMN agent_id INT UNSIGNED NULL AFTER owner_id,
  ADD KEY idx_properties_agent (agent_id),
  -- ON DELETE SET NULL : supprimer un employé ne doit jamais échouer ni
  -- entraîner la suppression du Bien — il redevient simplement non attribué.
  ADD CONSTRAINT fk_properties_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL;
