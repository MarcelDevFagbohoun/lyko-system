-- Correctif de la migration 017, trouvé via le nettoyage obligatoire d'un
-- tenant jetable (échec ER_ROW_IS_REFERENCED_2) : `accounting_start_date_set_by`
-- vit directement sur `tenants` (pas sur une table fille) et référence
-- `users`, alors que `users.tenant_id` référence `tenants` en CASCADE — cycle
-- tenants → users → tenants. Avec ON DELETE RESTRICT, MySQL ne peut jamais
-- supprimer un tenant : la suppression cascade des `users` se heurte à la
-- ligne `tenants` qui les référence encore (pas encore supprimée elle-même).
-- ON DELETE SET NULL casse le cycle — perdre la trace de "qui a défini cette
-- date en dernier" est un compromis acceptable pour un champ qui vit sur
-- `tenants` (une seule ligne par entreprise), contrairement à `deleted_by`
-- sur `expenses`/`utility_charges` ou `closed_by` sur `accounting_periods`,
-- qui vivent sur des tables filles et n'ont jamais ce problème.
--
-- Deux instructions séparées : MySQL refuse de redéclarer un nom de
-- contrainte dans le même ALTER TABLE que celui qui le supprime.
ALTER TABLE tenants DROP FOREIGN KEY fk_tenants_accounting_start_date_set_by;

ALTER TABLE tenants
  ADD CONSTRAINT fk_tenants_accounting_start_date_set_by
    FOREIGN KEY (accounting_start_date_set_by) REFERENCES users(id) ON DELETE SET NULL;
