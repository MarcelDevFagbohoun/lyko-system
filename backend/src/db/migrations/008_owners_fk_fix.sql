-- Correctif de la migration 007 : fk_properties_owner n'avait pas
-- ON DELETE CASCADE. En cascade de suppression d'un tenant, MySQL supprime
-- properties ET owners en parallèle (tous deux liés à tenant_id en CASCADE) ;
-- sans CASCADE sur owner_id, la suppression des owners échoue tant que des
-- properties les référencent encore.
--
-- Deux instructions séparées : MySQL refuse de redéclarer un nom de
-- contrainte dans le même ALTER TABLE que celui qui le supprime.
ALTER TABLE properties DROP FOREIGN KEY fk_properties_owner;

ALTER TABLE properties
  ADD CONSTRAINT fk_properties_owner FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;
