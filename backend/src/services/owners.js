'use strict';

/**
 * Propriétaires (`owners`) : fiche, versements, reversements de charges et de cautions, taux de
 * commission, lien de portail et fin/réactivation de mandat. Toutes les requêtes SQL de la route
 * `/api/owners` vivent ici ; la route garde le HTTP (validation, statuts, journal, mise en forme).
 * Chaque fonction est isolée par `tenantId` et, pour un agent restreint, par `scopeAgentId`
 * (`null` = accès complet).
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { getEscrowBalances, assertPayoutWithinBalance } = require('./commission');
const { claimIdempotencyKey } = require('./paymentGuards');
const { assertRemittanceWithinBalance } = require('./utilityRemittance');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { extourneEcriture } = require('./gl/glReversalService');
const { assertManualPaymentAllowed } = require('./payments/manualGuard');
const { assertWithinLimit } = require('./entitlements');
const depositTransfers = require('./depositTransfers');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const { isoDate } = require('../utils/dates');

/**
 * Un même numéro de téléphone ne doit jamais être utilisé par deux propriétaires différents de la même
 * entreprise — voir migration 059 pour la contrainte UNIQUE en base ; ce contrôle applicatif renvoie un
 * message clair (409) plutôt que le `ER_DUP_ENTRY` brut de MySQL. `excludeOwnerId` (édition) exclut la
 * fiche elle-même.
 */
async function assertOwnerPhoneAvailable(tenantId, phone, excludeOwnerId) {
  if (!phone) return;
  const [rows] = await pool.query(
    `SELECT id FROM owners WHERE tenant_id = :tenantId AND phone = :phone
     ${excludeOwnerId ? 'AND id != :excludeOwnerId' : ''} LIMIT 1`,
    { tenantId, phone, excludeOwnerId },
  );
  if (rows[0]) throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé par un autre propriétaire');
}

/** Lecture seule une fois le mandat terminé — seule la réactivation (DG) permet d'en sortir. */
function assertMandateActive(owner) {
  if (owner.mandate_ended_at) {
    throw new ApiError(409, 'Le mandat de ce propriétaire est terminé — réactivez-le avant d’enregistrer quoi que ce soit.');
  }
}

/**
 * Charge un propriétaire de l'entreprise courante (+ son créateur), ou lève 404. `scopeAgentId` : un
 * agent restreint n'accède qu'aux propriétaires ayant AU MOINS UN Bien qui lui est attribué.
 */
async function loadOwner(conn, tenantId, ownerId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT o.*, cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
            mu.first_name AS mandate_ender_first_name, mu.last_name AS mandate_ender_last_name, mu.role AS mandate_ender_role
     FROM owners o
     LEFT JOIN users cu ON cu.id = o.created_by
     LEFT JOIN users mu ON mu.id = o.mandate_ended_by
     WHERE o.id = :id AND o.tenant_id = :tenantId LIMIT 1`,
    { id: ownerId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Propriétaire introuvable');
  if (scopeAgentId != null) {
    const [scopeRows] = await conn.query(
      'SELECT 1 FROM properties WHERE owner_id = :ownerId AND agent_id = :scopeAgentId LIMIT 1',
      { ownerId, scopeAgentId },
    );
    if (scopeRows.length === 0) throw new ApiError(404, 'Propriétaire introuvable');
  }
  return rows[0];
}

/** Répertoire des propriétaires avec patrimoine résumé (un agent restreint ne voit que ses propres Biens). */
async function listOwners(tenantId, scopeAgentId, q) {
  const params = { tenantId };
  let where = 'o.tenant_id = :tenantId';
  if (q) {
    where += ' AND o.name LIKE :q';
    params.q = `%${q}%`;
  }
  let propertyJoinScope = '';
  if (scopeAgentId != null) {
    where += ' AND EXISTS (SELECT 1 FROM properties sp WHERE sp.owner_id = o.id AND sp.agent_id = :scopeAgentId)';
    propertyJoinScope = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }

  const [rows] = await pool.query(
    `SELECT o.*,
            cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role,
            mu.first_name AS mandate_ender_first_name, mu.last_name AS mandate_ender_last_name, mu.role AS mandate_ender_role,
            COUNT(DISTINCT p.id) AS properties_count,
            COUNT(u.id) AS units_count,
            SUM(CASE WHEN u.status = 'loue' THEN 1 ELSE 0 END) AS units_occupied,
            SUM(CASE WHEN u.status = 'loue' THEN u.monthly_rent ELSE 0 END) AS monthly_rent_total
     FROM owners o
     LEFT JOIN users cu ON cu.id = o.created_by
     LEFT JOIN users mu ON mu.id = o.mandate_ended_by
     LEFT JOIN properties p ON p.owner_id = o.id ${propertyJoinScope}
     LEFT JOIN property_units u ON u.property_id = p.id
     WHERE ${where}
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    params,
  );
  return rows;
}

/** Biens et unités d'un propriétaire (un agent restreint ne voit que ses propres Biens), locataire actuel inclus. */
async function listOwnerPropertyUnits(tenantId, ownerId, scopeAgentId) {
  const params = { id: ownerId, tenantId };
  let scope = '';
  if (scopeAgentId != null) {
    scope = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT p.*,
            u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
            u.status AS unit_status, u.monthly_rent,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name
     FROM properties p
     LEFT JOIN property_units u ON u.property_id = p.id
     LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
     LEFT JOIN renters r ON r.id = l.renter_id
     WHERE p.owner_id = :id AND p.tenant_id = :tenantId ${scope}
     ORDER BY p.code, u.code`,
    params,
  );
  return rows;
}

/** Versements (loyers nets reversés) d'un propriétaire, du plus récent au plus ancien. */
async function listOwnerPayouts(tenantId, ownerId) {
  const [rows] = await pool.query(
    `SELECT op.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
     FROM owner_payouts op
     JOIN users u ON u.id = op.recorded_by
     WHERE op.owner_id = :id AND op.tenant_id = :tenantId
     ORDER BY op.paid_at DESC, op.id DESC`,
    { id: ownerId, tenantId },
  );
  return rows;
}

/** Historique des taux de commission d'un propriétaire. */
async function listCommissionRates(tenantId, ownerId) {
  const [rows] = await pool.query(
    `SELECT cr.*, u.first_name AS set_by_first_name, u.last_name AS set_by_last_name, u.role AS set_by_role
     FROM owner_commission_rates cr
     JOIN users u ON u.id = cr.set_by
     WHERE cr.owner_id = :id AND cr.tenant_id = :tenantId
     ORDER BY cr.starts_on DESC`,
    { id: ownerId, tenantId },
  );
  return rows;
}

/** Crée une fiche propriétaire (sans bien). */
async function createOwner(tenantId, userId, data) {
  const conn = await pool.getConnection();
  try {
    await assertOwnerPhoneAvailable(tenantId, data.phone);
    await conn.beginTransaction();
    await assertWithinLimit(tenantId, 'owners', conn);
    const [result] = await conn.query(
      `INSERT INTO owners (tenant_id, name, phone, email, address, notes, created_by)
       VALUES (:tenantId, :name, :phone, :email, :address, :notes, :createdBy)`,
      { tenantId, ...data, createdBy: userId },
    );
    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Modifie la fiche ; renvoie la ligne propriétaire à jour. */
async function updateOwner(tenantId, id, scopeAgentId, data) {
  const owner = await loadOwner(pool, tenantId, id, scopeAgentId);
  assertMandateActive(owner);
  await assertOwnerPhoneAvailable(tenantId, data.phone, id);

  const fields = [];
  const params = { id };
  if (data.name !== undefined) { fields.push('name = :name'); params.name = data.name; }
  if (data.phone !== undefined) { fields.push('phone = :phone'); params.phone = data.phone; }
  if (data.email !== undefined) { fields.push('email = :email'); params.email = data.email; }
  if (data.address !== undefined) { fields.push('address = :address'); params.address = data.address; }
  if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

  if (fields.length > 0) {
    await pool.query(`UPDATE owners SET ${fields.join(', ')} WHERE id = :id`, params);
  }
  return loadOwner(pool, tenantId, id, scopeAgentId);
}

/**
 * Enregistre un versement propriétaire DANS la transaction fournie (verrou du propriétaire, plafond de solde,
 * insertion, écriture comptable). Aussi appelé quand un paiement FedaPay est confirmé
 * (`services/payments/effects.js`) : `skipBalanceCheck` — l'argent est déjà parti, le plafond a été vérifié
 * (et réservé) à la création de l'ordre ; `skipIdempotency` — l'ordre porte sa propre clé.
 */
async function recordOwnerPayout(conn, { tenantId, ownerId, owner, data, recordedBy, skipBalanceCheck = false, skipIdempotency = false }) {
  const id = ownerId;
  // Re-vérifie SOUS VERROU, dans la transaction — voir `assertPeriodOpenLocked`.
  await assertPeriodOpenLocked(conn, tenantId, data.paidAt);
  // Sérialise les versements d'un même propriétaire : le solde est vérifié APRÈS ce verrou et DANS la
  // transaction (audit comptable A2, voir `assertPayoutWithinBalance`) — deux versements simultanés,
  // chacun inférieur au solde, ne peuvent plus le dépasser ensemble.
  await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
    id,
    tenantId,
  });
  // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
  if (data.idempotencyKey && !skipIdempotency) await claimIdempotencyKey(conn, tenantId, 'owner_payout', data.idempotencyKey);
  if (!skipBalanceCheck) await assertPayoutWithinBalance(tenantId, id, data.amount, conn);

  const [result] = await conn.query(
    `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, notes, recorded_by)
     VALUES (:tenantId, :ownerId, :amount, :periodLabel, :paidAt, :paymentMethod, :notes, :recordedBy)`,
    {
      tenantId,
      ownerId: id,
      amount: data.amount,
      periodLabel: data.periodLabel,
      paidAt: data.paidAt,
      paymentMethod: data.paymentMethod,
      notes: data.notes,
      recordedBy,
    },
  );

  // Module comptabilité SYSCOHADA : versement et écriture comptable réussissent ou échouent ensemble
  // (même transaction SQL). Rien ne change pour une entreprise qui n'a pas activé le module.
  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId,
      operationType: 'reversement_proprietaire',
      entryDate: data.paidAt,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      narrationVars: { proprietaire: owner.name },
      sourceTable: 'owner_payouts',
      sourceId: result.insertId,
      createdBy: recordedBy,
      context: { ownerId: id },
    });
  }

  return result.insertId;
}

/** Versement manuel d'un propriétaire (loyers nets reversés). */
async function createPayout(tenantId, userId, ownerId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    await assertManualPaymentAllowed(tenantId, 'le reversement au propriétaire');
    const owner = await loadOwner(pool, tenantId, ownerId, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(tenantId, data.paidAt);

    await conn.beginTransaction();
    const payoutId = await recordOwnerPayout(conn, { tenantId, ownerId, owner, data, recordedBy: userId });
    await conn.commit();
    return payoutId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Cautions détenues (par bail et par type) et historique des reversements (lecture). */
async function getDepositTransferOverview(tenantId, ownerId, scopeAgentId) {
  await loadOwner(pool, tenantId, ownerId, scopeAgentId);
  return {
    positions: await depositTransfers.getDepositPositions(tenantId, ownerId),
    transfers: await depositTransfers.listTransfers(tenantId, ownerId, { limit: 200 }),
  };
}

/** Reverse une caution au propriétaire (ou la récupère auprès de lui) — ni solde séquestre ni commission. */
async function createDepositTransfer(tenantId, userId, ownerId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const owner = await loadOwner(pool, tenantId, ownerId, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(tenantId, data.paidAt);
    // Entreprise qui a activé la comptabilité avancée avant l'existence de cette opération : ajoute le compte et les règles.
    if (await isModuleActive(pool, tenantId)) {
      const seed = require('../db/seedGeneralLedger');
      await seed.syncMissingAccounts(tenantId);
      await seed.syncMissingPostingRules(tenantId);
    }
    await conn.beginTransaction();
    const transferId = await depositTransfers.createTransfer(conn, {
      tenantId, ownerId, owner, data, recordedBy: userId,
    });
    await conn.commit();
    return transferId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Reverse au propriétaire des charges SONEB/SBEE déjà encaissées chez ses locataires (étape 31). Le solde
 * est réévalué DANS la transaction, sous verrou de la fiche propriétaire : deux reversements simultanés ne
 * peuvent pas dépasser ensemble ce qui a été encaissé.
 */
async function createChargeRemittance(tenantId, userId, ownerId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const owner = await loadOwner(pool, tenantId, ownerId, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(tenantId, data.paidAt);
    if (await isModuleActive(pool, tenantId)) {
      const seed = require('../db/seedGeneralLedger');
      await seed.syncMissingPostingRules(tenantId);
    }

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, data.paidAt);
    await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
      id: ownerId,
      tenantId,
    });
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'charge_remittance', data.idempotencyKey);
    await assertRemittanceWithinBalance(conn, tenantId, ownerId, data.amount);

    // Transfert interne : le montant rejoint le solde du propriétaire, il ne sort d'aucune caisse.
    const [result] = await conn.query(
      `INSERT INTO owner_charge_remittances (tenant_id, owner_id, amount, period_label, paid_at, payment_method, kind, notes, recorded_by)
       VALUES (:tenantId, :ownerId, :amount, :periodLabel, :paidAt, 'virement', 'balance', :notes, :recordedBy)`,
      {
        tenantId,
        ownerId,
        amount: data.amount,
        periodLabel: data.periodLabel,
        paidAt: data.paidAt,
        notes: data.notes,
        recordedBy: userId,
      },
    );
    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'charge_ajoutee_solde_proprietaire',
        entryDate: data.paidAt,
        amount: data.amount,
        narrationVars: { proprietaire: owner.name },
        sourceTable: 'owner_charge_remittances',
        sourceId: result.insertId,
        createdBy: userId,
        context: { ownerId },
      });
    }
    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Annulation logique d'un reversement mal saisi : la trace reste, le montant redevient « à reverser ». */
async function cancelChargeRemittance(tenantId, userId, ownerId, remittanceId, scopeAgentId, reason) {
  const conn = await pool.getConnection();
  try {
    const owner = await loadOwner(pool, tenantId, ownerId, scopeAgentId);
    assertMandateActive(owner);
    const [rows] = await pool.query(
      'SELECT id, paid_at, amount, kind, deleted_at FROM owner_charge_remittances WHERE id = :remittanceId AND owner_id = :id AND tenant_id = :tenantId LIMIT 1',
      { remittanceId, id: ownerId, tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Reversement introuvable');
    if (rows[0].deleted_at) throw new ApiError(409, 'Ce reversement est déjà annulé.');
    await assertPeriodOpen(tenantId, isoDate(rows[0].paid_at));

    await conn.beginTransaction();
    await assertPeriodOpenLocked(conn, tenantId, isoDate(rows[0].paid_at));
    const [result] = await conn.query(
      `UPDATE owner_charge_remittances
       SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason
       WHERE id = :remittanceId AND tenant_id = :tenantId AND deleted_at IS NULL`,
      { by: userId, reason, remittanceId, tenantId },
    );
    if (result.affectedRows === 0) throw new ApiError(409, 'Ce reversement est déjà annulé.');
    if (rows[0].kind === 'balance') {
      // Annuler un transfert déjà versé au propriétaire rendrait son solde négatif : refusé.
      const balances = await getEscrowBalances(tenantId, conn);
      if ((balances.get(ownerId)?.balance ?? 0) < 0) {
        throw new ApiError(409, "Ce montant a déjà été versé au propriétaire : annulation impossible (son solde deviendrait négatif).");
      }
      const [glEntries] = await conn.query(
        "SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'owner_charge_remittances' AND source_id = :remittanceId AND status = 'validee'",
        { tenantId, remittanceId },
      );
      for (const entry of glEntries) {
        await extourneEcriture(conn, {
          tenantId, entryId: entry.id, entryDate: new Date().toISOString().slice(0, 10),
          userId, reason: `Charges retirées du solde du propriétaire — ${reason}`,
        });
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Nouveau taux de commission. Ne modifie JAMAIS un taux existant : clôture le taux actif (`ends_on` = la
 * veille du nouveau départ) et insère le nouveau, dans une seule transaction — les recettes des mois
 * passés restent calculées avec le taux réellement en vigueur à l'époque.
 */
async function setCommissionRate(tenantId, userId, ownerId, scopeAgentId, { rate, startsOn }) {
  const conn = await pool.getConnection();
  try {
    const owner = await loadOwner(conn, tenantId, ownerId, scopeAgentId);
    assertMandateActive(owner);

    const [activeRows] = await conn.query(
      `SELECT id, starts_on FROM owner_commission_rates
       WHERE tenant_id = :tenantId AND owner_id = :id AND ends_on IS NULL LIMIT 1`,
      { tenantId, id: ownerId },
    );
    const active = activeRows[0];
    if (active && startsOn <= isoDate(active.starts_on)) {
      throw new ApiError(
        400,
        `La date de début doit être postérieure au début du taux actif (${isoDate(active.starts_on)}).`,
      );
    }

    await conn.beginTransaction();

    if (active) {
      await conn.query(
        `UPDATE owner_commission_rates SET ends_on = DATE_SUB(:startsOn, INTERVAL 1 DAY) WHERE id = :id AND tenant_id = :tenantId`,
        { startsOn, id: active.id, tenantId },
      );
    }

    const [result] = await conn.query(
      `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
       VALUES (:tenantId, :ownerId, :rate, :startsOn, NULL, :setBy)`,
      { tenantId, ownerId, rate, startsOn, setBy: userId },
    );

    await conn.commit();
    return { rateId: result.insertId, previousClosedId: active?.id ?? null };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Ligne `tenants` de l'entreprise (en-tête des PDF). */
async function getTenantRow(tenantId) {
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  return rows[0];
}

/** Données du relevé PDF : unités du périmètre de l'agent et 24 derniers versements. */
async function loadStatementData(ownerId, scopeAgentId) {
  const unitParams = { id: ownerId };
  let unitScope = '';
  if (scopeAgentId != null) {
    unitScope = ' AND p.agent_id = :scopeAgentId';
    unitParams.scopeAgentId = scopeAgentId;
  }
  const [unitRows] = await pool.query(
    `SELECT p.code AS property_code, p.address,
            u.code AS unit_code, u.designation, u.designation_custom, u.status, u.monthly_rent,
            r.first_name AS renter_first_name, r.last_name AS renter_last_name
     FROM properties p
     JOIN property_units u ON u.property_id = p.id
     LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
     LEFT JOIN renters r ON r.id = l.renter_id
     WHERE p.owner_id = :id ${unitScope}
     ORDER BY p.code, u.code`,
    unitParams,
  );
  const [payoutRows] = await pool.query(
    'SELECT * FROM owner_payouts WHERE owner_id = :id ORDER BY paid_at DESC, id DESC LIMIT 24',
    { id: ownerId },
  );
  return { unitRows, payoutRows };
}

/** (Ré)génère le lien secret du portail propriétaire ; un seul lien valide à la fois. Token en clair renvoyé une seule fois. */
async function regeneratePortalLink(tenantId, ownerId, scopeAgentId) {
  const owner = await loadOwner(pool, tenantId, ownerId, scopeAgentId);
  assertMandateActive(owner);

  const token = generatePortalToken();
  await pool.query('UPDATE owners SET portal_token_hash = :hash, portal_link_created_at = NOW() WHERE id = :id AND tenant_id = :tenantId', {
    hash: hashToken(token),
    id: ownerId,
    tenantId,
  });
  return token;
}

/**
 * Archive un propriétaire (action volontaire du DG, motif obligatoire). Refusée tant qu'il reste un Bien
 * rattaché ou un solde non nul en comptabilité avancée. Renvoie la ligne à jour.
 */
async function endMandate(tenantId, userId, ownerId, reason) {
  const owner = await loadOwner(pool, tenantId, ownerId, null);
  if (owner.mandate_ended_at) throw new ApiError(409, 'Le mandat de ce propriétaire est déjà terminé.');

  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM properties WHERE owner_id = :id AND tenant_id = :tenantId',
    { id: ownerId, tenantId },
  );
  if (count > 0) {
    throw new ApiError(
      409,
      `Ce propriétaire a encore ${count} Bien${count > 1 ? 's' : ''} rattaché${count > 1 ? 's' : ''} — réattribuez-les d'abord.`,
    );
  }

  // Audit comptabilité avancée (2026-10-18) : si le module SYSCOHADA est actif, ce propriétaire peut avoir
  // des comptes tiers (ex. 165 caution, 411/421 loyers) avec un solde non nul — à régulariser avant
  // d'archiver. N'affecte que les entreprises ayant activé le module (aucune ligne trouvée sinon).
  const [glBalanceRows] = await pool.query(
    `SELECT a.label AS account_label, a.code AS account_code,
            COALESCE(SUM(CASE WHEN el.side = 'debit' THEN el.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN el.side = 'credit' THEN el.amount ELSE 0 END), 0) AS total_credit
     FROM gl_third_parties tp
     JOIN gl_accounts a ON a.id = tp.control_account_id
     LEFT JOIN gl_entry_lines el ON el.third_party_id = tp.id
     LEFT JOIN gl_entries e ON e.id = el.entry_id AND e.tenant_id = tp.tenant_id
     WHERE tp.tenant_id = :tenantId AND tp.party_type = 'owner' AND tp.source_table = 'owners' AND tp.source_id = :id
     GROUP BY tp.id, a.label, a.code
     HAVING total_debit <> total_credit`,
    { tenantId, id: ownerId },
  );
  if (glBalanceRows.length > 0) {
    const details = glBalanceRows.map((r) => `${r.account_label} (${r.account_code})`).join(', ');
    throw new ApiError(
      409,
      `Ce propriétaire a encore un solde non nul en comptabilité avancée (${details}) — régularisez-le d'abord.`,
    );
  }

  await pool.query(
    `UPDATE owners SET mandate_ended_at = NOW(), mandate_ended_by = :by, mandate_end_reason = :reason WHERE id = :id AND tenant_id = :tenantId`,
    { by: userId, reason, id: ownerId, tenantId },
  );
  return loadOwner(pool, tenantId, ownerId, null);
}

/** Unique porte de sortie de l'archive (DG), aucune précondition. Renvoie la ligne à jour. */
async function reactivateMandate(tenantId, ownerId) {
  const owner = await loadOwner(pool, tenantId, ownerId, null);
  if (!owner.mandate_ended_at) throw new ApiError(409, 'Le mandat de ce propriétaire est déjà actif.');

  await pool.query(
    `UPDATE owners SET mandate_ended_at = NULL, mandate_ended_by = NULL, mandate_end_reason = NULL WHERE id = :id AND tenant_id = :tenantId`,
    { id: ownerId, tenantId },
  );
  return loadOwner(pool, tenantId, ownerId, null);
}

module.exports = {
  loadOwner,
  assertMandateActive,
  listOwners,
  listOwnerPropertyUnits,
  listOwnerPayouts,
  listCommissionRates,
  createOwner,
  updateOwner,
  recordOwnerPayout,
  createPayout,
  getDepositTransferOverview,
  createDepositTransfer,
  createChargeRemittance,
  cancelChargeRemittance,
  setCommissionRate,
  getTenantRow,
  loadStatementData,
  regeneratePortalLink,
  endMandate,
  reactivateMandate,
};
