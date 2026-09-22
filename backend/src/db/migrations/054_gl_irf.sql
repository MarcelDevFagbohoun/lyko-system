-- IRF (Impôt sur le Revenu Foncier — retenue à la source sur le loyer avant
-- reversement au propriétaire) — hypothèse #10 du document livré à
-- l'expert-comptable, jamais construite jusqu'ici. Décision explicite de
-- l'utilisateur : configurable par entreprise, taux saisi manuellement une
-- fois l'avis de l'expert-comptable obtenu. Défaut désactivé (0 retenu,
-- comportement historique inchangé) : `gl_irf_rate` reste à 0 tant que
-- `gl_irf_enabled` n'est pas activé, mais les deux sont vérifiés
-- indépendamment (activer sans taux défini ne retient rien non plus).
ALTER TABLE tenants
  ADD COLUMN gl_irf_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Si actif, une retenue IRF est prélevée sur chaque reversement au propriétaire',
  ADD COLUMN gl_irf_rate TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Taux de retenue IRF (%), appliqué uniquement si gl_irf_enabled',
  ADD CONSTRAINT chk_tenants_irf_rate CHECK (gl_irf_rate BETWEEN 0 AND 100);
