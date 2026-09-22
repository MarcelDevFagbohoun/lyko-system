-- Moment où la commission du cabinet est comptabilisée en produit : dès
-- l'encaissement du loyer (comportement historique, hypothèse initiale) ou
-- seulement au reversement effectif au propriétaire — voir la note
-- "HYPOTHÈSE MAJEURE À VALIDER" de la règle `loyer_encaisse` dans
-- seedGeneralLedger.js. Décision explicite de l'utilisateur : configurable
-- par entreprise. Défaut 'encaissement' = comportement historique inchangé.
ALTER TABLE tenants
  ADD COLUMN gl_commission_timing ENUM('encaissement', 'reversement') NOT NULL DEFAULT 'encaissement'
    COMMENT 'Moment de comptabilisation de la commission (706) : à l''encaissement du loyer, ou au reversement au propriétaire';
