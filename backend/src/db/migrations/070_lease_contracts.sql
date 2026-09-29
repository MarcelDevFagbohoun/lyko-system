-- Contrat de bail (étape 46, demande directe de l'utilisateur : « attestation loyer doit être changé
-- en contrat de loyer ») — remplace entièrement l'ancienne « attestation de loyer » (lettre unilatérale
-- signée uniquement par le DG, `tenants.contract_template` + un seul paragraphe libre). Devient un vrai
-- document bilatéral structuré par articles (parties, objet, durée, loyer, caution(s), obligations,
-- conditions particulières), signé par les DEUX parties (locataire + agent), même cycle
-- brouillon → finalisation que les états des lieux (voir 027_inspection_zones.sql).
--
-- `snapshot` (JSON) : les données qui remplissent les articles, figées au moment de la signature
-- (loyer, caution, échéance, cautions supplémentaires...) — un contrat déjà signé ne doit JAMAIS
-- changer de contenu si le bail est modifié après coup (ex. loyer révisé) : même principe que `items`
-- sur les états des lieux. En brouillon, `snapshot` reste NULL — le contenu est alors recalculé à
-- chaque lecture depuis les données live du bail (aperçu toujours à jour avant signature).
CREATE TABLE lease_contracts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  status ENUM('draft', 'finalized') NOT NULL DEFAULT 'draft',
  particular_conditions TEXT NULL,
  snapshot JSON NULL,
  finalized_at DATETIME NULL,
  finalized_by INT UNSIGNED NULL,
  tenant_signature_path VARCHAR(255) NULL,
  agent_signature_path VARCHAR(255) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lease_contracts_lease (lease_id),
  KEY idx_lease_contracts_tenant (tenant_id),
  CONSTRAINT fk_lease_contracts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_contracts_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_contracts_finalized_by FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_lease_contracts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Renomme le type de document suivi par le compteur de téléchargements/vérification publique (étape 29)
-- — élargi temporairement pour permettre la ré-écriture des lignes déjà existantes sans perte.
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'attestation', 'releve_proprietaire', 'carnet_charges', 'contrat') NOT NULL;
UPDATE document_issuances SET document_type = 'contrat' WHERE document_type = 'attestation';
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'contrat', 'releve_proprietaire', 'carnet_charges') NOT NULL;

-- L'ancien modèle de texte libre (une seule phrase avec {{placeholders}}) n'est plus UTILISÉ par le
-- code (le contrat est désormais structuré par articles, calculés depuis les données du bail ; seules
-- les « conditions particulières » restent personnalisables, par BAIL — `lease_contracts.particular_conditions`
-- ci-dessus, plus par entreprise) — mais la colonne `tenants.contract_template` n'est PAS supprimée ici :
-- au moins une entreprise réelle y avait déjà rédigé un texte personnalisé (plusieurs milliers de
-- caractères) avant cette étape ; le supprimer effacerait ce contenu sans recours. Colonne laissée en
-- place, inerte, jamais relue par le code — à traiter séparément si une reprise de cette donnée est
-- un jour demandée.
