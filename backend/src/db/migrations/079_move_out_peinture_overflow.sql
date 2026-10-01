-- Audit comptable (étape 51bis, Moyenne #6) : le dépassement de la retenue peinture (`peintureOverflow`,
-- au-delà de SA PROPRE caution, ajouté à la caution de LOYER — voir `leaseDeposits.js
-- checkAdditionalDepositRefunds`) était recalculé à chaque finalisation à partir des cautions
-- supplémentaires encore `held` — mais une CORRECTION (réouverture d'un PV déjà finalisé, voir
-- `/move-out-report/reopen`) les trouve déjà `returned` (réglées à la première finalisation, jamais
-- rejouées sur correction) : le recalcul retombait alors systématiquement à 0, perdant silencieusement un
-- dépassement pourtant légitimement facturé la première fois. Persisté désormais à la première
-- finalisation, puis relu (jamais recalculé) sur une correction.
ALTER TABLE move_out_reports
  ADD COLUMN peinture_overflow_amount DECIMAL(12,0) NOT NULL DEFAULT 0 AFTER peinture_deduction_note;
