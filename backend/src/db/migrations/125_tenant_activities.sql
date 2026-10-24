-- Activités de l'entreprise (liste libre, saisie dans Paramètres) : affichées dans l'en-tête des contrats,
-- états des lieux, quittances et autres documents, après les numéros RCCM / IFU. JSON : ["Gestion locative", ...].
ALTER TABLE tenants
  ADD COLUMN activities TEXT NULL AFTER contact_phone;
