-- Étape 29 : limite de téléchargement (5 max) + code de vérification public
-- pour les documents remis aux locataires/propriétaires via leur portail
-- (quittance, attestation, relevé propriétaire) — jamais pour les
-- équivalents téléchargés côté employé (espace connecté), ni pour le PV de
-- sortie ou le rapport mensuel comptable (aucun téléchargement portail).
--
-- Une ligne = une « instance » de document (ex. la quittance du paiement
-- #42, l'attestation du bail #7, le relevé du propriétaire #3) — jamais par
-- token (régénérer un lien ne doit pas remettre le compteur à zéro, sinon
-- la limite ne protégerait plus rien).
CREATE TABLE document_issuances (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  document_type ENUM('quittance','attestation','releve_proprietaire') NOT NULL,
  -- Selon le type : id du paiement (quittance), du bail (attestation) ou du
  -- propriétaire (relevé — un seul relevé « courant » par propriétaire, pas
  -- un par mois, voir routes/ownerPortal.js).
  reference_id INT UNSIGNED NOT NULL,
  verification_code VARCHAR(16) NOT NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_downloads INT UNSIGNED NOT NULL DEFAULT 5,
  first_downloaded_at DATETIME NULL,
  last_downloaded_at DATETIME NULL,
  reset_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_reset_by INT UNSIGNED NULL,
  last_reset_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_document_issuance (tenant_id, document_type, reference_id),
  UNIQUE KEY uq_verification_code (verification_code),
  KEY idx_document_issuance_tenant (tenant_id),
  CONSTRAINT fk_document_issuance_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_document_issuance_reset_by FOREIGN KEY (last_reset_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
