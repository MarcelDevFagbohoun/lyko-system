-- Retour à la clôture par mois civil (étape 53, demande explicite de l'utilisateur, 2026-10-16) :
-- le choix du rythme de période (« jour fixe » / « libre », étapes 1 à 2c) est retiré de
-- l'interface et de l'API. Toute entreprise qui l'aurait déjà changé revient au mois calendaire.
-- Les colonnes restent en place (aucune donnée supprimée) ; `monthly_renter_archive` (archive du
-- mois à la clôture, retirée elle aussi) est conservée telle quelle mais n'est plus alimentée.
UPDATE tenants SET period_rhythm_mode = 'calendaire', period_start_day = NULL
  WHERE period_rhythm_mode <> 'calendaire';
