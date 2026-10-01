-- Haute #8 (étape 51) : aucune contrainte n'empêchait deux écritures ACTIVES pour le même
-- (tenant_id, source_table, source_id) — `idx_gl_entries_source` n'est qu'un index, pas une contrainte
-- d'unicité. Une activation/réactivation du module lancée deux fois en concurrence pour le même tenant
-- (double-clic, requête relancée) pouvait faire passer deux transactions la même vérification de
-- déduplication (`backfillOne`, SELECT avant `beginTransaction()`) avant que l'une des deux ne commite,
-- puis insérer chacune sa propre écriture pour la même opération réelle.
--
-- Une écriture `status='extournee'` (réversée) est délibérément EXCLUE de cette contrainte : c'est le
-- mécanisme normal de correction (`glReversalService.js`) qui réutilise volontairement le même
-- (source_table, source_id) pour la nouvelle écriture de remplacement, une fois l'ancienne réversée —
-- voir les paires `rent_payments#559`/`#635` (extourne un 2026-09-23 avec repost immédiat) déjà présentes
-- avant ce correctif. La colonne générée ci-dessous vaut NULL pour une écriture réversée (NULL n'entre
-- jamais en conflit dans une contrainte UNIQUE MySQL), donc ne compte pas dans l'unicité.
ALTER TABLE gl_entries
  ADD COLUMN source_id_active INT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN status = 'extournee' THEN NULL ELSE source_id END) STORED
    AFTER source_id,
  ADD UNIQUE KEY uq_gl_entries_active_source (tenant_id, source_table, source_id_active);
