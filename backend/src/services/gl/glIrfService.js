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
const { assertPeriodOpenLocked } = require('../accountingPeriods');

/** `db` : `pool` pour une lecture hors transaction, ou `conn` pour la relire SOUS VERROU (voir `payIrf`). */
async function getIrfBalance(db, tenantId) {
  const [[account]] = await db.query("SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = '442' LIMIT 1", {
    tenantId,
  });
  if (!account) {
    throw new ApiError(409, "Le plan comptable n'est pas encore initialisé — activez d'abord la comptabilité avancée.");
  }
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
     FROM gl_entry_lines el JOIN gl_entries e ON e.id = el.entry_id
     WHERE e.tenant_id = :tenantId AND el.account_id = :accountId`,
    { tenantId, accountId: account.id },
  );
  return { accountId: account.id, balance: Number(row.solde) };
}

async function payIrf(pool, tenantId, { amount, paymentMethod, paidAt, userId }) {
  // Vérification hors transaction, juste pour un message d'erreur rapide
  // avant d'ouvrir quoi que ce soit — la vérification qui compte est celle
  // refaite SOUS VERROU ci-dessous.
  const { balance: quickBalance } = await getIrfBalance(pool, tenantId);
  if (quickBalance <= 0) throw new ApiError(409, "Aucun montant IRF en attente de reversement au fisc.");
  if (amount > quickBalance) {
    throw new ApiError(400, `Le montant dépasse ce qui est dû (${quickBalance} FCFA).`);
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
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, paidAt);
    // Bug corrigé (audit sécurité, même famille que l'audit A2 sur les
    // versements propriétaires) : deux règlements IRF simultanés, chacun
    // inférieur au solde lu hors transaction ci-dessus, pouvaient ensemble
    // dépasser ce qui est réellement dû. Verrouille le compte 442 puis
    // relit le solde SOUS CE VERROU (via `conn`, pas `pool`) — le second
    // règlement voit alors l'effet du premier avant de se décider.
    const [[account]] = await conn.query(
      "SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = '442' LIMIT 1 FOR UPDATE",
      { tenantId },
    );
    if (!account) throw new ApiError(409, "Le plan comptable n'est pas encore initialisé — activez d'abord la comptabilité avancée.");
    const { balance: lockedBalance } = await getIrfBalance(conn, tenantId);
    if (lockedBalance <= 0 || amount > lockedBalance) {
      throw new ApiError(400, `Le montant dépasse ce qui est dû (${Math.max(0, lockedBalance)} FCFA).`);
    }

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
