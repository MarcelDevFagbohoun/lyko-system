-- Amortissement avec ou sans prorata temporis (voir la note "À VALIDER" des
-- règles `amortissement_*` dans seedGeneralLedger.js) — décision explicite
-- de l'utilisateur : rendre ce choix configurable par entreprise plutôt que
-- de deviner une réponse unique. Défaut à 0 (comportement historique
-- inchangé : mois plein, jamais proratisé) pour ne rien changer aux
-- immobilisations déjà amorties avant ce réglage.
ALTER TABLE tenants
  ADD COLUMN gl_depreciation_prorata_temporis TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Si actif, le mois d''acquisition d''une immobilisation est proratisé au nombre de jours restants (jour d''acquisition inclus) plutôt qu''un mois plein';
