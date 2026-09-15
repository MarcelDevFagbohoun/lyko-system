-- État des lieux par zones (refonte) : la grille plate à 9 postes fixes
-- (bon/moyen/mauvais) est remplacée par une fiche organisée en zones
-- (Devanture, Chambre, Salon, Cuisine, Douche/Salle de bain — + zones/
-- éléments personnalisés), avec état BE/ME/SR, photo par élément, et un
-- cycle brouillon → finalisation (signatures locataire + agent, verrouillage).
--
-- La colonne `items` (JSON) change de FORME (nouvel objet {zones:[...]})
-- mais pas de TYPE : aucune migration de données n'est nécessaire, et les
-- fiches déjà existantes (anciennes, forme `[{label,condition,comment,...}]`)
-- restent lisibles telles quelles — normalisées à l'affichage
-- (`services/inspection.js`), jamais réécrites. Les fiches déjà existantes
-- n'ont pas de brouillon/signatures : DEFAULT 'finalized' les couvre sans
-- UPDATE explicite (MySQL applique le DEFAULT aux lignes déjà présentes).
ALTER TABLE move_in_reports
  ADD COLUMN status ENUM('draft','finalized') NOT NULL DEFAULT 'finalized' AFTER items,
  ADD COLUMN finalized_at DATETIME NULL AFTER status,
  ADD COLUMN finalized_by INT UNSIGNED NULL AFTER finalized_at,
  ADD COLUMN tenant_signature_path VARCHAR(255) NULL AFTER finalized_by,
  ADD COLUMN agent_signature_path VARCHAR(255) NULL AFTER tenant_signature_path,
  ADD CONSTRAINT fk_move_in_finalized_by FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE move_out_reports
  ADD COLUMN status ENUM('draft','finalized') NOT NULL DEFAULT 'finalized' AFTER items,
  ADD COLUMN finalized_at DATETIME NULL AFTER status,
  ADD COLUMN finalized_by INT UNSIGNED NULL AFTER finalized_at,
  ADD COLUMN tenant_signature_path VARCHAR(255) NULL AFTER finalized_by,
  ADD COLUMN agent_signature_path VARCHAR(255) NULL AFTER tenant_signature_path,
  ADD CONSTRAINT fk_move_out_finalized_by FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL;

-- Fiches déjà existantes : renseigne finalized_at/finalized_by rétroactivement
-- (elles étaient de facto finalisées dès leur création, l'ancien système
-- n'avait pas de brouillon) — cosmétique, mais évite un `finalized_at` NULL
-- sur une fiche marquée `finalized`.
UPDATE move_in_reports SET finalized_at = created_at, finalized_by = conducted_by WHERE status = 'finalized' AND finalized_at IS NULL;
UPDATE move_out_reports SET finalized_at = created_at, finalized_by = conducted_by WHERE status = 'finalized' AND finalized_at IS NULL;
