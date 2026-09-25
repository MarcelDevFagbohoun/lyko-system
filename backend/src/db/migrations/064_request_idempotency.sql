-- Étape 36 — Clé d'idempotence des paiements de loyer.
--
-- Chaque envoi du formulaire « Enregistrer un paiement » porte une clé unique
-- (générée par le navigateur à l'ouverture du formulaire, conservée dans la file
-- hors-ligne). Le serveur la « réclame » dans la MÊME transaction que le paiement :
-- un vrai doublon (réponse perdue puis rejeu de la file, double onglet, nouvelle
-- tentative réseau) est refusé, alors que deux paiements VOULUS — même de montants
-- égaux, même jour, même mode — ne sont jamais confondus. Remplace l'heuristique
-- « même mois, même date, même mode sous 2 minutes », qui refusait à tort de payer
-- le reste d'un mois partiel juste après un premier versement.
--
-- Une clé n'est consommée que si le paiement est réellement enregistré (l'insertion
-- est annulée avec la transaction en cas d'échec) : réessayer après une erreur est
-- toujours possible avec la même clé.

CREATE TABLE request_idempotency_keys (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  scope VARCHAR(30) NOT NULL,
  idem_key VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency (tenant_id, scope, idem_key),
  KEY idx_idempotency_created (created_at),
  CONSTRAINT fk_idempotency_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
