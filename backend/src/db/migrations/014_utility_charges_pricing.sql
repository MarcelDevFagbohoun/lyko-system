-- Étape 9 (ajustement demandé après validation) : le montant d'une charge
-- SONEB/SBEE doit être calculé automatiquement (consommation × prix
-- unitaire), pas saisi à la main ; les index de relevé deviennent
-- obligatoires (ils servent au calcul, plus seulement d'information) ; la
-- période devient un intervalle de dates (choisi au calendrier) plutôt
-- qu'un libellé libre.
--
-- Une seule ligne existait en base (tenant réel, période "31 Aout -31 sept"
-- — date invalide, manifestement un essai — montant 300 FCFA pour 46 unités
-- de consommation, un prix par unité qui ne correspond à aucun tarif réel) :
-- supprimée plutôt que de lui fabriquer rétroactivement des dates/un prix
-- unitaire plausibles.
DELETE FROM utility_charges;

ALTER TABLE utility_charges
  ADD COLUMN period_start DATE NOT NULL AFTER utility_type,
  ADD COLUMN period_end DATE NOT NULL AFTER period_start,
  DROP COLUMN period_label,
  MODIFY COLUMN reading_start INT UNSIGNED NOT NULL,
  MODIFY COLUMN reading_end INT UNSIGNED NOT NULL,
  ADD COLUMN unit_price DECIMAL(10,2) NOT NULL AFTER reading_end;
