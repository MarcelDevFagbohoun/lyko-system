-- Demande directe de l'utilisateur (2026-11-06) : « il faut que l'entête du contrat soit blanc qu'il
-- puisse contenir tous les logos » — l'entreprise veut imprimer le contrat sur son propre papier à
-- en-tête déjà pré-imprimé (pouvant porter plusieurs logos), sans que notre bloc d'identité (nom, logo,
-- RCCM/IFU, activités) ne s'y superpose. Voir services/pdf.js `drawContractHeader`.
ALTER TABLE tenants
  ADD COLUMN contract_blank_letterhead TINYINT(1) NOT NULL DEFAULT 0 AFTER lease_contract_template;
