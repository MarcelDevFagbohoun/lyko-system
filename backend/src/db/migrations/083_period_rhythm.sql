-- Refonte de la clôture (étape 1/5, 2026-10-16) : chaque entreprise pourra choisir son propre
-- rythme de période comptable au lieu du mois calendaire fixe — 'calendaire' (comme aujourd'hui,
-- 1er au dernier jour du mois), 'jour_fixe' (ex. le 5 au 4 du mois suivant, jour de départ choisi
-- par le DG) ou 'libre' (le DG saisit lui-même la date de fin à chaque clôture, pour une première
-- période irrégulière ou un cas exceptionnel).
--
-- Défaut 'calendaire' pour TOUTE entreprise existante : aucune interface n'expose encore ce
-- réglage (il n'apparaîtra qu'à l'étape 2, en même temps que le moteur de loyer généralisé — voir
-- le plan) — ces colonnes n'ont donc, pour l'instant, strictement aucun effet visible.
ALTER TABLE tenants
  ADD COLUMN period_rhythm_mode ENUM('calendaire', 'jour_fixe', 'libre') NOT NULL DEFAULT 'calendaire' AFTER default_rent_timing,
  ADD COLUMN period_start_day TINYINT UNSIGNED NULL AFTER period_rhythm_mode,
  ADD CONSTRAINT chk_tenants_period_start_day CHECK (period_rhythm_mode <> 'jour_fixe' OR period_start_day BETWEEN 1 AND 28);
