'use strict';

/** Règlement des dettes sociales/fiscales de la paie : CNSS (431) et ITS (447). */

const { ApiError } = require('../../middleware/error');
const { genererEcriture } = require('./glPostingService');
const { assertPeriodOpenLocked } = require('../accountingPeriods');

const LIABILITIES = {
  cnss: { code: '431', operationType: 'reglement_cnss', label: 'la CNSS' },
  its: { code: '447', operationType: 'reglement_its', label: 'le fisc (ITS)' },
};

async function getLiabilityBalance(db, tenantId, kind) {
  const cfg = LIABILITIES[kind];
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE -el.amount END), 0) AS solde
       FROM gl_accounts a
       LEFT JOIN gl_entry_lines el ON el.account_id = a.id
       LEFT JOIN gl_entries e ON e.id = el.entry_id
      WHERE a.tenant_id = :tenantId AND a.code = :code`,
    { tenantId, code: cfg.code },
  );
  return Number(row.solde);
}

async function getPayrollLiabilities(db, tenantId) {
  return { cnss: await getLiabilityBalance(db, tenantId, 'cnss'), its: await getLiabilityBalance(db, tenantId, 'its') };
}

async function payLiability(pool, tenantId, kind, { amount, paymentMethod, paidAt, userId }) {
  const cfg = LIABILITIES[kind];
  if (!cfg) throw new ApiError(400, 'Type de règlement inconnu.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, paidAt);
    const [[account]] = await conn.query('SELECT id FROM gl_accounts WHERE tenant_id = :tenantId AND code = :code LIMIT 1 FOR UPDATE', { tenantId, code: cfg.code });
    if (!account) throw new ApiError(409, 'Aucune paie détaillée enregistrée : rien à reverser.');
    const balance = await getLiabilityBalance(conn, tenantId, kind);
    if (balance <= 0) throw new ApiError(409, `Rien à reverser à ${cfg.label}.`);
    if (amount > balance) throw new ApiError(400, `Le montant dépasse ce qui est dû (${balance} FCFA).`);
    const result = await genererEcriture(conn, {
      tenantId, operationType: cfg.operationType, entryDate: paidAt, amount, paymentMethod,
      narrationVars: { periode: paidAt.slice(0, 7) }, createdBy: userId,
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

module.exports = { getLiabilityBalance, getPayrollLiabilities, payLiability, LIABILITIES };
