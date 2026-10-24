'use strict';

/**
 * Charges SONEB/SBEE : où loger l'argent encaissé chez les locataires.
 *
 * - mode 'clients' (historique) : crédit du compte du locataire (411), puis
 *   transfert vers le solde du propriétaire. Le 411 devient provisoirement
 *   créditeur, ce qu'un comptable lit comme « le locataire a trop payé ».
 * - mode 'proprietaire' : crédit direct du compte 4672 « Charges locatives
 *   encaissées pour le compte du propriétaire » (auxiliaire par propriétaire).
 *   Le 411 reste réservé aux loyers et créances réelles.
 *
 * Le crédit du solde propriétaire (`charge_ajoutee_solde_proprietaire`)
 * consomme d'abord le 4672 du propriétaire puis, pour d'éventuelles charges
 * encaissées avant un changement de mode, le reliquat sur 411 : les deux sens
 * de bascule restent donc cohérents sans reprise manuelle.
 */

const { getOrCreateThirdParty } = require('./glThirdPartyService');
const { resolveOwnerFromLease } = require('./glAccountResolver');

const COLLECT_OPS = ['charge_locative_encaissee', 'charge_locative_reglee_par_caution'];
const TRANSFER_OP = 'charge_ajoutee_solde_proprietaire';
const OWNER_CHARGES_ACCOUNT = '4672';

async function loadOwner(conn, tenantId, context) {
  const ownerId = context.ownerId ?? (await resolveOwnerFromLease(conn, tenantId, context.leaseId, context.entryDate)).id;
  const [[owner]] = await conn.query('SELECT id, name FROM owners WHERE id = :id AND tenant_id = :tenantId LIMIT 1', { id: ownerId, tenantId });
  return owner;
}

async function ownerChargeParty(conn, tenantId, accountId, owner) {
  return getOrCreateThirdParty(conn, {
    tenantId, partyType: 'owner', sourceTable: 'owners', sourceId: owner.id, displayName: owner.name, controlAccountId: accountId,
  });
}

async function applyUtilityAccountMode(conn, tenantId, operationType, lines, context) {
  const isCollect = COLLECT_OPS.includes(operationType);
  const isTransfer = operationType === TRANSFER_OP;
  if (!isCollect && !isTransfer) return lines;

  const [[tenant]] = await conn.query('SELECT gl_utility_account_mode AS mode FROM tenants WHERE id = :tenantId', { tenantId });
  const [accounts] = await conn.query("SELECT id, code FROM gl_accounts WHERE tenant_id = :tenantId AND code IN ('411', '4672')", { tenantId });
  const a411 = accounts.find((a) => a.code === '411');
  const a4672 = accounts.find((a) => a.code === OWNER_CHARGES_ACCOUNT);
  if (!a4672 || !a411) return lines;

  if (isCollect) {
    if (tenant.mode !== 'proprietaire') return lines;
    const owner = await loadOwner(conn, tenantId, context);
    const party = await ownerChargeParty(conn, tenantId, a4672.id, owner);
    for (const l of lines) {
      if (l.side === 'credit' && l.accountId === a411.id) {
        l.accountId = a4672.id;
        l.thirdPartyId = party.id;
      }
    }
    return lines;
  }

  // Transfert vers le solde du propriétaire : 4672 d'abord, reliquat sur 411.
  const idx = lines.findIndex((l) => l.side === 'debit' && l.accountId === a411.id);
  if (idx === -1) return lines;
  const owner = await loadOwner(conn, tenantId, context);
  const party = await ownerChargeParty(conn, tenantId, a4672.id, owner);
  const [[bal]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN side = 'credit' THEN amount ELSE -amount END), 0) AS solde
       FROM gl_entry_lines WHERE third_party_id = :partyId AND account_id = :accountId`,
    { partyId: party.id, accountId: a4672.id },
  );
  const available = Math.max(0, Number(bal.solde));
  const total = lines[idx].amount;
  const from4672 = Math.min(total, available);
  if (from4672 <= 0) return lines;
  const rest = total - from4672;
  const replacement = [{ side: 'debit', accountId: a4672.id, thirdPartyId: party.id, amount: from4672, isTreasuryLine: false }];
  if (rest > 0) replacement.push({ ...lines[idx], amount: rest });
  lines.splice(idx, 1, ...replacement);
  return lines;
}

module.exports = { applyUtilityAccountMode, OWNER_CHARGES_ACCOUNT };
