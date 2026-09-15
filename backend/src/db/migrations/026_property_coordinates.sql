-- Étape 13 (idée n°10) : carte du portefeuille — coordonnées GPS d'un Bien,
-- placées manuellement sur une carte (jamais un géocodage automatique de
-- l'adresse : au Bénin, une adresse est souvent un simple nom de quartier
-- « Fidjrossè, Cotonou », trop imprécis pour un géocodeur). Nullable : un
-- Bien existant reste affiché en liste sans jamais être bloqué tant que
-- personne n'a placé son repère.
ALTER TABLE properties
  ADD COLUMN latitude DECIMAL(10,7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude;
