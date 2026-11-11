-- Reçu de versement propriétaire (demande utilisateur, 2026-11-11 : « lorsqu'on fait un versement à un
-- propriétaire, cela ne génère pas la quittance ») : code de vérification publique, comme les quittances.
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'contrat', 'releve_proprietaire', 'carnet_charges', 'etat_lieux_entree', 'etat_lieux_sortie', 'recu_entree', 'recu_abonnement', 'recu_versement') NOT NULL;
