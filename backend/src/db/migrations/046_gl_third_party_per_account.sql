-- Un même tiers réel (ex. un locataire) peut désormais avoir PLUSIEURS
-- lignes `gl_third_parties`, une par compte collectif concerné — sa créance
-- de loyer (411) et sa caution (165) sont deux dettes/créances DISTINCTES,
-- jamais le même sous-compte. La clé unique précédente (une ligne par
-- tiers, tous comptes confondus) l'empêchait structurellement ; trouvé lors
-- du branchement de `caution_recue`/`caution_restituee` sur un vrai tiers
-- (jusqu'ici, `requires_third_party` dans le seed n'était jamais réellement
-- appliqué par le moteur — écritures 165 sans aucun tiers attaché).
ALTER TABLE gl_third_parties
  DROP INDEX uq_gl_third_parties_source,
  ADD UNIQUE KEY uq_gl_third_parties_source (tenant_id, party_type, source_table, source_id, control_account_id);
