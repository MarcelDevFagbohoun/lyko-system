-- Corrige un vrai biais : le calcul de retard partait TOUJOURS de la date
-- d'ENTRÉE (`start_date`), jamais de la date d'enregistrement sur la
-- plateforme — un locataire entré en 2025, enregistré aujourd'hui sans
-- aucun historique de paiement saisi, ressortait comme devant des mois de
-- loyer qu'il n'a jamais dus en réalité. Demande directe de l'utilisateur.
--
-- Décision "Option C" (discutée avec l'utilisateur) :
--   1. Le calcul (`computeArrears`, services/rentTracking.js) plafonne
--      désormais TOUJOURS le point de départ du suivi à la date
--      d'enregistrement (`leases.created_at`) quand elle est postérieure à
--      `start_date` — comportement par défaut, aucune saisie requise.
--   2. Cette colonne couvre le dernier résidu (le mois de l'enregistrement
--      lui-même) : cochée à la création du bail si l'agent déclare
--      explicitement le locataire à jour, elle avance le point de départ
--      d'un mois de plus.
ALTER TABLE leases
  ADD COLUMN up_to_date_at_onboarding TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Locataire déclaré à jour (aucun impayé) au moment de son enregistrement sur la plateforme'
    AFTER opening_debt_amount;
