-- Envoi automatique de la quittance après paiement, par WhatsApp : un lien
-- `wa.me` ne peut préremplir qu'un texte, jamais joindre un fichier — le
-- message doit donc contenir un LIEN vers la quittance. Le lien du portail
-- locataire ne convient pas ici : seule son empreinte est stockée (jamais le
-- texte en clair), impossible à reconstruire après coup pour l'envoyer avec
-- chaque nouvelle quittance ; et tous les locataires n'ont pas de portail actif.
--
-- `share_token` est donc stocké EN CLAIR (pas seulement son empreinte, à la
-- différence des tokens de portail/paiement) — déviation délibérée, justifiée
-- par un enjeu très inférieur : ce lien ne donne accès qu'À CETTE quittance
-- précise, en lecture seule, plafonné par `max_downloads` (étape 29) — jamais
-- un accès à l'ensemble du compte ni une action pouvant déplacer de l'argent.
-- Le stocker en clair permet de renvoyer plus tard exactement le même lien
-- (le personnel peut redemander la quittance d'un paiement ancien sans
-- invalider un lien déjà transmis) — impossible avec un stockage à sens unique.
ALTER TABLE document_issuances
  ADD COLUMN share_token VARCHAR(64) NULL AFTER verification_code,
  ADD UNIQUE KEY uk_document_issuances_share_token (share_token);
