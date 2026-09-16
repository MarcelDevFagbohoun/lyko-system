-- Audit sécurité : l'email employé était unique GLOBALEMENT
-- (`uq_users_email`, 001_auth_core.sql), alors qu'il ne sert jamais à la
-- connexion (seul `phone` l'est, unique globalement à raison — la connexion
-- ne connaît pas encore l'entreprise avant de trouver la ligne). Cette
-- contrainte globale laissait un DG sonder, via le 409 de création/
-- modification d'employé, si un email appartient à un employé d'une AUTRE
-- entreprise cliente. Remplacée par une contrainte par entreprise : aucune
-- perte de données possible (une contrainte globale déjà respectée respecte
-- automatiquement la contrainte composite, plus permissive).
ALTER TABLE users
  DROP INDEX uq_users_email,
  ADD UNIQUE KEY uq_users_tenant_email (tenant_id, email);
