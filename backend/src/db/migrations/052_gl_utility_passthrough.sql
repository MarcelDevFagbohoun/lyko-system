-- % d'une charge SONEB/SBEE encaissée que le cabinet répercute intégralement
-- (contrepartie 411, comportement historique) plutôt que d'en garder une
-- part comme frais de gestion (706) — voir la note "À CONFIRMER" de la
-- règle `charge_locative_encaissee` dans seedGeneralLedger.js. Décision
-- explicite de l'utilisateur : configurable par entreprise. Défaut 100 (%)
-- = comportement historique inchangé (répercussion intégrale, aucune part
-- gardée par le cabinet).
ALTER TABLE tenants
  ADD COLUMN gl_utility_passthrough_percent TINYINT UNSIGNED NOT NULL DEFAULT 100
    COMMENT '% d''une charge SONEB/SBEE encaissée répercuté (411) ; le reste (706) est gardé par le cabinet comme frais de gestion',
  ADD CONSTRAINT chk_tenants_utility_passthrough CHECK (gl_utility_passthrough_percent BETWEEN 0 AND 100);
