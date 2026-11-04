-- Anti-double-pointage bancaire (audit du flux financier, 2026-11-03) : `glBankReconciliationService.js`
-- `addLine` vérifiait l'absence de pointage existant par un simple SELECT avant l'INSERT, sans aucun
-- verrou ni contrainte en base — deux requêtes concurrentes (double-clic, deux onglets) pouvaient
-- toutes les deux pointer LE MÊME mouvement bancaire, faussant le compte de lignes pointées et
-- l'exhaustivité du rapprochement. Une contrainte UNIQUE est le seul filet de sécurité qui marche
-- même sans verrou applicatif (même principe que `uq_gl_entries_active_source`, migration 077).
-- NULL (ligne saisie à la main depuis le relevé, pas encore rapprochée à une écriture) n'est jamais
-- en conflit avec un autre NULL — seul un `entry_line_id` non NULL doit rester unique, ce qui est
-- exactement le comportement standard de MySQL pour une clé UNIQUE sur une colonne NULLable.
ALTER TABLE gl_bank_reconciliation_lines
  ADD UNIQUE KEY uq_gl_bank_reconciliation_lines_entry_line (entry_line_id);
