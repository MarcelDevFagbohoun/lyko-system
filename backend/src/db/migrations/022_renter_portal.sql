-- Portail locataire (idée « innovante » validée avec l'utilisateur) : accès
-- en lecture à ses propres paiements/quittances/attestation, et signalement
-- direct d'un incident — sans compte employé, par un lien secret unique.
--
-- Décision actée : pas de mot de passe, pas d'OTP SMS/WhatsApp (aucune
-- Business API disponible dans ce projet) — un token aléatoire long (256
-- bits), donné une seule fois à l'agent/DG pour transmission manuelle via le
-- bouton WhatsApp déjà existant. Jamais stocké en clair : seule son empreinte
-- SHA-256 est conservée, exactement comme les refresh tokens (étape 2).
--
-- Un token par LOCATAIRE (pas par bail) : le lien reste valable après un
-- renouvellement de bail, inutile d'en renvoyer un nouveau à chaque fois.
ALTER TABLE renters
  ADD COLUMN portal_token_hash CHAR(64) NULL AFTER notes,
  ADD UNIQUE KEY uq_renters_portal_token (portal_token_hash);

-- Une plainte signalée depuis le portail n'a pas d'auteur employé : `created_by`
-- devient nullable pour ce cas précis, et `reported_via_portal` distingue
-- l'origine pour l'affichage (« Signalé par le locataire » plutôt qu'un nom).
ALTER TABLE complaints
  MODIFY COLUMN created_by INT UNSIGNED NULL,
  ADD COLUMN reported_via_portal TINYINT(1) NOT NULL DEFAULT 0 AFTER created_by;
