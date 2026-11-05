-- Demande directe de l'utilisateur (2026-11-05) : « si je veux changer le contenue du contrat » — le
-- texte des articles lui-même, personnalisable par entreprise (texte libre avec balises {{jeton}} à
-- remplir). Nouvelle colonne, DISTINCTE de l'ancienne `tenants.contract_template` (déjà inerte, voir
-- migration 070) : celle-ci est bien lue par le code (`services/leaseContractTemplate.js`). NULL = pas
-- de personnalisation, le rendu retombe sur `DEFAULT_CONTRACT_TEMPLATE`.
ALTER TABLE tenants
  ADD COLUMN lease_contract_template MEDIUMTEXT NULL AFTER contract_template;
