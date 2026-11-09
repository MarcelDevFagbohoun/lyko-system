-- La migration 143 a ajouté 'essai-gratuit' à tenant_subscriptions.plan_key mais pas à l'ENUM
-- upgraded_from_plan de subscription_payments : tout premier achat payant depuis l'essai gratuit (le cas de
-- toute nouvelle entreprise, puisque l'essai gratuit est accordé automatiquement à l'inscription) y est classé
-- comme une « montée en gamme » depuis essai-gratuit, et l'INSERT échouait ("Data truncated for column
-- 'upgraded_from_plan'"), bloquant le paiement. On aligne l'ENUM sur celui de plan_key.
ALTER TABLE subscription_payments
  MODIFY upgraded_from_plan ENUM('demarrage','pro','entreprise','essai-gratuit') NULL;
