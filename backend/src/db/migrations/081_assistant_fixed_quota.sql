-- Quota mensuel de l'assistant IA : décision explicite de l'utilisateur, fixé à 150 messages/mois
-- pour toutes les entreprises, réglé en backend (constante) plutôt que configurable par entreprise
-- via l'interface/l'API. La colonne par-entreprise devient donc inutile.
ALTER TABLE tenants
  DROP COLUMN assistant_monthly_quota;
