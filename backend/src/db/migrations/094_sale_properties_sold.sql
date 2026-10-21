-- Vente d'un bien à vendre (demande utilisateur, 2026-10-18) : « le prix fixé peut s'améliorer » — le
-- bouton « Vendu » enregistre le prix FINAL (potentiellement différent du prix affiché), le
-- pourcentage de commission perçu par le cabinet et le mode de règlement. 100 % produit du CABINET,
-- jamais reversé au propriétaire éventuellement lié — même principe que les frais d'agence à l'entrée
-- d'un bail (`leases.entry_fee_amount`, voir routes/renters.js). Une fois vendu, la fiche devient
-- figée (voir routes/saleProperties.js) : plus aucune autre donnée n'est modifiable, comme un
-- mouvement d'argent déjà comptabilisé ailleurs dans l'application.
ALTER TABLE sale_properties
  ADD COLUMN final_price DECIMAL(14,0) NULL AFTER price,
  ADD COLUMN commission_percent DECIMAL(5,2) NULL AFTER final_price,
  ADD COLUMN commission_amount DECIMAL(14,0) NULL AFTER commission_percent,
  ADD COLUMN sold_payment_method ENUM('especes','mobile_money','virement','cheque') NULL AFTER commission_amount,
  ADD COLUMN sold_at DATE NULL AFTER sold_payment_method,
  ADD COLUMN sold_by INT UNSIGNED NULL AFTER sold_at,
  ADD CONSTRAINT fk_sale_properties_sold_by FOREIGN KEY (sold_by) REFERENCES users(id) ON DELETE SET NULL;
