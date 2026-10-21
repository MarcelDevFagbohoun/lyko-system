'use strict';

/**
 * Reçu d'entrée (demande utilisateur, 2026-10-17) : regroupe en UN document ce qui a réellement été
 * payé à la signature d'un bail — caution, frais d'agence (non remboursables), cautions
 * supplémentaires (SBEE/SONEB/peinture), prorata d'entrée — aucun d'eux ne produisant de reçu jusqu'ici
 * (voir `routes/renters.js`). N'inclut QUE ce qui a été réellement reçu (`*_received_at` renseigné),
 * jamais un montant simplement déclaré sur le bail mais pas encore payé.
 */

/**
 * `lease` : la ligne `leases` fraîchement créée (avec ses colonnes `*_received_at`/`*_amount`).
 * `additionalDeposits` : résultat de `listLeaseDeposits` (déjà filtré aux seules cautions
 * supplémentaires effectivement enregistrées — `recordAdditionalDeposits` n'insère jamais de ligne à 0).
 */
function buildEntryReceiptLines(lease, additionalDeposits = []) {
  const lines = [];

  if (lease.deposit_received_at && Number(lease.deposit_amount) > 0) {
    lines.push({ label: 'Caution de loyer', amount: Number(lease.deposit_amount) });
  }
  if (lease.entry_fee_received_at && Number(lease.entry_fee_amount) > 0) {
    lines.push({ label: "Frais d'agence (non remboursables)", amount: Number(lease.entry_fee_amount) });
  }
  for (const deposit of additionalDeposits) {
    lines.push({ label: deposit.typeLabel, amount: Number(deposit.amount) });
  }
  if (lease.entry_prorata_received_at && Number(lease.entry_prorata_amount) > 0) {
    const days = lease.entry_prorata_days;
    lines.push({
      label: days ? `Loyer — prorata d'entrée (${days} jour${days > 1 ? 's' : ''})` : "Loyer — prorata d'entrée",
      amount: Number(lease.entry_prorata_amount),
    });
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total };
}

async function nextEntryReceiptNumber(conn, tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM lease_entry_receipts WHERE tenant_id = :tenantId AND receipt_number LIKE :prefix`,
    { tenantId, prefix: `RE-${year}-%` },
  );
  const seq = Number(rows[0].n) + 1;
  return `RE-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Crée le reçu d'entrée SI au moins une ligne a été réellement payée (`total > 0`) — rien à recevoir,
 * rien à émettre sinon. Même principe de retry-sur-doublon que `insertReceiptForPayment` (leases.js) :
 * `nextEntryReceiptNumber` n'est qu'un `COUNT(*)`, deux baux de locataires différents créés au même
 * instant pourraient calculer le même numéro avant que l'un des deux ne commite.
 */
async function createEntryReceiptIfAnyPayment(conn, { tenantId, leaseId, createdBy, lease, additionalDeposits }, maxAttempts = 5) {
  const { lines, total } = buildEntryReceiptLines(lease, additionalDeposits);
  if (total <= 0) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const receiptNumber = await nextEntryReceiptNumber(conn, tenantId);
    try {
      const [result] = await conn.query(
        `INSERT INTO lease_entry_receipts (tenant_id, lease_id, receipt_number, snapshot, created_by)
         VALUES (:tenantId, :leaseId, :receiptNumber, :snapshot, :createdBy)`,
        { tenantId, leaseId, receiptNumber, snapshot: JSON.stringify({ lines, total }), createdBy },
      );
      return { id: result.insertId, receiptNumber, lines, total };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < maxAttempts) continue;
      throw err;
    }
  }
  throw new Error("Impossible de générer un numéro de reçu d'entrée unique après plusieurs tentatives.");
}

module.exports = {
  buildEntryReceiptLines,
  createEntryReceiptIfAnyPayment,
};
