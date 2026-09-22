-- Demande directe de l'utilisateur : le DG doit pouvoir choisir comment
-- s'appellent les 3 rôles chez lui (ex. « Agent » → « Commercial »), dans
-- un menu déroulant avec plusieurs propositions — jamais un champ libre.
-- Les permissions ne changent JAMAIS : uniquement le libellé affiché,
-- partout (journal, documents, badge...) y compris à la connexion employé.
-- NULL = valeur par défaut (voir `constants/roles.js`).
ALTER TABLE tenants
  ADD COLUMN dg_title VARCHAR(60) NULL AFTER logo_path,
  ADD COLUMN comptable_title VARCHAR(60) NULL AFTER dg_title,
  ADD COLUMN agent_title VARCHAR(60) NULL AFTER comptable_title;
