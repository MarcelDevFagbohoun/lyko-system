'use strict';

/**
 * TVA sur les commissions (option « TVA sur mes commissions »).
 *
 * Principe : le taux de commission convenu avec le propriétaire est TTC. À
 * chaque ligne portée sur le compte 706 (produit de commission), la TVA est
 * EXTRAITE du montant : 706 ne garde que le hors-taxe, le reste va au 443
 * (État, TVA facturée), du même côté. L'écriture reste équilibrée par
 * construction, et ni la trésorerie ni la dette envers le propriétaire ne
 * bougent — l'option n'a donc aucun effet sur les paiements.
 */

const VAT_REVENUE_ACCOUNT = '706';
const VAT_LIABILITY_ACCOUNT = '443';

async function getVatSettings(db, tenantId) {
  const [[row]] = await db.query('SELECT gl_vat_enabled, gl_vat_rate FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId });
  return { enabled: !!row?.gl_vat_enabled, rate: Number(row?.gl_vat_rate ?? 0) };
}

/** Éclate un montant TTC en { ht, tva } (tva arrondie, ht = reste : somme exacte). */
function splitVat(ttc, ratePercent) {
  const ht = Math.round(ttc / (1 + ratePercent / 100));
  return { ht, tva: ttc - ht };
}

/**
 * Transforme `lines` (lignes déjà résolues) en place : chaque ligne 706 est
 * scindée en HT (706) + TVA (443). No-op si l'option est désactivée.
 */
async function applyVatSplit(conn, tenantId, lines) {
  const { enabled, rate } = await getVatSettings(conn, tenantId);
  if (!enabled || rate <= 0) return lines;

  const [accounts] = await conn.query(
    "SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId AND code IN ('706', '443')",
    { tenantId },
  );
  const revenue = accounts.find((a) => a.code === VAT_REVENUE_ACCOUNT);
  const liability = accounts.find((a) => a.code === VAT_LIABILITY_ACCOUNT);
  if (!revenue) return lines;
  if (!liability) {
    throw new Error("Compte 443 (TVA facturée) absent du plan comptable — rouvrez Comptabilité avancée → Règles comptables → « Synchroniser » pour l'ajouter.");
  }

  const extra = [];
  for (const line of lines) {
    if (line.accountId !== revenue.id) continue;
    const { tva } = splitVat(line.amount, rate);
    if (tva <= 0) continue;
    line.amount -= tva;
    extra.push({ side: line.side, accountId: liability.id, thirdPartyId: null, amount: tva, isTreasuryLine: false });
  }
  lines.push(...extra);
  return lines;
}

module.exports = { applyVatSplit, splitVat, getVatSettings, VAT_LIABILITY_ACCOUNT };

// ── Suivi et règlement de la TVA collectée ───────────────────────────────

const { ApiError } = require('../../middleware/error');
const { assertPeriodOpenLocked } = require('../accountingPeriods');

async function getVatBalance(db, tenantId) {
  const [[account]] = await db.query("SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = '443' LIMIT 1", { tenantId });
  if (!account) return { accountId: null, balance: 0 };
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
       FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id
      WHERE e.tenant_id = :tenantId AND el.account_id = :accountId`,
    { tenantId, accountId: account.id },
  );
  return { accountId: account.id, balance: Number(row.solde) };
}

/** TVA collectée par mois (base HT = mouvement net du 706 sur les mêmes écritures). */
async function getVatReport(db, tenantId, { from, to }) {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(e.entry_date, '%Y-%m') AS month,
            SUM(CASE WHEN a.code = '443' THEN (CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END) ELSE 0 END) AS tva,
            SUM(CASE WHEN a.code = '706' THEN (CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END) ELSE 0 END) AS base_ht
       FROM gl_entry_lines el
       JOIN gl_entries e ON e.id = el.entry_id
       JOIN gl_accounts a ON a.id = el.account_id
      WHERE e.tenant_id = :tenantId AND e.entry_date BETWEEN :from AND :to AND a.code IN ('443', '706')
        AND e.id IN (SELECT entry_id FROM gl_entry_lines l2 JOIN gl_accounts a2 ON a2.id = l2.account_id WHERE a2.code = '443' AND a2.tenant_id = :tenantId)
      GROUP BY month ORDER BY month`,
    { tenantId, from, to },
  );
  return rows.map((r) => ({ month: r.month, baseHt: Number(r.base_ht), tva: Number(r.tva), ttc: Number(r.base_ht) + Number(r.tva) }));
}

async function payVat(pool, tenantId, { amount, paymentMethod, paidAt, userId }) {
  const { genererEcriture } = require('./glPostingService');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, paidAt);
    const [[account]] = await conn.query("SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = '443' LIMIT 1 FOR UPDATE", { tenantId });
    if (!account) throw new ApiError(409, "Aucune TVA à reverser : l'option TVA n'a pas encore été utilisée.");
    const { balance } = await getVatBalance(conn, tenantId);
    if (balance <= 0) throw new ApiError(409, 'Aucune TVA en attente de reversement au fisc.');
    if (amount > balance) throw new ApiError(400, `Le montant dépasse la TVA due (${balance} FCFA).`);
    const result = await genererEcriture(conn, {
      tenantId,
      operationType: 'reglement_tva',
      entryDate: paidAt,
      amount,
      paymentMethod,
      narrationVars: { periode: paidAt.slice(0, 7) },
      createdBy: userId,
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports.getVatBalance = getVatBalance;
module.exports.getVatReport = getVatReport;
module.exports.payVat = payVat;
