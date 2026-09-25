'use strict';

/**
 * Étape 31 — Alertes du suivi des charges SONEB/SBEE : tout ce qui, faute
 * d'action, fait perdre de l'argent au propriétaire ou laisse le carnet
 * incomplet. Calculées à la volée (aucune table) à partir des données
 * existantes — jamais dupliquées, toujours à jour.
 *
 *  - releve_manquant           : le relevé du mois précédent n'a pas été fait
 *  - releve_a_valider          : un relevé traîne en brouillon
 *  - facture_mere_non_declaree : relevé validé mais paiement de la facture mère jamais déclaré
 *  - ecart_eleve               : écart compteur principal / décompteurs anormal (fuite, erreur de relevé)
 *  - charges_a_reverser        : des charges encaissées attendent d'être reversées au propriétaire
 *
 * `scopeAgentId` (étape 14) : un agent restreint ne voit que les alertes de
 * ses propres Biens, et JAMAIS celles de reversement (solde de bout en bout
 * d'un propriétaire — même règle que le solde séquestre des loyers).
 */

const { pool } = require('../config/db');
const { UTILITY_TYPES, UTILITY_TYPE_KEYS, UTILITY_ALERT_RULES: RULES, DIFFERENCE_ALERT_PCT } = require('../constants/charges');
const { getChargeAccounts, getOldestUnremittedDates } = require('./utilityRemittance');

const UTILITY_LABEL = Object.fromEntries(UTILITY_TYPES.map((t) => [t.key, t.label.split(' ')[0]]));
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const SEVERITY_ORDER = { danger: 0, warning: 1, info: 2 };

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const formatFcfa = (n) => `${Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_FR[m - 1]} ${y}`;
};
// « de septembre 2026 » mais « d'août 2026 », « d'avril 2026 », « d'octobre 2026 ».
const deMonth = (ym) => {
  const label = monthLabel(ym);
  return /^[aeiou]/i.test(label) ? `d'${label}` : `de ${label}`;
};
const addMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthDiff = (later, earlier) => {
  const [y1, m1] = later.split('-').map(Number);
  const [y2, m2] = earlier.split('-').map(Number);
  return (y1 - y2) * 12 + (m1 - m2);
};
const daysBetween = (laterIso, earlierIso) =>
  Math.round((Date.parse(`${laterIso}T00:00:00Z`) - Date.parse(`${earlierIso}T00:00:00Z`)) / 86_400_000);

async function releveManquantAlerts(tenantId, today, scopeAgentId) {
  const day = Number(today.slice(8, 10));
  if (day < RULES.RELEVE_EXPECTED_FROM_DAY) return [];

  const currentMonth = today.slice(0, 7);
  const previousMonth = addMonths(currentMonth, -1);
  const alerts = [];

  for (const ut of UTILITY_TYPE_KEYS) {
    // `ut` vient de la constante UTILITY_TYPE_KEYS (jamais d'une entrée utilisateur) — sûr à interpoler.
    const params = { tenantId, ut };
    let scopeClause = '';
    if (scopeAgentId != null) {
      scopeClause = 'AND p.agent_id = :scopeAgentId';
      params.scopeAgentId = scopeAgentId;
    }
    const [rows] = await pool.query(
      `SELECT p.id, p.code, p.created_at, o.name AS owner_name,
              (SELECT MAX(b.period_end) FROM utility_reading_batches b
                 WHERE b.property_id = p.id AND b.utility_type = :ut) AS last_period_end,
              (SELECT COUNT(*) FROM property_units u
                 JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
                 WHERE u.property_id = p.id AND u.${ut}_meter_number IS NOT NULL AND u.${ut}_meter_number <> '') AS billable_units
       FROM properties p
       JOIN owners o ON o.id = p.owner_id
       WHERE p.tenant_id = :tenantId AND p.${ut}_submetered = 1 ${scopeClause}
       ORDER BY p.code`,
      params,
    );

    for (const r of rows) {
      if (Number(r.billable_units) === 0) continue; // rien à facturer : aucun relevé attendu
      const lastEnd = isoDate(r.last_period_end);
      // Couvert : un relevé (même brouillon) se termine dans le mois précédent ou après.
      if (lastEnd && lastEnd.slice(0, 7) >= previousMonth) continue;
      // Bien créé ce mois-ci : aucun relevé du mois précédent ne pouvait exister.
      if (!lastEnd && isoDate(r.created_at).slice(0, 7) >= currentMonth) continue;

      const missingMonths = lastEnd ? monthDiff(previousMonth, lastEnd.slice(0, 7)) : null;
      alerts.push({
        key: `releve_manquant:${r.id}:${ut}`,
        type: 'releve_manquant',
        severity: missingMonths != null && missingMonths >= 2 ? 'danger' : 'warning',
        title: `Relevé ${UTILITY_LABEL[ut]} ${deMonth(previousMonth)} non fait — ${r.code}`,
        detail: lastEnd
          ? `Dernier relevé jusqu'au ${lastEnd}. Sans relevé, les locataires ne sont pas facturés et le propriétaire avance la facture.`
          : `Aucun relevé ${UTILITY_LABEL[ut]} enregistré pour ce Bien alors que le sous-comptage est activé.`,
        propertyId: r.id,
        propertyCode: r.code,
        ownerName: r.owner_name,
        utilityType: ut,
        href: `/espace/charges/releves?propertyId=${r.id}`,
      });
    }
  }
  return alerts;
}

async function draftBatchAlerts(tenantId, today, scopeAgentId) {
  const params = { tenantId, today, days: RULES.DRAFT_BATCH_DAYS };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT b.id, b.utility_type, b.period_start, p.id AS property_id, p.code, o.name AS owner_name,
            DATEDIFF(:today, DATE(b.created_at)) AS age_days
     FROM utility_reading_batches b
     JOIN properties p ON p.id = b.property_id
     JOIN owners o ON o.id = p.owner_id
     WHERE b.tenant_id = :tenantId AND b.status = 'brouillon'
       AND DATEDIFF(:today, DATE(b.created_at)) >= :days ${scopeClause}
     ORDER BY b.created_at`,
    params,
  );
  return rows.map((r) => ({
    key: `releve_a_valider:${r.id}`,
    type: 'releve_a_valider',
    severity: 'warning',
    title: `Relevé ${UTILITY_LABEL[r.utility_type]} ${deMonth(isoDate(r.period_start).slice(0, 7))} à valider — ${r.code}`,
    detail: `En brouillon depuis ${r.age_days} jours : tant qu'il n'est pas validé, les locataires ne reçoivent pas leur facture.`,
    propertyId: r.property_id,
    propertyCode: r.code,
    ownerName: r.owner_name,
    batchId: r.id,
    utilityType: r.utility_type,
    daysLate: Number(r.age_days),
    href: `/espace/charges/releve/${r.id}`,
  }));
}

async function mainPaymentAlerts(tenantId, today, scopeAgentId) {
  const params = { tenantId, today, days: RULES.MAIN_PAYMENT_DAYS };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT b.id, b.utility_type, b.period_start, b.main_invoice_amount, p.id AS property_id, p.code, o.name AS owner_name,
            DATEDIFF(:today, DATE(b.validated_at)) AS age_days
     FROM utility_reading_batches b
     JOIN properties p ON p.id = b.property_id
     JOIN owners o ON o.id = p.owner_id
     WHERE b.tenant_id = :tenantId AND b.status = 'valide' AND b.main_paid_amount IS NULL
       AND DATEDIFF(:today, DATE(b.validated_at)) >= :days ${scopeClause}
     ORDER BY b.validated_at`,
    params,
  );
  return rows.map((r) => ({
    key: `facture_mere_non_declaree:${r.id}`,
    type: 'facture_mere_non_declaree',
    severity: Number(r.age_days) >= RULES.MAIN_PAYMENT_URGENT_DAYS ? 'danger' : 'warning',
    title: `Facture mère ${UTILITY_LABEL[r.utility_type]} ${deMonth(isoDate(r.period_start).slice(0, 7))} non déclarée payée — ${r.code}`,
    detail: `${formatFcfa(r.main_invoice_amount)} à régler par ${r.owner_name}. Validé depuis ${r.age_days} jours : déclarez le paiement pour faire le point.`,
    propertyId: r.property_id,
    propertyCode: r.code,
    ownerName: r.owner_name,
    batchId: r.id,
    utilityType: r.utility_type,
    amount: Number(r.main_invoice_amount),
    daysLate: Number(r.age_days),
    href: `/espace/charges/releve/${r.id}`,
  }));
}

async function anomalyAlerts(tenantId, today, scopeAgentId) {
  const params = { tenantId, today, days: RULES.ANOMALY_WINDOW_DAYS };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = 'AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT b.id, b.utility_type, b.period_start, b.main_reading_start, b.main_reading_end, b.main_invoice_amount,
            p.id AS property_id, p.code, o.name AS owner_name,
            COALESCE(SUM(r.reading_end - r.reading_start), 0) AS sub_consumption,
            COALESCE(SUM(r.amount), 0) AS sub_amount
     FROM utility_reading_batches b
     JOIN properties p ON p.id = b.property_id
     JOIN owners o ON o.id = p.owner_id
     LEFT JOIN utility_readings r ON r.batch_id = b.id
     WHERE b.tenant_id = :tenantId AND b.status = 'valide'
       AND b.main_reading_start IS NOT NULL AND b.main_reading_end IS NOT NULL
       AND DATEDIFF(:today, b.period_end) <= :days ${scopeClause}
     GROUP BY b.id, p.id, o.name
     ORDER BY b.period_start DESC`,
    params,
  );
  const alerts = [];
  for (const r of rows) {
    const mainConsumption = r.main_reading_end - r.main_reading_start;
    const diffConsumption = mainConsumption - Number(r.sub_consumption);
    const diffAmount = r.main_invoice_amount != null ? Number(r.main_invoice_amount) - Number(r.sub_amount) : null;
    const negative = diffConsumption < 0 || (diffAmount != null && diffAmount < 0);
    const pct = mainConsumption > 0 ? diffConsumption / mainConsumption : null;
    const high = !negative && pct != null && pct > DIFFERENCE_ALERT_PCT;
    if (!negative && !high) continue;
    alerts.push({
      key: `ecart_eleve:${r.id}`,
      type: 'ecart_eleve',
      severity: negative ? 'danger' : 'warning',
      title: `${negative ? 'Incohérence' : 'Écart élevé'} sur le relevé ${UTILITY_LABEL[r.utility_type]} ${deMonth(isoDate(r.period_start).slice(0, 7))} — ${r.code}`,
      detail: negative
        ? 'Les décompteurs totalisent plus que le compteur principal : les index sont à vérifier.'
        : `${Math.round(pct * 100)} % de la consommation du compteur principal n'est refacturée à personne (fuite, parties communes ou relevé erroné ?).`,
      propertyId: r.property_id,
      propertyCode: r.code,
      ownerName: r.owner_name,
      batchId: r.id,
      utilityType: r.utility_type,
      amount: diffAmount != null && diffAmount > 0 ? diffAmount : null,
      href: `/espace/charges/releve/${r.id}`,
    });
  }
  return alerts;
}

async function remittanceAlerts(tenantId, today) {
  const accounts = await getChargeAccounts(pool, tenantId);
  const owing = [...accounts.entries()].filter(([, a]) => a.balance > 0);
  if (owing.length === 0) return [];
  const since = await getOldestUnremittedDates(pool, tenantId);
  const [owners] = await pool.query('SELECT id, name FROM owners WHERE tenant_id = :tenantId', { tenantId });
  const nameById = new Map(owners.map((o) => [o.id, o.name]));

  const alerts = [];
  for (const [ownerId, acc] of owing) {
    const sinceDate = since.get(ownerId);
    if (!sinceDate) continue;
    const age = daysBetween(today, sinceDate);
    if (age < RULES.REMITTANCE_DAYS) continue;
    alerts.push({
      key: `charges_a_reverser:${ownerId}`,
      type: 'charges_a_reverser',
      severity: age >= RULES.REMITTANCE_URGENT_DAYS ? 'warning' : 'info',
      title: `${formatFcfa(acc.balance)} de charges à reverser à ${nameById.get(ownerId) ?? 'un propriétaire'}`,
      detail: `Encaissées chez les locataires et pas encore reversées — la plus ancienne date du ${sinceDate} (${age} jours).`,
      ownerId,
      ownerName: nameById.get(ownerId) ?? null,
      amount: acc.balance,
      daysLate: age,
      href: `/espace/proprietaires/${ownerId}`,
    });
  }
  return alerts;
}

async function listUtilityAlerts(tenantId, { scopeAgentId = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const [missing, drafts, mainPayment, anomalies, remittance] = await Promise.all([
    releveManquantAlerts(tenantId, today, scopeAgentId),
    draftBatchAlerts(tenantId, today, scopeAgentId),
    mainPaymentAlerts(tenantId, today, scopeAgentId),
    anomalyAlerts(tenantId, today, scopeAgentId),
    scopeAgentId == null ? remittanceAlerts(tenantId, today) : Promise.resolve([]),
  ]);
  const alerts = [...missing, ...drafts, ...mainPayment, ...anomalies, ...remittance];
  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return alerts;
}

module.exports = { listUtilityAlerts };
