-- `TEXT` plafonne à 65 535 octets — déjà dépassable par un contrat complet
-- fortement accentué (chaque caractère accentué prend 2 octets en utf8mb4).
-- `MEDIUMTEXT` (jusqu'à 16 Mo) retire cette contrainte pour de bon, pour
-- N'IMPORTE QUELLE entreprise qui rédige son propre contrat, quelle que
-- soit sa longueur réaliste.
ALTER TABLE tenants
  MODIFY COLUMN contract_template MEDIUMTEXT NULL;
