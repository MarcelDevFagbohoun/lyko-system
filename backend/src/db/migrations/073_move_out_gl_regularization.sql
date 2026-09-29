-- Audit état des lieux (étape 48) : une sortie avec retenues sur caution ne
-- génère aucune écriture comptable automatique (le sort comptable d'une
-- retenue n'est pas tranché, voir migration précédente/`caution_restituee`)
-- et ne laissait jusqu'ici aucune trace durable — seul un message ponctuel à
-- la finalisation, facile à manquer. Ces deux colonnes permettent de la
-- signaler tant qu'elle n'a pas été traitée (« Mes tâches », routes/tasks.js)
-- et de la marquer réglée une fois l'écriture diverse passée à la main.
ALTER TABLE move_out_reports
  ADD COLUMN gl_regularized_at DATETIME NULL AFTER refund_payment_method,
  ADD COLUMN gl_regularized_by INT UNSIGNED NULL AFTER gl_regularized_at,
  ADD CONSTRAINT fk_move_out_reports_gl_regularized_by FOREIGN KEY (gl_regularized_by) REFERENCES users(id) ON DELETE SET NULL;
