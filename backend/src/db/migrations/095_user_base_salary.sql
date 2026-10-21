-- Paiement des salaires (demande utilisateur, 2026-10-18) : salaire de base MÉMORISÉ par compte
-- (décision explicite de l'utilisateur), proposé par défaut à chaque nouvelle fiche de paie et
-- ajustable avant validation. NULL tant que le DG n'a rien fixé — aucun employé n'a de salaire
-- inventé par défaut. S'applique à TOUS les rôles (dg compris, décision explicite de l'utilisateur :
-- le DG peut aussi s'enregistrer une fiche de paie).
ALTER TABLE users ADD COLUMN base_salary DECIMAL(14,0) NULL AFTER avatar_path;
