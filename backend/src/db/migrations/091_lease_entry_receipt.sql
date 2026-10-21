-- Reçu d'entrée (demande utilisateur, 2026-10-17) : à la signature du bail, la caution, les frais
-- d'agence (non remboursables), les cautions supplémentaires (SBEE/SONEB/peinture) et le prorata
-- d'entrée sont chacun de vrais mouvements de trésorerie (voir `routes/renters.js`
-- `recordDepositReceived`/`recordEntryFeeReceived`/`recordEntryProrataReceived`,
-- `services/leaseDeposits.js` `recordAdditionalDeposits`) — mais aucun d'eux ne produisait jusqu'ici de
-- reçu : seul un paiement de loyer ultérieur (`rent_payments`/`receipts`) en génère un.
--
-- Une ligne par bail (au plus un reçu d'entrée, jamais régénéré : ces quatre mouvements ne peuvent être
-- enregistrés qu'au moment de la création du bail, voir `routes/renters.js`, jamais après). `snapshot`
-- (JSON, `{lines:[{label,amount}], total}`) fige le détail au moment de la création, même principe que
-- `lease_contracts.snapshot` : un reçu déjà émis ne doit jamais changer de contenu après coup. Créée
-- UNIQUEMENT si au moins un de ces mouvements a réellement été payé à la signature (total > 0) — rien à
-- recevoir, rien à émettre.
CREATE TABLE lease_entry_receipts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  lease_id INT UNSIGNED NOT NULL,
  receipt_number VARCHAR(30) NOT NULL,
  snapshot JSON NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lease_entry_receipts_lease (lease_id),
  UNIQUE KEY uq_lease_entry_receipts_number (tenant_id, receipt_number),
  CONSTRAINT fk_lease_entry_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_entry_receipts_lease FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  CONSTRAINT fk_lease_entry_receipts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Même suivi téléchargement/code de vérification public que les autres documents officiels (étape 29)
-- — téléchargé uniquement côté personnel pour l'instant (jamais depuis le portail locataire), donc le
-- plafond de téléchargements ne sera jamais appliqué en pratique (voir `registerDownload`, jamais
-- appelé par la route employé), mais le code de vérification reste utile : le locataire qui reçoit ce
-- reçu (remis à la main) doit pouvoir en confirmer l'authenticité sur /verifier comme tout autre document.
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance', 'contrat', 'releve_proprietaire', 'carnet_charges', 'etat_lieux_entree', 'etat_lieux_sortie', 'recu_entree') NOT NULL;
