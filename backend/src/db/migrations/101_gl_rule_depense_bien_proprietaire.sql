-- Alignement comptabilité simple / avancée (21/10/2026) : une dépense imputée à un Bien est une avance faite
-- pour le propriétaire (débit 4671 + 706 pour la part de commission non perçue, crédit trésorerie/fournisseur).
-- Ajoute la règle `depense_bien_proprietaire` à TOUTES les entreprises dont le plan comptable est déjà
-- initialisé (les nouvelles l'obtiennent via db/seedGeneralLedger.js). Idempotent.
INSERT INTO gl_posting_rules (tenant_id, operation_type, label, journal_id, narration_template, is_validated_by_accountant)
SELECT r.tenant_id, 'depense_bien_proprietaire', 'Dépense sur un Bien (avance pour le propriétaire)', r.journal_id, 'Dépense Bien — {libelle}', 0
FROM gl_posting_rules r
WHERE r.operation_type = 'loyer_encaisse'
  AND NOT EXISTS (SELECT 1 FROM gl_posting_rules x WHERE x.tenant_id = r.tenant_id AND x.operation_type = 'depense_bien_proprietaire');

INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
SELECT n.id, 1, 'debit', a.id, NULL, 'pourcentage_variable', 'taux_commission_encaissement'
FROM gl_posting_rules n
JOIN gl_accounts a ON a.tenant_id = n.tenant_id AND a.code = '706'
WHERE n.operation_type = 'depense_bien_proprietaire'
  AND NOT EXISTS (SELECT 1 FROM gl_posting_rule_lines l WHERE l.rule_id = n.id);

INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
SELECT n.id, 2, 'debit', NULL, 'tiers_proprietaire', 'montant_moins_pourcentage', 'taux_commission_encaissement'
FROM gl_posting_rules n
WHERE n.operation_type = 'depense_bien_proprietaire'
  AND (SELECT COUNT(*) FROM gl_posting_rule_lines l WHERE l.rule_id = n.id) = 1;

INSERT INTO gl_posting_rule_lines (rule_id, line_order, side, account_id, account_role, amount_formula, formula_param)
SELECT n.id, 3, 'credit', NULL, 'tresorerie_ou_fournisseur', 'montant_total', NULL
FROM gl_posting_rules n
WHERE n.operation_type = 'depense_bien_proprietaire'
  AND (SELECT COUNT(*) FROM gl_posting_rule_lines l WHERE l.rule_id = n.id) = 2;
