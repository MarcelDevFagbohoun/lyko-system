-- Rétro-compatibilité (indispensable) : la migration précédente (097) ajoute un blocage de
-- connexion pour tout DG dont `email_verified_at IS NULL` — sans ce correctif, TOUTE entreprise
-- déjà inscrite AVANT cette fonctionnalité (KIko Store, INFINITY IMMO BENIN, et tout cabinet
-- réel futur) se retrouverait instantanément verrouillée hors de son propre compte à la prochaine
-- connexion, alors que ces comptes sont parfaitement légitimes et n'ont simplement jamais eu à
-- vérifier un email qui n'existait pas encore comme exigence. On les considère déjà vérifiés
-- (date de création du compte, faute de mieux) — seules les NOUVELLES inscriptions, à partir de
-- maintenant, passent réellement par le code à 8 chiffres.
UPDATE users SET email_verified_at = created_at WHERE role = 'dg' AND email_verified_at IS NULL;
