-- Bascule explicite du module SYSCOHADA, indépendante de "a-t-il déjà été
-- initialisé" (présence de lignes dans gl_accounts). Nécessaire pour
-- permettre à une entreprise d'ACTIVER la comptabilité avancée, de la
-- SUSPENDRE (retour au suivi simple, sans rien supprimer), puis de la
-- RÉACTIVER (rattrapage des opérations manquées) sans jamais perdre
-- l'historique déjà généré — décision explicite de l'utilisateur : « les
-- deux comptabilités doivent être sur la plateforme, l'entreprise active
-- celle qu'elle veut, et peut migrer de l'une à l'autre sans perdre de
-- données ».
--
-- `isModuleActive()` (services/gl/glPostingService.js) lit désormais CETTE
-- colonne plutôt que de vérifier l'existence de comptes — un tenant
-- initialisé puis suspendu doit cesser de générer de nouvelles écritures
-- tout en gardant ses comptes/écritures passées consultables.
ALTER TABLE tenants
  ADD COLUMN gl_module_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER gl_expense_alert_threshold;
