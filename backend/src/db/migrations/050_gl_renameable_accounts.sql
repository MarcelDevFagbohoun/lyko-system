-- Comptes SYSCOHADA dont le NUMÉRO fait débat entre cabinets comptables
-- (aucun compte officiel dédié au mandat de gestion locative, ni à la
-- pénalité de retard) : `system_key` identifie ces comptes de façon STABLE
-- (jamais changée), indépendamment de leur `code` affiché — qui, lui,
-- devient renommable par le DG une fois l'avis de son propre
-- expert-comptable obtenu (voir routes/gl/glAccounts.js
-- `PATCH /renameable/:key`). Tout le reste du moteur (résolution des
-- rôles, rapports) doit résoudre ces deux comptes par `system_key`, jamais
-- par leur code littéral — pour que le renommage n'affecte que l'affichage.
ALTER TABLE gl_accounts
  ADD COLUMN system_key VARCHAR(40) NULL COMMENT 'Identifiant stable (ex. owner_control_account) — jamais modifié, contrairement à `code`' AFTER code,
  ADD UNIQUE KEY uq_gl_accounts_system_key (tenant_id, system_key);
