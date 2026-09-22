-- Correction : `gl_entry_lines.payment_method` avait été créé avec des
-- valeurs par opérateur (mobile_money_mtn/moov/celtis) qui contredisaient
-- l'hypothèse n°4 documentée (mobile money générique en V1, faute de
-- distinction d'opérateur dans les tables existantes — rent_payments,
-- expenses... n'ont qu'une seule valeur "mobile_money"). Alignement sur les
-- valeurs RÉELLEMENT utilisées partout ailleurs dans le projet, "banque"
-- renommé "virement"/"cheque" séparés pour rester fidèle à l'existant.
-- Aucune donnée réelle dans cette colonne à ce jour (table encore vide).
ALTER TABLE gl_entry_lines
  MODIFY COLUMN payment_method ENUM('especes','mobile_money','virement','cheque','kkiapay') NULL COMMENT 'Renseigné uniquement sur les lignes de trésorerie (classe 5) — mêmes valeurs que rent_payments.payment_method';
