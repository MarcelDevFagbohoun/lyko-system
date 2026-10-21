-- Archive des propriétaires (demande utilisateur, 2026-10-18) : contrairement à un bail, rien
-- n'indiquait jusqu'ici qu'un propriétaire avait quitté le cabinet — décision explicite de
-- l'utilisateur : action volontaire du DG (jamais automatique sur « 0 Bien »), avec motif, bloquée
-- tant qu'il lui reste au moins un Bien rattaché (voir routes/owners.js `POST /:id/end-mandate`).
-- Une fois le mandat terminé, sa fiche devient en LECTURE SEULE (décision explicite) — `reactivate-mandate`
-- (DG) est l'unique porte de sortie, pour un règlement tardif par exemple.
ALTER TABLE owners
  ADD COLUMN mandate_ended_at DATETIME NULL,
  ADD COLUMN mandate_ended_by INT UNSIGNED NULL,
  ADD COLUMN mandate_end_reason TEXT NULL,
  ADD CONSTRAINT fk_owners_mandate_ended_by FOREIGN KEY (mandate_ended_by) REFERENCES users(id) ON DELETE SET NULL;
