-- Étape 30 — Suivi du paiement de la facture mère SONEB/SBEE.
--
-- Le propriétaire règle lui-même la facture mère à la SONEB/SBEE ; le cabinet
-- l'enregistre ici (montant réellement payé, date, mode, note) pour pouvoir
-- faire le point avec ce qu'il a encaissé chez les locataires. C'est un
-- simple mémo : aucun mouvement de caisse du cabinet, donc aucun impact sur
-- la comptabilité (ni simple, ni avancée) et aucun verrou de période.
--
-- Un seul règlement par relevé (corrigeable / annulable) : la facture mère
-- est un document unique par période et par fluide.

ALTER TABLE utility_reading_batches
  ADD COLUMN main_paid_amount DECIMAL(12,0) NULL AFTER main_invoice_amount,
  ADD COLUMN main_paid_at DATE NULL AFTER main_paid_amount,
  ADD COLUMN main_paid_method ENUM('especes','mobile_money','virement','cheque') NULL AFTER main_paid_at,
  ADD COLUMN main_paid_notes VARCHAR(255) NULL AFTER main_paid_method,
  ADD COLUMN main_paid_recorded_by INT UNSIGNED NULL AFTER main_paid_notes,
  ADD COLUMN main_paid_recorded_at DATETIME NULL AFTER main_paid_recorded_by,
  ADD CONSTRAINT fk_batch_main_paid_by FOREIGN KEY (main_paid_recorded_by) REFERENCES users(id) ON DELETE SET NULL;
