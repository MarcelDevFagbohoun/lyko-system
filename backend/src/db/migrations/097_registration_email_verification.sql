-- Vérification d'email obligatoire à l'inscription du DG (demande utilisateur, 2026-10-18) :
-- choix d'un email + d'un pays (détermine le format de téléphone validé), code à 8 chiffres
-- envoyé par email (Resend) à saisir pour activer le compte, email de bienvenue envoyé ~2
-- minutes après la vérification. Portée volontairement limitée au compte DG créé à
-- l'inscription (`routes/auth.js`) — les comptes employés (comptable/agent, `routes/employees.js`)
-- gardent un email facultatif et jamais vérifié, aucun changement pour eux.
--
-- Le code est haché (bcrypt, comme les mots de passe) avant stockage — jamais en clair,
-- contrairement au code de vérification PUBLIC des documents PDF (`document_issuances`, non
-- secret par conception). `email_verification_attempts` plafonne les essais (verrouillage
-- applicatif, voir routes/auth.js) ; `welcome_email_due_at`/`welcome_email_sent_at` pilotent
-- l'envoi différé via une tâche planifiée (`jobs/welcomeEmailJob.js`) plutôt qu'un minuteur en
-- mémoire qui ne survivrait pas à un redémarrage du serveur.
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL AFTER email,
  ADD COLUMN email_verification_code_hash VARCHAR(100) NULL AFTER email_verified_at,
  ADD COLUMN email_verification_expires_at DATETIME NULL AFTER email_verification_code_hash,
  ADD COLUMN email_verification_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verification_expires_at,
  ADD COLUMN welcome_email_due_at DATETIME NULL AFTER email_verification_attempts,
  ADD COLUMN welcome_email_sent_at DATETIME NULL AFTER welcome_email_due_at;

-- Pays de l'entreprise (demande utilisateur) — sélectionné à l'inscription, détermine le
-- format de téléphone attendu pour le DG (voir constants/countries.js + validators/auth.js).
-- NULL pour toutes les entreprises déjà inscrites avant cette étape (Bénin de fait, jamais
-- demandé explicitement jusqu'ici).
ALTER TABLE tenants ADD COLUMN country VARCHAR(2) NULL AFTER contact_phone;
