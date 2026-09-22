'use strict';

/**
 * IRF (Impôt sur le Revenu Foncier, hypothèse #10 — À VALIDER) — le compte
 * 442 accumule les retenues faites à chaque reversement propriétaire
 * (`reversement_proprietaire`, si `tenants.gl_irf_enabled`) ; ce service
 * expose le solde dû et le règlement effectif au fisc (`reglement_irf`),
 * même principe que `reglement_fournisseur` pour une dépense à crédit.
 */

const { ApiError } = require('../../middleware/error');
const { genererEcriture } = require('./glPostingService');

async function getIrfBalance(pool, tenantId) {
  const [[account]] = await pool.query("SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = '442' LIMIT 1", {
    tenantId,
  });
  if (!account) {
    throw new ApiError(409, "Le plan comptable n'est pas encore initialisé — activez d'abord la comptabilité avancée.");
  }
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id
     WHERE e.tenant_id = :tenantId AND el.account_id = :accountId`,
    { tenantId, accountId: account.id },
  );
  return Number(row.solde);
}

async function payIrf(pool, tenantId, { amount, paymentMethod, paidAt, userId }) {
  const balance = await getIrfBalance(pool, tenantId);
  if (balance <= 0) throw new ApiError(409, "Aucun montant IRF en attente de reversement au fisc.");
  if (amount > balance) {
    throw new ApiError(400, `Le montant dépasse ce qui est dû (${balance} FCFA).`);
  }

  // `genererEcriture` insère plusieurs lignes séparément (gl_entries PUIS
  // chaque gl_entry_lines) : toujours dans SA PROPRE transaction explicite
  // ici, jamais `pool` directement (voir l'avertissement en tête de
  // glPostingService.js) — cette opération n'a aucune autre écriture DB à
  // accompagner, contrairement aux routes métier qui appellent
  // `genererEcriture` DANS leur transaction déjà ouverte.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await genererEcriture(conn, {
      tenantId,
      operationType: 'reglement_irf',
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

module.exports = { getIrfBalance, payIrf };
