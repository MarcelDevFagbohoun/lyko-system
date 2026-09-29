-- Étape 48 : PDF d'état des lieux (entrée + sortie) désormais téléchargeables
-- depuis le portail locataire — doivent avoir leur propre type de document
-- dans le suivi des téléchargements/code de vérification, jamais détourner
-- 'contrat' ou 'carnet_charges' qui désignent autre chose.
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'contrat', 'releve_proprietaire', 'carnet_charges', 'etat_lieux_entree', 'etat_lieux_sortie') NOT NULL;
