-- Traçabilité réelle de la caution (dépôt de garantie) — jusqu'ici,
-- `leases.deposit_amount`/`deposit_status` étaient purement déclaratifs :
-- aucun mouvement de trésorerie réel n'était jamais enregistré ni pour son
-- encaissement, ni pour sa restitution (trou identifié lors de la revue de
-- complétude du module comptable SYSCOHADA). Ces colonnes permettent de
-- brancher les règles `caution_recue`/`caution_restituee` (déjà présentes
-- dans le seed depuis le livrable 3) sur un événement réel et daté.
ALTER TABLE leases
  ADD COLUMN deposit_received_at DATE NULL AFTER deposit_status,
  ADD COLUMN deposit_received_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL AFTER deposit_received_at;

-- Mode de règlement de la restitution — nécessaire pour générer sa
-- contrepartie comptable (ligne de trésorerie de `caution_restituee`).
ALTER TABLE move_out_reports
  ADD COLUMN refund_payment_method ENUM('especes', 'mobile_money', 'virement', 'cheque') NULL AFTER net_refund;
