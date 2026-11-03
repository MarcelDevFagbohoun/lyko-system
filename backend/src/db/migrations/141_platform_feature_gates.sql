-- Verrou plateforme pour SYSCOHADA et FedaPay (demande utilisateur, 2026-11-03 : « on ajoute un menu
-- paramètre dans l'admin qui va nous permettre d'activer le syscohada et fedapay lorsque sera prêt,
-- lorsque sera activé il pourra l'utiliser »).
--
-- Contexte (étape 50 de l'audit, décision du jour) : Marcel a choisi de NE PAS lancer avec les moyens
-- de paiement ni SYSCOHADA — seule la Trésorerie & recette (comptabilité simple) doit être complète
-- au lancement. Ces deux modules restent déjà activables PAR TENANT (`tenants.gl_module_enabled`,
-- `tenants.fedapay_enabled`/`fedapay_collect_enabled`, voir routes/gl/glActivation.js et
-- routes/settings.js) — ce qui manquait est un verrou PLATEFORME, au-dessus de ça, pour empêcher
-- n'importe quelle entreprise cliente de les activer elle-même avant que Marcel ne juge que c'est prêt.
--
-- Portée volontairement étroite : ce verrou bloque seulement la TRANSITION « éteint → allumé » d'un
-- tenant qui ne l'a pas déjà. Un tenant qui a DÉJÀ le module actif (ex. Cabinet M Conseils en interne,
-- ou tout client qui aurait déjà activé FedaPay) n'est jamais affecté rétroactivement — on ne retire
-- rien à personne, on ferme seulement la porte aux nouvelles activations tant que c'est à 0.
CREATE TABLE IF NOT EXISTS platform_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  syscohada_enabled TINYINT(1) NOT NULL DEFAULT 0,
  fedapay_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  CONSTRAINT fk_platform_settings_updated_by FOREIGN KEY (updated_by) REFERENCES platform_admins(id) ON DELETE SET NULL
);

-- Ligne unique (id=1) : départ à 0/0 — ni l'un ni l'autre n'est proposé aux entreprises tant que Marcel
-- ne les active pas explicitement depuis le back-office.
INSERT INTO platform_settings (id, syscohada_enabled, fedapay_enabled)
VALUES (1, 0, 0)
ON DUPLICATE KEY UPDATE id = id;
