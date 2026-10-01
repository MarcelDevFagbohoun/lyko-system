-- Sortie du patrimoine d'une immobilisation (vente, rebut, perte) — audit
-- comptable du 30/09/2026 : `fixed_assets.status`/`disposed_at` existaient
-- déjà (migration 049) mais AUCUNE route ne les faisait jamais évoluer,
-- laissant tout bien disposé indéfiniment "actif" avec sa valeur résiduelle.
-- `disposed_reason` : justification exigée, même principe que
-- `expenses.deleted_reason` pour toute action définitive sur une donnée
-- comptable. `disposed_by` : traçabilité de qui a sorti le bien.
ALTER TABLE fixed_assets
  ADD COLUMN disposed_reason VARCHAR(255) NULL AFTER disposed_at,
  ADD COLUMN disposed_by INT UNSIGNED NULL AFTER disposed_reason,
  ADD CONSTRAINT fk_fixed_assets_disposed_by FOREIGN KEY (disposed_by) REFERENCES users(id) ON DELETE SET NULL;
