-- Vente d'immobilisation avec prix (option gl_asset_sale_proceeds) : prix et mode d'encaissement conservés
-- sur la fiche (NULL = sortie sans contrepartie, comportement historique).
ALTER TABLE fixed_assets
  ADD COLUMN disposed_sale_price DECIMAL(14,0) NULL AFTER disposed_reason,
  ADD COLUMN disposed_sale_method ENUM('especes','mobile_money','virement','cheque') NULL AFTER disposed_sale_price;

-- Le compte Mobile Money (552) devient renommable comme 4671/707 : identifiant stable pour les comptes existants.
UPDATE gl_accounts SET system_key = 'mobile_money_account' WHERE code = '552' AND system_key IS NULL;
