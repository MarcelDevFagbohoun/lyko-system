-- Ajustement demandé après validation : la clôture d'un mois n'est plus une
-- date choisie à l'aveugle. Un mois devient « clôturable » automatiquement
-- une fois que l'échéance la plus tardive des baux actifs de ce mois, plus
-- une marge de sécurité, est passée (calculé à la volée par
-- `services/accountingPeriods.js` — rien à stocker pour ça). Le DG garde la
-- possibilité de clôturer plus tôt (gestion humaine réelle), mais cette
-- clôture anticipée doit rester tracée : `forced`.
ALTER TABLE accounting_periods
  ADD COLUMN forced TINYINT(1) NOT NULL DEFAULT 0 AFTER closed_by;
