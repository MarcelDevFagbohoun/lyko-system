-- Caution remboursable ou non (demande utilisateur, 2026-11-12) : par défaut remboursable (1),
-- comportement historique inchangé pour tous les baux/cautions existants. Une caution marquée NON
-- remboursable n'entre JAMAIS dans le décompte de sortie — acquise au propriétaire d'office, quel que
-- soit l'état du logement à la sortie (voir moveOutReport.js pour la caution de loyer,
-- leaseDeposits.js pour les cautions supplémentaires SBEE/SONEB/peinture).
ALTER TABLE leases
  ADD COLUMN deposit_refundable TINYINT(1) NOT NULL DEFAULT 1 AFTER deposit_amount;

ALTER TABLE lease_deposits
  ADD COLUMN refundable TINYINT(1) NOT NULL DEFAULT 1 AFTER amount;
