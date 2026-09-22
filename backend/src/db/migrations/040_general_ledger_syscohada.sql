-- ============================================================================
-- Module de comptabilité générale SYSCOHADA (partie double) — NOUVEAU sous-
-- système, entièrement ADDITIF. Aucune table existante n'est modifiée, à UNE
-- exception near la fin de ce fichier (accounting_periods.fiscal_year_id,
-- une colonne NULLABLE en plus — comportement existant inchangé).
--
-- Préfixe `gl_` (General Ledger) : namespace clairement séparé du reste du
-- schéma (rent_payments, expenses, owner_payouts, utility_payments...), qui
-- reste la source de vérité opérationnelle inchangée. Ce module ne fait
-- qu'OBSERVER ces opérations pour en générer la contrepartie comptable —
-- voir le document d'architecture livré à part pour les points de branchement
-- exacts (services/glPostingService.js, appelé depuis les routes existantes).
--
-- ⚠️ Appliquée sur la base de développement (tenants jetables de test
-- uniquement). Plusieurs choix restent à faire valider par un expert-comptable
-- avant tout seed sur KIko Store (production) — voir la liste d'hypothèses
-- livrée séparément.
-- ============================================================================

-- ── 1. Plan comptable (référentiel des comptes) ────────────────────────────
-- Un plan comptable PAR entreprise (tenant) : préchargé identique pour tous
-- via le script de seed, mais chaque cabinet peut ensuite ajouter ses propres
-- sous-comptes (is_system = 0) sans affecter les autres tenants.
CREATE TABLE gl_accounts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  code VARCHAR(8) NOT NULL COMMENT 'Numéro de compte SYSCOHADA, ex. 411, 706, 571',
  label VARCHAR(150) NOT NULL,
  class TINYINT UNSIGNED NOT NULL COMMENT 'Classe SYSCOHADA 1 à 9 (déduite du 1er chiffre du code, dupliquée ici pour indexation/filtrage rapide)',
  account_type ENUM('actif','passif','charge','produit','autre') NOT NULL COMMENT '"autre" = classes 8/9 (HAO, engagements) — hors périmètre bilan/résultat classique',
  is_control_account TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Compte collectif nécessitant un compte auxiliaire tiers (ex. 411, 401) — voir gl_third_parties',
  parent_account_id INT UNSIGNED NULL COMMENT 'Sous-compte personnalisé rattaché à un compte standard (ex. 411 -> 4111 créé par le cabinet)',
  is_system TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Compte standard du plan SYSCOHADA préchargé — protégé en suppression, label modifiable seulement par le DG',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL COMMENT 'NULL pour les comptes du seed initial',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_accounts_code (tenant_id, code),
  KEY idx_gl_accounts_tenant_class (tenant_id, class),
  CONSTRAINT fk_gl_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_accounts_parent FOREIGN KEY (parent_account_id) REFERENCES gl_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_gl_accounts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Tiers (comptes auxiliaires) ──────────────────────────────────────────
-- Un compte auxiliaire par tiers réel (locataire/propriétaire/fournisseur/
-- employé), rattaché à un compte collectif (411, 401...). Créé PARESSEUSEMENT
-- (à la première opération qui le concerne), jamais dupliqué en table propre
-- aux locataires/propriétaires — ceux-ci restent gérés par `renters`/`owners`
-- (modules existants, inchangés) ; `source_table`/`source_id` font le lien.
CREATE TABLE gl_third_parties (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  control_account_id INT UNSIGNED NOT NULL,
  party_type ENUM('renter','owner','supplier','employee','other') NOT NULL,
  source_table VARCHAR(30) NULL COMMENT 'ex. "renters", "owners" — NULL pour un tiers sans fiche dans une table métier existante (fournisseur ponctuel, employé)',
  source_id INT UNSIGNED NULL,
  auxiliary_code VARCHAR(20) NOT NULL COMMENT 'ex. 411-000042 — généré à la création, jamais réutilisé',
  display_name VARCHAR(150) NOT NULL COMMENT 'Dénormalisé : reste lisible même si la fiche source est supprimée',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_third_parties_source (tenant_id, party_type, source_table, source_id),
  UNIQUE KEY uq_gl_third_parties_code (tenant_id, auxiliary_code),
  KEY idx_gl_third_parties_control_account (control_account_id),
  CONSTRAINT fk_gl_third_parties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_third_parties_account FOREIGN KEY (control_account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Journaux ──────────────────────────────────────────────────────────
CREATE TABLE gl_journals (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  code VARCHAR(10) NOT NULL COMMENT 'ex. CA (caisse), BQ (banque), MM (mobile money), OD (opérations diverses), AN (à-nouveaux)',
  label VARCHAR(100) NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_journals_code (tenant_id, code),
  CONSTRAINT fk_gl_journals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Exercices comptables ─────────────────────────────────────────────
CREATE TABLE gl_fiscal_years (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  label VARCHAR(20) NOT NULL COMMENT 'ex. "2026"',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('ouvert','cloture') NOT NULL DEFAULT 'ouvert',
  closed_at DATETIME NULL,
  closed_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_fiscal_years (tenant_id, label),
  CONSTRAINT fk_gl_fiscal_years_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_fiscal_years_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rattache (facultativement) chaque période mensuelle déjà verrouillable
-- (`accounting_periods`, étape 8/15, INCHANGÉE) à son exercice — seul ajout
-- à une table existante de tout ce module, une colonne NULLABLE de plus,
-- aucun comportement actuel modifié (assertPeriodOpen continue de fonctionner
-- à l'identique).
ALTER TABLE accounting_periods
  ADD COLUMN fiscal_year_id INT UNSIGNED NULL AFTER period,
  ADD CONSTRAINT fk_accounting_periods_fiscal_year FOREIGN KEY (fiscal_year_id) REFERENCES gl_fiscal_years(id) ON DELETE SET NULL;

-- ── 5. Règles comptables (moteur d'écritures) ──────────────────────────
-- Une règle = un type d'opération métier ("loyer_encaisse", "depense"...).
-- JAMAIS de compte codé en dur dans le moteur applicatif : tout passe par
-- ces deux tables, modifiables depuis l'espace Comptabilité avancée.
CREATE TABLE gl_posting_rules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  operation_type VARCHAR(40) NOT NULL COMMENT 'Identifiant technique stable, ex. "loyer_encaisse" — voir catalogue dans constants/glOperationTypes.js',
  label VARCHAR(150) NOT NULL COMMENT 'Libellé lisible pour l’espace Comptabilité avancée',
  journal_id INT UNSIGNED NOT NULL COMMENT 'Journal par défaut ; peut être resolu dynamiquement selon le mode de paiement (voir gl_posting_rule_lines.account_role)',
  narration_template VARCHAR(255) NOT NULL COMMENT 'ex. "Loyer {mois} - {locataire}" — variables résolues par le moteur',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_validated_by_accountant TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Coché explicitement par un profil Comptable/DG après revue — les règles du seed démarrent à 0',
  validated_by INT UNSIGNED NULL,
  validated_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_posting_rules (tenant_id, operation_type),
  CONSTRAINT fk_gl_posting_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_posting_rules_journal FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gl_posting_rules_validated_by FOREIGN KEY (validated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_gl_posting_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Décomposition d'une règle en plusieurs lignes débit/crédit — nécessaire dès
-- qu'une opération se ventile sur plus de 2 comptes (ex. un loyer encaissé
-- avec commission : (1) débit trésorerie = montant brut, (2) crédit produit
-- "706 Honoraires de gérance" = commission, (3) crédit tiers-propriétaire =
-- net). `account_id` est NULL quand le compte dépend du contexte d'exécution
-- (le tiers réel, le mode de paiement réel) — `account_role` indique alors
-- COMMENT le moteur doit le résoudre (voir catalogue de rôles dans
-- constants/glAccountRoles.js, ex. "tresorerie_mode_paiement",
-- "tiers_locataire", "tiers_proprietaire").
CREATE TABLE gl_posting_rule_lines (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id INT UNSIGNED NOT NULL,
  line_order TINYINT UNSIGNED NOT NULL,
  side ENUM('debit','credit') NOT NULL,
  account_id INT UNSIGNED NULL COMMENT 'Compte fixe si connu à l’avance (ex. 706) ; NULL si résolu dynamiquement (voir account_role)',
  account_role VARCHAR(40) NULL COMMENT 'Requis si account_id est NULL',
  amount_formula ENUM('montant_total','pourcentage_variable','montant_moins_pourcentage','montant_fixe') NOT NULL DEFAULT 'montant_total',
  formula_param VARCHAR(60) NULL COMMENT 'ex. "taux_commission_proprietaire" pour pourcentage_variable/montant_moins_pourcentage — résolu par le moteur (voir owner_commission_rates, EXISTANT, réutilisé en lecture seule)',
  fixed_amount DECIMAL(14, 2) NULL COMMENT 'Utilisé seulement si amount_formula = montant_fixe',
  PRIMARY KEY (id),
  KEY idx_gl_posting_rule_lines_rule (rule_id, line_order),
  CONSTRAINT fk_gl_posting_rule_lines_rule FOREIGN KEY (rule_id) REFERENCES gl_posting_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_posting_rule_lines_account FOREIGN KEY (account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT chk_gl_posting_rule_lines_account CHECK (account_id IS NOT NULL OR account_role IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Compteur de numérotation continue (écritures + pièces) ─────────────
-- Table dédiée plutôt qu'un simple AUTO_INCREMENT sur gl_entries : un
-- AUTO_INCREMENT MySQL peut laisser des trous si une transaction échoue
-- après avoir consommé un id (comportement InnoDB documenté, non
-- transactionnel). Ce compteur est incrémenté par le moteur DANS LA MÊME
-- transaction que la création de l'écriture, avec un verrou `FOR UPDATE` —
-- si la transaction échoue, le compteur n'est jamais persisté (ROLLBACK),
-- donc jamais de trou dans la numérotation.
CREATE TABLE gl_entry_number_counters (
  tenant_id INT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_gl_entry_number_counters_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Écritures comptables ──────────────────────────────────────────────
CREATE TABLE gl_entries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  journal_id INT UNSIGNED NOT NULL,
  fiscal_year_id INT UNSIGNED NOT NULL,
  entry_number INT UNSIGNED NOT NULL COMMENT 'Continu, sans trou — voir gl_entry_number_counters',
  piece_number INT UNSIGNED NOT NULL COMMENT 'Numéro de pièce justificative — même valeur que entry_number en V1 (à valider), colonne séparée pour permettre une évolution future',
  entry_date DATE NOT NULL,
  narration VARCHAR(255) NOT NULL,
  source_operation_type VARCHAR(40) NULL COMMENT 'ex. "loyer_encaisse" — NULL pour une écriture manuelle diverse',
  source_table VARCHAR(40) NULL COMMENT 'ex. "rent_payments" — table métier existante à l’origine de cette écriture',
  source_id INT UNSIGNED NULL,
  status ENUM('brouillon','validee','extournee') NOT NULL DEFAULT 'validee' COMMENT 'Les écritures AUTOMATIQUES sont toujours créées "validee" directement (jamais de brouillon) ; "brouillon" ne concerne que la saisie manuelle avant validation',
  reverses_entry_id INT UNSIGNED NULL COMMENT 'Renseigné si CETTE écriture est une extourne (contre-passation) d’une autre',
  reversed_by_entry_id INT UNSIGNED NULL COMMENT 'Renseigné sur l’écriture ORIGINALE une fois extournée',
  created_by INT UNSIGNED NULL COMMENT 'NULL possible si générée par une tâche planifiée (node-cron) sans utilisateur humain',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_entries_number (tenant_id, entry_number),
  KEY idx_gl_entries_date (tenant_id, entry_date),
  KEY idx_gl_entries_source (tenant_id, source_table, source_id),
  KEY idx_gl_entries_fiscal_year (fiscal_year_id),
  CONSTRAINT fk_gl_entries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_entries_journal FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gl_entries_fiscal_year FOREIGN KEY (fiscal_year_id) REFERENCES gl_fiscal_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gl_entries_reverses FOREIGN KEY (reverses_entry_id) REFERENCES gl_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_gl_entries_reversed_by FOREIGN KEY (reversed_by_entry_id) REFERENCES gl_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_gl_entries_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. Lignes d'écriture (le détail débit/crédit) ─────────────────────────
-- L'équilibre SUM(debit) = SUM(credit) PAR écriture n'est PAS exprimable en
-- contrainte déclarative MySQL simple (nécessiterait un CHECK inter-lignes,
-- non supporté) — il est garanti par le moteur applicatif, DANS la même
-- transaction, avant COMMIT (voir services/glPostingService.js, testé
-- unitairement — livrable 5). `amount` est toujours positif ; c'est `side`
-- qui porte le sens.
CREATE TABLE gl_entry_lines (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_id INT UNSIGNED NOT NULL,
  line_order TINYINT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  third_party_id INT UNSIGNED NULL COMMENT 'Requis si account_id est un compte collectif (gl_accounts.is_control_account = 1)',
  side ENUM('debit','credit') NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  payment_method ENUM('especes','banque','mobile_money_mtn','mobile_money_moov','mobile_money_celtis') NULL COMMENT 'Renseigné uniquement sur les lignes de trésorerie (classe 5)',
  PRIMARY KEY (id),
  KEY idx_gl_entry_lines_entry (entry_id, line_order),
  KEY idx_gl_entry_lines_account (account_id),
  KEY idx_gl_entry_lines_third_party (third_party_id),
  CONSTRAINT fk_gl_entry_lines_entry FOREIGN KEY (entry_id) REFERENCES gl_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_entry_lines_account FOREIGN KEY (account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gl_entry_lines_third_party FOREIGN KEY (third_party_id) REFERENCES gl_third_parties(id) ON DELETE RESTRICT,
  CONSTRAINT chk_gl_entry_lines_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 9. Rapprochement bancaire (squelette simple, demandé explicitement) ───
CREATE TABLE gl_bank_reconciliations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  journal_id INT UNSIGNED NOT NULL COMMENT 'Journal banque concerné (un rapprochement par journal/période)',
  period CHAR(7) NOT NULL COMMENT 'AAAA-MM',
  statement_balance DECIMAL(14, 2) NOT NULL COMMENT 'Solde du relevé bancaire, saisi manuellement',
  book_balance DECIMAL(14, 2) NOT NULL COMMENT 'Solde comptable calculé au moment du rapprochement (figé, jamais recalculé après)',
  status ENUM('en_cours','rapproche') NOT NULL DEFAULT 'en_cours',
  reconciled_by INT UNSIGNED NULL,
  reconciled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gl_bank_reconciliations (tenant_id, journal_id, period),
  CONSTRAINT fk_gl_bank_reconciliations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_bank_reconciliations_journal FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gl_bank_reconciliations_by FOREIGN KEY (reconciled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pointage ligne à ligne (une ligne d'écriture de trésorerie <-> une ligne du relevé).
CREATE TABLE gl_bank_reconciliation_lines (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reconciliation_id INT UNSIGNED NOT NULL,
  entry_line_id INT UNSIGNED NULL COMMENT 'NULL tant que non pointée',
  bank_reference VARCHAR(100) NULL COMMENT 'Référence libre du relevé (libellé banque)',
  bank_amount DECIMAL(14, 2) NOT NULL,
  bank_date DATE NOT NULL,
  is_matched TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gl_bank_reconciliation_lines_recon (reconciliation_id),
  CONSTRAINT fk_gl_bank_reconciliation_lines_recon FOREIGN KEY (reconciliation_id) REFERENCES gl_bank_reconciliations(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_bank_reconciliation_lines_entry_line FOREIGN KEY (entry_line_id) REFERENCES gl_entry_lines(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 10. Journal d'audit dédié à la comptabilité ───────────────────────────
-- Plus strict que le "Journal d'activité" existant (services/activity.js,
-- une agrégation en LECTURE depuis les tables métier) : celui-ci est une
-- table d'écriture dédiée, avec IP et valeurs avant/après, comme exigé pour
-- les actions sensibles de ce module (écriture manuelle, extourne, clôture,
-- modification d'une règle comptable).
CREATE TABLE gl_audit_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL COMMENT 'NULL si déclenché par une tâche planifiée',
  ip_address VARCHAR(45) NULL COMMENT 'IPv4 ou IPv6 ; NULL pour une action non-HTTP (cron)',
  action VARCHAR(50) NOT NULL COMMENT 'ex. entry_created, entry_reversed, period_closed, fiscal_year_closed, rule_updated, manual_entry',
  entity_table VARCHAR(40) NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gl_audit_log_tenant (tenant_id, created_at),
  KEY idx_gl_audit_log_entity (entity_table, entity_id),
  CONSTRAINT fk_gl_audit_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_gl_audit_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
