-- Ajustement demandé après validation : la clôture mensuelle (migration 015)
-- ferme le côté "fin" d'une période, mais rien ne bornait le côté "début" —
-- une entreprise qui démarre son suivi dans Lyko System à une date donnée
-- doit pouvoir l'indiquer, pour empêcher toute écriture antérieure (données
-- tenues ailleurs avant ce basculement). Contrairement à la clôture
-- (définitive), cette date reste modifiable par le DG à tout moment : ce
-- n'est pas un acte de traçabilité comptable, juste un paramètre d'entreprise.
-- La lecture des périodes anciennes (avant ou après cette date) n'est jamais
-- restreinte — seule la création/modification/suppression d'écritures l'est
-- (appliqué via `assertPeriodOpen`, déjà appelé aux 4 points d'écriture
-- financière existants).
ALTER TABLE tenants
  ADD COLUMN accounting_start_date DATE NULL AFTER signature_path,
  ADD COLUMN accounting_start_date_set_by INT UNSIGNED NULL AFTER accounting_start_date,
  ADD COLUMN accounting_start_date_set_at DATETIME NULL AFTER accounting_start_date_set_by,
  ADD CONSTRAINT fk_tenants_accounting_start_date_set_by
    FOREIGN KEY (accounting_start_date_set_by) REFERENCES users(id) ON DELETE RESTRICT;
