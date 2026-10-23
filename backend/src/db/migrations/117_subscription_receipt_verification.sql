-- Reçus d'abonnement : code de vérification publique (page /verifier), comme les quittances.
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'contrat', 'releve_proprietaire', 'carnet_charges', 'etat_lieux_entree', 'etat_lieux_sortie', 'recu_entree', 'recu_abonnement') NOT NULL;
