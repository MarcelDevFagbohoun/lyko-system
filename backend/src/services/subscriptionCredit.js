'use strict';

/**
 * Valeur non utilisée de l'abonnement en cours : pour chaque paiement payé, non encore consommé par une montée en
 * gamme, dont la période se termine dans le futur, valeur × (jours restants depuis max(aujourd'hui, début de sa
 * période) / jours de sa période). La valeur d'un paiement = argent payé + crédit déjà appliqué sur lui (une montée
 * en gamme ne fait donc jamais perdre le crédit reporté). Gère les renouvellements d'avance (périodes bout à bout).
 * Utilisé par la montée en gamme (crédit) ET par l'annulation (remboursement) : un même calcul, une seule vérité.
 */
async function computeUnusedValue(conn, tenantId) {
  const [rows] = await conn.query(
    `SELECT id, amount, credit_applied, months,
            DATEDIFF(period_end, GREATEST(NOW(), DATE_SUB(period_end, INTERVAL months MONTH))) AS days_left,
            DATEDIFF(period_end, DATE_SUB(period_end, INTERVAL months MONTH)) AS days_total
     FROM subscription_payments
     WHERE tenant_id = :t AND status = 'paid' AND consumed_at IS NULL AND period_end IS NOT NULL AND period_end > NOW()`,
    { t: tenantId },
  );
  let base = 0; let original = 0; let days = 0;
  const ids = [];
  for (const r of rows) {
    const value = Number(r.amount) + Number(r.credit_applied);
    const left = Math.max(0, Number(r.days_left)); const total = Math.max(1, Number(r.days_total));
    base += Math.floor((value * left) / total);
    original += value;
    days += left;
    ids.push(r.id);
  }
  return { base, original, days, paymentIds: ids };
}

module.exports = { computeUnusedValue };
