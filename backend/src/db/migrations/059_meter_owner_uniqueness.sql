-- Un même numéro de compteur SONEB/SBEE (compteur physique réel) ne doit
-- jamais être attribué à deux Unités différentes de la même entreprise —
-- aucun doublon existant trouvé (vérifié avant migration), sûr à appliquer
-- directement. NULL reste multi-valué sous UNIQUE (unité sans compteur suivi).
ALTER TABLE property_units
  ADD UNIQUE KEY uq_units_soneb_meter (tenant_id, soneb_meter_number),
  ADD UNIQUE KEY uq_units_sbee_meter (tenant_id, sbee_meter_number);

-- Téléphone d'un propriétaire : aucun doublon existant trouvé, sûr à
-- appliquer directement. `renters.phone` n'a PAS reçu la même contrainte —
-- un doublon réel existe déjà sur KIko Store (deux locataires actifs
-- partagent un numéro) ; à corriger avec l'utilisateur avant de pouvoir
-- migrer cette table aussi. Le contrôle applicatif (routes/renters.js) rejette
-- déjà tout NOUVEAU doublon entre-temps.
ALTER TABLE owners
  ADD UNIQUE KEY uq_owners_phone (tenant_id, phone);
