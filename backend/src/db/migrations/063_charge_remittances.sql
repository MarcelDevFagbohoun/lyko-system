-- Étape 31 — Reversement au propriétaire des charges SONEB/SBEE encaissées.
--
-- Le propriétaire paie lui-même la facture mère à la SONEB/SBEE ; le cabinet
-- encaisse les charges chez les locataires puis les lui reverse (le cabinet ne
-- garde rien sur les charges). Table SÉPARÉE de `owner_payouts` (loyers nets) :
-- ces derniers portent commission/IRF côté comptabilité avancée, ce qui serait
-- faux pour un simple remboursement de charges, et le solde séquestre des
-- loyers (`getEscrowBalances`) ne doit jamais se mélanger à celui des charges.
--
-- Solde à reverser = Σ règlements encaissés sur les factures de ses Biens
-- (hors factures supprimées) − Σ reversements non annulés. Suppression
-- LOGIQUE avec justification obligatoire (même principe que dépenses/charges/
-- loyers) : une erreur de saisie sur de l'argent doit rester corrigeable sans
-- jamais effacer la trace.
--
-- Aucune écriture comptable automatique (voir AUDIT_COMPTABLE.md, point B2 :
-- le compte porteur des charges encaissées est encore à valider par
-- l'expert-comptable).

CREATE TABLE owner_charge_remittances (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  period_label VARCHAR(50) NULL,
  paid_at DATE NOT NULL,
  payment_method ENUM('especes','mobile_money','virement','cheque') NOT NULL DEFAULT 'virement',
  notes VARCHAR(255) NULL,
  recorded_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by INT UNSIGNED NULL,
  deleted_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_charge_remit_tenant (tenant_id),
  KEY idx_charge_remit_owner (owner_id, deleted_at),
  CONSTRAINT fk_charge_remit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_charge_remit_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  CONSTRAINT fk_charge_remit_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_charge_remit_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le carnet des charges remis au propriétaire par son portail suit la même
-- règle que les autres documents (5 téléchargements + code de vérification).
ALTER TABLE document_issuances
  MODIFY COLUMN document_type ENUM('quittance','attestation','releve_proprietaire','carnet_charges') NOT NULL;
