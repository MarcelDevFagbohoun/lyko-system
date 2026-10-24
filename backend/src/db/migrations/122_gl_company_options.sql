-- Options comptables par entreprise (SYSCOHADA) : chaque cabinet choisit le
-- niveau de détail de sa comptabilité. TOUS les défauts reproduisent le
-- comportement historique : une entreprise existante ne change pas tant que
-- son DG/comptable n'active pas une option.
ALTER TABLE tenants
  ADD COLUMN gl_profile ENUM('simple','standard','complet','personnalise') NOT NULL DEFAULT 'simple'
    COMMENT 'Profil comptable choisi (préréglage des options ci-dessous)',
  ADD COLUMN gl_vat_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'TVA sur les commissions de gestion (compte 443)',
  ADD COLUMN gl_vat_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00
    COMMENT 'Taux de TVA (%) modifiable',
  ADD COLUMN gl_closing_mode ENUM('simple','complet') NOT NULL DEFAULT 'simple'
    COMMENT 'complet = affectation du résultat et à-nouveaux à la clôture',
  ADD COLUMN gl_utility_account_mode ENUM('clients','proprietaire') NOT NULL DEFAULT 'clients'
    COMMENT 'Charges SONEB/SBEE : sur le compte clients (411) ou un compte propriétaire dédié',
  ADD COLUMN gl_payroll_level ENUM('net','cnss','complet') NOT NULL DEFAULT 'net'
    COMMENT 'Paie : net seul / avec CNSS / avec CNSS et ITS',
  ADD COLUMN gl_cnss_employee_rate DECIMAL(5,2) NOT NULL DEFAULT 3.60
    COMMENT 'Part salariale CNSS (%) modifiable',
  ADD COLUMN gl_cnss_employer_rate DECIMAL(5,2) NOT NULL DEFAULT 15.40
    COMMENT 'Part patronale CNSS (%) modifiable',
  ADD COLUMN gl_its_brackets JSON NULL
    COMMENT 'Barème ITS saisi par l entreprise : [{"upTo":number|null,"rate":number}]',
  ADD COLUMN gl_irf_base ENUM('versement','loyer_brut') NOT NULL DEFAULT 'versement'
    COMMENT 'Base de calcul de l IRF',
  ADD COLUMN gl_asset_sale_proceeds TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Cession d immobilisation avec prix de vente (produit 754)',
  ADD CONSTRAINT chk_tenants_vat_rate CHECK (gl_vat_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_tenants_cnss_emp CHECK (gl_cnss_employee_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_tenants_cnss_er CHECK (gl_cnss_employer_rate BETWEEN 0 AND 100);

-- Journal des changements de réglages (qui, quand, avant/après).
CREATE TABLE IF NOT EXISTS gl_settings_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  setting_key VARCHAR(60) NOT NULL,
  old_value VARCHAR(255) NULL,
  new_value VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gl_settings_log_tenant (tenant_id, created_at),
  CONSTRAINT fk_gl_settings_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
