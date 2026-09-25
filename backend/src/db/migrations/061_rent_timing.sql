-- Convention de paiement du loyer (demande directe de l'utilisateur,
-- 2026-09-24) : certaines agences encaissent le loyer du mois M DANS le
-- mois M ('avance', comportement historique, reste le défaut) ; d'autres
-- ne l'encaissent qu'APRÈS, dans le mois M+1 ('terme_echu') — l'échéance de
-- retard doit alors se calculer sur le mois suivant, pas sur le mois
-- facturé lui-même. Réglable par bail, avec un défaut par entreprise qui
-- pré-remplit chaque nouveau bail.
ALTER TABLE tenants
  ADD COLUMN default_rent_timing ENUM('avance', 'terme_echu') NOT NULL DEFAULT 'avance' AFTER gl_module_enabled;

ALTER TABLE leases
  ADD COLUMN rent_timing ENUM('avance', 'terme_echu') NOT NULL DEFAULT 'avance' AFTER rent_due_day;
