-- Ajustement demandé après validation : une suppression (dépense ou charge
-- SONEB/SBEE) par un comptable ou un agent ne doit jamais effacer la trace —
-- elle doit rester consultable par le DG avec la justification obligatoire
-- de l'auteur, tout en disparaissant des totaux/recettes normaux. On passe
-- donc d'une suppression physique (DELETE) à une suppression logique
-- (marquage), sur les deux seules tables qui exposaient un DELETE :
-- `expenses` et `utility_charges`.
ALTER TABLE expenses
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN deleted_by INT UNSIGNED NULL AFTER deleted_at,
  ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_by,
  ADD CONSTRAINT fk_expenses_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE utility_charges
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN deleted_by INT UNSIGNED NULL AFTER deleted_at,
  ADD COLUMN deleted_reason VARCHAR(255) NULL AFTER deleted_by,
  ADD CONSTRAINT fk_utility_charges_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE RESTRICT;
