'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission, requireRole } = require('../middleware/auth');
const {
  createOwnerSchema,
  updateOwnerSchema,
  createPayoutSchema,
  createChargeRemittanceSchema,
  cancelChargeRemittanceSchema,
  updateCommissionRateSchema,
  endMandateSchema,
} = require('../validators/owners');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { streamOwnerStatementPdf, streamUtilityCarnetPdf } = require('../services/pdf');
const { getEscrowBalances, getDepositsHeldByOwner, getUnpaidOpeningDebtByOwner, pickRateValidAt, assertPayoutWithinBalance } = require('../services/commission');
const { toActor } = require('../utils/actor');
const { claimIdempotencyKey } = require('../services/paymentGuards');
const { getChargeAccount, assertRemittanceWithinBalance, listRemittances } = require('../services/utilityRemittance');
const { getOwnerCarnet, resolveMonthWindow } = require('../services/utilityPoint');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('../services/accountingPeriods');
const { genererEcriture, isModuleActive } = require('../services/gl/glPostingService');
const { resolvePropertyScope } = require('../services/scope');
const { hasAnyPermission } = require('../services/permissions');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const logger = require('../utils/logger');
const { extourneEcriture } = require('../services/gl/glReversalService');
const { assertManualPaymentAllowed } = require('../services/payments/manualGuard');
const { isoDate } = require('../utils/dates');

/**
 * Un même numéro de téléphone ne doit jamais être utilisé par deux
 * propriétaires différents de la même entreprise — voir migration 059 pour
 * la contrainte UNIQUE en base ; ce contrôle applicatif renvoie un message
 * clair (409) plutôt que le `ER_DUP_ENTRY` brut de MySQL. `excludeOwnerId`
 * (édition) exclut la fiche elle-même — resaisir son propre numéro inchangé
 * ne doit jamais se déclarer en conflit avec soi-même.
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

const { assertWithinLimit, requireFeature } = require('../services/entitlements');
const depositTransfers = require('../services/depositTransfers');
const { createDepositTransferSchema } = require('../validators/owners');
const { requireChargesEnabled } = require('../middleware/chargesModule');
const router = Router();
router.use(requireAuth);

// Lecture du répertoire/de la fiche (nom, téléphone, patrimoine) : ouverte à
// tout employé authentifié, même sans permission `proprietaires` assignée —
// un agent doit pouvoir consulter, seulement pas gérer (même principe que
// les locataires). `requireAuth` au niveau du router suffit déjà.
const canRead = (req, res, next) => next();
// Relevé PDF généré à la demande : reste réservé à qui gère la relation
// propriétaire/locataire ou à la comptabilité, comme le contrat de bail.
const canReadDocs = requireAnyPermission('proprietaires', 'comptabilite', 'locataires');
// Créer/modifier une fiche propriétaire : propriétaires (module dédié) ou
// locataires (création à la volée d'un propriétaire depuis le formulaire
// Bien) — pas comptabilite, qui n'a pas vocation à modifier les fiches.
const canManage = requireAnyPermission('proprietaires', 'locataires');
// Enregistrer un versement : action financière (relation propriétaire),
// réservée à proprietaires/comptabilite — pas locataires, qui gère les
// Biens mais pas les flux d'argent vers les bailleurs.
// Permission dédiée (2026-10-26) : voir/gérer la fiche propriétaire ne permet pas de verser de l'argent.
const canPayout = requirePermission('reversements_proprietaires');
// Modifier le taux de commission : DG uniquement (cahier des charges), pas
// même le comptable — c'est une décision de gérance, pas une saisie.
const canCommission = requireRole('dg');
// Terminer/réactiver le mandat d'un propriétaire (demande utilisateur, 2026-10-18) : DG uniquement,
// même principe que le taux de commission ci-dessus — une décision de gérance.
const canMandate = requireRole('dg');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  caution: 'Prélevé sur la caution',
};

function toPublicOwner(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    createdBy: toActor(row.creator_first_name, row.creator_last_name, row.creator_role),
    createdAt: row.created_at,
    // Jamais le token/hash lui-même ici (uniquement renvoyé une fois, à la
    // création du lien) — juste de quoi afficher « Générer » ou « Régénérer ».
    hasPortalLink: !!row.portal_token_hash,
    portalLinkCreatedAt: row.portal_link_created_at,
    // Archive des propriétaires (demande utilisateur, 2026-10-18) — mandat terminé volontairement
    // par le DG, jamais automatique (voir `POST /:id/end-mandate`).
    mandateEndedAt: row.mandate_ended_at,
    mandateEndedBy: toActor(row.mandate_ender_first_name, row.mandate_ender_last_name, row.mandate_ender_role),
    mandateEndReason: row.mandate_end_reason,
    ...extra,
  };
}

/** Lecture seule une fois le mandat terminé (décision explicite de l'utilisateur, 2026-10-18) —
 * seule `POST /:id/reactivate-mandate` (DG) permet d'en sortir, par exemple pour un règlement tardif. */
function assertMandateActive(owner) {
  if (owner.mandate_ended_at) {
    throw new ApiError(409, 'Le mandat de ce propriétaire est terminé — réactivez-le avant d’enregistrer quoi que ce soit.');
  }
}

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

/**
 * Charge un propriétaire de l'entreprise courante (+ son créateur), ou lève
 * 404. `scopeAgentId` (étape 14) : un agent restreint n'accède qu'aux
 * propriétaires ayant AU MOINS UN Bien qui lui est attribué (il peut gérer
 * une partie seulement du patrimoine d'un propriétaire, sans que ça masque
 * sa fiche).
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

// GET /api/owners?q=... — répertoire des propriétaires, avec patrimoine résumé.
router.get('/', canRead, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params = { tenantId: req.user.tenantId };
    let where = 'o.tenant_id = :tenantId';
    if (q) {
      where += ' AND o.name LIKE :q';
      params.q = `%${q}%`;
    }
    // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que les
    // propriétaires ayant AU MOINS UN Bien qui lui est attribué (exclusion
    // via EXISTS), et le patrimoine résumé ci-dessous ne compte QUE ses
    // propres Biens chez ce propriétaire (jointure `p` elle-même filtrée) —
    // jamais le patrimoine complet d'un propriétaire partagé entre agents.
    const scopeAgentId = await resolvePropertyScope(req.user);
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

    res.json({
      owners: rows.map((r) =>
        toPublicOwner(r, {
          propertiesCount: Number(r.properties_count),
          unitsCount: Number(r.units_count),
          unitsOccupied: Number(r.units_occupied),
          monthlyRentTotal: Number(r.monthly_rent_total),
        }),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id — fiche + ses biens/unités + historique des versements.
router.get('/:id', canRead, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);

    // Un agent restreint ne voit, dans la fiche du propriétaire, QUE ses
    // propres Biens attribués — jamais tout le patrimoine si celui-ci est
    // partagé avec un autre agent (ou non attribué).
    const propParams = { id };
    let propScope = '';
    if (scopeAgentId != null) {
      propScope = ' AND p.agent_id = :scopeAgentId';
      propParams.scopeAgentId = scopeAgentId;
    }
    const [propertyRows] = await pool.query(
      `SELECT p.*,
              u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
              u.status AS unit_status, u.monthly_rent,
              r.first_name AS renter_first_name, r.last_name AS renter_last_name
       FROM properties p
       LEFT JOIN property_units u ON u.property_id = p.id
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
       LEFT JOIN renters r ON r.id = l.renter_id
       WHERE p.owner_id = :id ${propScope}
       ORDER BY p.code, u.code`,
      propParams,
    );

    const propertiesById = new Map();
    for (const row of propertyRows) {
      if (!propertiesById.has(row.id)) {
        propertiesById.set(row.id, {
          id: row.id,
          code: row.code,
          address: row.address,
          type: row.property_type,
          typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
          levels: row.levels,
          units: [],
        });
      }
      if (row.unit_id) {
        propertiesById.get(row.id).units.push({
          id: row.unit_id,
          code: row.unit_code,
          designationLabel: unitDesignationLabel(row),
          status: row.unit_status,
          monthlyRent: Number(row.monthly_rent),
          currentRenter: row.renter_first_name ? `${row.renter_first_name} ${row.renter_last_name}` : null,
        });
      }
    }

    // Détail FINANCIER (versements, taux de commission, séquestre, cautions, charges à reverser) :
    // contrairement à l'annuaire ci-dessus (nom/téléphone/patrimoine, voir `canRead`), réservé à qui
    // gère réellement la relation propriétaire ou la comptabilité — un agent sans aucune de ces
    // permissions (ex. seulement `plaintes`) ne doit voir ni ces requêtes ni ces champs. Faille trouvée
    // à l'audit du 2026-10-23 : toute la fiche était jusqu'ici servie à n'importe quel employé connecté.
    const canSeeFinancials = await hasAnyPermission(req.user, 'proprietaires', 'comptabilite', 'locataires');

    let commissionRates = [];
    let activeCommissionRate = null;
    let escrowBalance = { totalCollected: 0, totalPayouts: 0, balance: 0, chargeCredits: 0, breakdown: { rent: 0, openingDebt: 0, prorata: 0, expenses: 0 } };
    let depositsHeld = null;
    let depositPositions = null;
    let depositTransfersList = null;
    let openingDebtUnpaidForOwner = 0;
    let chargesAccount = null;
    let chargeRemittances = [];
    let payouts = [];

    if (canSeeFinancials) {
      const [payoutRows] = await pool.query(
        `SELECT op.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
         FROM owner_payouts op
         JOIN users u ON u.id = op.recorded_by
         WHERE op.owner_id = :id
         ORDER BY op.paid_at DESC, op.id DESC`,
        { id },
      );
      payouts = payoutRows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: isoDate(p.paid_at),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        notes: p.notes,
        recordedBy: toActor(p.recorded_by_first_name, p.recorded_by_last_name, p.recorded_by_role),
      }));

      const [rateRows] = await pool.query(
        `SELECT cr.*, u.first_name AS set_by_first_name, u.last_name AS set_by_last_name, u.role AS set_by_role
         FROM owner_commission_rates cr
         JOIN users u ON u.id = cr.set_by
         WHERE cr.owner_id = :id
         ORDER BY cr.starts_on DESC`,
        { id },
      );
      commissionRates = rateRows.map((r) => ({
        id: r.id,
        rate: Number(r.rate),
        startsOn: isoDate(r.starts_on),
        endsOn: isoDate(r.ends_on),
        setBy: toActor(r.set_by_first_name, r.set_by_last_name, r.set_by_role),
        createdAt: r.created_at,
      }));
      // Taux de commission actif AUJOURD'HUI — voir `pickRateValidAt`
      // (services/commission.js) pour le vrai bug que ça corrige (23/09/2026).
      activeCommissionRate = pickRateValidAt(commissionRates, isoDate(new Date()));

      // Solde séquestre (comptes séquestres par mandat) : combien le cabinet
      // détient actuellement pour ce propriétaire, tous ses Biens confondus —
      // jamais scopé par agent (voir le commentaire de `getEscrowBalances`),
      // comme les versements/taux de commission ci-dessus sur cette même page.
      const escrowBalances = await getEscrowBalances(req.user.tenantId);
      const escrow = escrowBalances.get(id) ?? escrowBalance;
      escrowBalance = {
        totalCollected: escrow.totalCollected,
        totalPayouts: escrow.totalPayouts,
        balance: escrow.balance,
        chargeCredits: escrow.chargeCredits ?? 0,
        breakdown: escrow.breakdown,
      };
      // Cautions détenues (demande utilisateur, 2026-10-17) — affichées à côté de la recette nette
      // cumulée ci-dessus, jamais fondues dedans (voir le commentaire de `getDepositsHeldByOwner`).
      depositsHeld = await getDepositsHeldByOwner(req.user.tenantId, id);
      const unpaidOpeningDebtByOwner = await getUnpaidOpeningDebtByOwner(req.user.tenantId);
      openingDebtUnpaidForOwner = unpaidOpeningDebtByOwner.get(id) ?? 0;
      // Charges SONEB/SBEE encaissées à reverser (étape 31) — solde de bout en
      // bout du propriétaire, jamais scopé par agent (comme le séquestre ci-dessus).
      chargesAccount = await getChargeAccount(pool, req.user.tenantId, id);
      const remittanceRows = await listRemittances(pool, req.user.tenantId, id, { limit: 100 });
      chargeRemittances = remittanceRows.map((r) => ({
        id: r.id,
        amount: r.amount,
        periodLabel: r.periodLabel,
        paidAt: r.paidAt,
        paymentMethod: r.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod,
        kind: r.kind,
        notes: r.notes,
        recordedBy: toActor(r.byFirstName, r.byLastName, r.byRole),
        createdAt: r.createdAt,
      }));
      depositPositions = await depositTransfers.getDepositPositions(req.user.tenantId, id);
      depositTransfersList = await depositTransfers.listTransfers(req.user.tenantId, id, { limit: 50 });
    }

    res.json({
      owner: toPublicOwner(owner),
      properties: [...propertiesById.values()],
      canSeeFinancials,
      escrowBalance,
      // Cautions actuellement détenues (demande utilisateur, 2026-10-17) — à part de la recette nette
      // cumulée ci-dessus : ce n'est pas un revenu, voir `getDepositsHeldByOwner`.
      depositsHeld,
      // Cautions : ce que le cabinet détient encore, ce qui a été remis au propriétaire, et l'historique.
      depositPositions,
      depositTransfers: depositTransfersList,
      // Dette initiale des locataires non encore réglée — volontairement à
      // part du solde séquestre ci-dessus (voir `getUnpaidOpeningDebtByOwner`).
      openingDebtUnpaid: openingDebtUnpaidForOwner,
      chargesAccount,
      chargeRemittances,
      payouts,
      activeCommissionRate,
      commissionRates,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners — créer un propriétaire (fiche seule, sans bien).
router.post('/', canManage, async (req, res, next) => {
  const parsed = createOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    await assertOwnerPhoneAvailable(req.user.tenantId, data.phone);
    await conn.beginTransaction();
    await assertWithinLimit(req.user.tenantId, 'owners', conn);
    const [result] = await conn.query(
      `INSERT INTO owners (tenant_id, name, phone, email, address, notes, created_by)
       VALUES (:tenantId, :name, :phone, :email, :address, :notes, :createdBy)`,
      { tenantId: req.user.tenantId, ...data, createdBy: req.user.id },
    );
    await conn.commit();
    logger.info('Propriétaire créé', { tenantId: req.user.tenantId, ownerId: result.insertId, by: req.user.id });
    res.status(201).json({ ownerId: result.insertId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/owners/:id — modifier la fiche.
router.patch('/:id', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);
    await assertOwnerPhoneAvailable(req.user.tenantId, data.phone, id);

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

    const updated = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

/**
 * Enregistre un versement propriétaire DANS la transaction fournie (verrou du propriétaire, plafond de solde,
 * insertion, écriture comptable). Extrait de `POST /:id/payouts` pour être aussi appelé quand un paiement
 * FedaPay est confirmé (`services/payments/effects.js`) : `skipBalanceCheck` — l'argent est déjà parti, le
 * plafond a été vérifié (et réservé) à la création de l'ordre ; `skipIdempotency` — l'ordre porte sa propre clé.
 */
async function recordOwnerPayout(conn, { tenantId, ownerId, owner, data, recordedBy, skipBalanceCheck = false, skipIdempotency = false }) {
  const id = ownerId;
  // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
  // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
  await assertPeriodOpenLocked(conn, tenantId, data.paidAt);
  // Sérialise les versements d'un même propriétaire : le solde est vérifié APRÈS ce verrou et DANS la
  // transaction (garde-fou de l'audit comptable A2, voir services/commission.js
  // `assertPayoutWithinBalance`) — deux versements simultanés, chacun inférieur au solde, ne peuvent
  // plus le dépasser ensemble.
  await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
    id,
    tenantId: tenantId,
  });
  // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
  if (data.idempotencyKey && !skipIdempotency) await claimIdempotencyKey(conn, tenantId, 'owner_payout', data.idempotencyKey);
  if (!skipBalanceCheck) await assertPayoutWithinBalance(tenantId, id, data.amount, conn);

  const [result] = await conn.query(
    `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, notes, recorded_by)
     VALUES (:tenantId, :ownerId, :amount, :periodLabel, :paidAt, :paymentMethod, :notes, :recordedBy)`,
    {
      tenantId: tenantId,
      ownerId: id,
      amount: data.amount,
      periodLabel: data.periodLabel,
      paidAt: data.paidAt,
      paymentMethod: data.paymentMethod,
      notes: data.notes,
      recordedBy: recordedBy,
    },
  );

  // Module comptabilité SYSCOHADA (nouveau) — voir le commentaire identique
  // dans routes/leases.js `recordRentPayment` : rien ne change pour une
  // entreprise qui n'a pas activé le module. Cette route ne passait pas
  // par une transaction explicite avant cette modification — nécessaire
  // pour que versement et écriture comptable réussissent ou échouent
  // ensemble (exigence explicite : « même transaction SQL »).
  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId: tenantId,
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

// POST /api/owners/:id/payouts — enregistrer un versement (loyers nets reversés).
router.post('/:id/payouts', canPayout, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    await assertManualPaymentAllowed(req.user.tenantId, 'le reversement au propriétaire');
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    await conn.beginTransaction();
    const payoutId = await recordOwnerPayout(conn, {
      tenantId: req.user.tenantId, ownerId: id, owner, data, recordedBy: req.user.id,
    });
    await conn.commit();

    logger.info('Versement propriétaire enregistré', {
      tenantId: req.user.tenantId,
      ownerId: id,
      payoutId,
      by: req.user.id,
    });
    res.status(201).json({ payoutId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/owners/:id/deposit-transfers — cautions détenues (par bail et par type) et historique des reversements.
router.get('/:id/deposit-transfers', canRead, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    res.json({
      positions: await depositTransfers.getDepositPositions(req.user.tenantId, id),
      transfers: await depositTransfers.listTransfers(req.user.tenantId, id, { limit: 200 }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/deposit-transfers — reverser une caution au propriétaire (ou la récupérer auprès de lui).
// Ce n'est pas une recette du propriétaire : ni solde séquestre, ni commission. Motif obligatoire.
router.post('/:id/deposit-transfers', canPayout, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = createDepositTransferSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);
    // Entreprise qui a activé la comptabilité avancée avant l'existence de cette opération : ajoute le compte et les règles.
    if (await isModuleActive(pool, req.user.tenantId)) {
      const seed = require('../db/seedGeneralLedger');
      await seed.syncMissingAccounts(req.user.tenantId);
      await seed.syncMissingPostingRules(req.user.tenantId);
    }
    await conn.beginTransaction();
    const transferId = await depositTransfers.createTransfer(conn, {
      tenantId: req.user.tenantId, ownerId: id, owner, data, recordedBy: req.user.id,
    });
    await conn.commit();
    logger.info('Caution reversée au propriétaire', { tenantId: req.user.tenantId, ownerId: id, transferId, direction: data.direction, by: req.user.id });
    res.status(201).json({ transferId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/owners/:id/charge-remittances — reverser au propriétaire des
// charges SONEB/SBEE déjà encaissées chez ses locataires (étape 31). Le solde
// est réévalué DANS la transaction, sous verrou de la fiche propriétaire :
// deux reversements simultanés ne peuvent pas dépasser ensemble ce qui a été
// encaissé. Aucune écriture comptable automatique — voir migration 063.
router.post('/:id/charge-remittances', requireChargesEnabled, canPayout, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createChargeRemittanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);
    if (await isModuleActive(pool, req.user.tenantId)) {
      const seed = require('../db/seedGeneralLedger');
      await seed.syncMissingPostingRules(req.user.tenantId);
    }

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, data.paidAt);
    await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
      id,
      tenantId: req.user.tenantId,
    });
    // Clé d'idempotence (étape 36) : un envoi en double n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, req.user.tenantId, 'charge_remittance', data.idempotencyKey);
    await assertRemittanceWithinBalance(conn, req.user.tenantId, id, data.amount);

    // Transfert interne : le montant rejoint le solde du propriétaire, il ne sort d'aucune caisse.
    const [result] = await conn.query(
      `INSERT INTO owner_charge_remittances (tenant_id, owner_id, amount, period_label, paid_at, payment_method, kind, notes, recorded_by)
       VALUES (:tenantId, :ownerId, :amount, :periodLabel, :paidAt, 'virement', 'balance', :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        ownerId: id,
        amount: data.amount,
        periodLabel: data.periodLabel,
        paidAt: data.paidAt,
        notes: data.notes,
        recordedBy: req.user.id,
      },
    );
    const glActive = await isModuleActive(conn, req.user.tenantId);
    if (glActive) {
      await genererEcriture(conn, {
        tenantId: req.user.tenantId,
        operationType: 'charge_ajoutee_solde_proprietaire',
        entryDate: data.paidAt,
        amount: data.amount,
        narrationVars: { proprietaire: owner.name },
        sourceTable: 'owner_charge_remittances',
        sourceId: result.insertId,
        createdBy: req.user.id,
        context: { ownerId: id },
      });
    }
    await conn.commit();

    logger.info('Reversement de charges au propriétaire enregistré', {
      tenantId: req.user.tenantId,
      ownerId: id,
      remittanceId: result.insertId,
      amount: data.amount,
      by: req.user.id,
    });
    res.status(201).json({
      remittanceId: result.insertId,
      accountingNote: null,
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/owners/:id/charge-remittances/:remittanceId  { reason } — annulation
// logique d'un reversement mal saisi : la trace reste, le montant redevient « à reverser ».
router.delete('/:id/charge-remittances/:remittanceId', requireChargesEnabled, canPayout, async (req, res, next) => {
  const id = Number(req.params.id);
  const remittanceId = Number(req.params.remittanceId);
  if (!Number.isInteger(id) || !Number.isInteger(remittanceId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = cancelChargeRemittanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);
    const [rows] = await pool.query(
      'SELECT id, paid_at, amount, kind, deleted_at FROM owner_charge_remittances WHERE id = :remittanceId AND owner_id = :id AND tenant_id = :tenantId LIMIT 1',
      { remittanceId, id, tenantId: req.user.tenantId },
    );
    if (!rows[0]) throw new ApiError(404, 'Reversement introuvable');
    if (rows[0].deleted_at) throw new ApiError(409, 'Ce reversement est déjà annulé.');
    await assertPeriodOpen(req.user.tenantId, isoDate(rows[0].paid_at));

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, req.user.tenantId, isoDate(rows[0].paid_at));
    const [result] = await conn.query(
      `UPDATE owner_charge_remittances
       SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason
       WHERE id = :remittanceId AND deleted_at IS NULL`,
      { by: req.user.id, reason: parsed.data.reason, remittanceId },
    );
    if (result.affectedRows === 0) throw new ApiError(409, 'Ce reversement est déjà annulé.');
    if (rows[0].kind === 'balance') {
      // Annuler un transfert déjà versé au propriétaire rendrait son solde négatif : refusé.
      const balances = await getEscrowBalances(req.user.tenantId, conn);
      if ((balances.get(id)?.balance ?? 0) < 0) {
        throw new ApiError(409, "Ce montant a déjà été versé au propriétaire : annulation impossible (son solde deviendrait négatif).");
      }
      const [glEntries] = await conn.query(
        "SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'owner_charge_remittances' AND source_id = :remittanceId AND status = 'validee'",
        { tenantId: req.user.tenantId, remittanceId },
      );
      for (const entry of glEntries) {
        await extourneEcriture(conn, {
          tenantId: req.user.tenantId, entryId: entry.id, entryDate: new Date().toISOString().slice(0, 10),
          userId: req.user.id, reason: `Charges retirées du solde du propriétaire — ${parsed.data.reason}`,
        });
      }
    }
    await conn.commit();

    logger.info('Reversement de charges annulé', {
      tenantId: req.user.tenantId,
      ownerId: id,
      remittanceId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    res.status(204).send();
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// PUT /api/owners/:id/commission-rate — nouveau taux de commission (DG
// uniquement). Ne modifie JAMAIS un taux existant : clôture le taux actif
// (`ends_on` = la veille du nouveau départ) et insère le nouveau, dans une
// seule transaction — les recettes des mois passés restent donc calculées
// avec le taux qui était réellement en vigueur à l'époque.
router.put('/:id/commission-rate', canCommission, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateCommissionRateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const startsOn = parsed.data.startsOn ?? new Date().toISOString().slice(0, 10);

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(conn, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);

    const [activeRows] = await conn.query(
      `SELECT id, starts_on FROM owner_commission_rates
       WHERE tenant_id = :tenantId AND owner_id = :id AND ends_on IS NULL LIMIT 1`,
      { tenantId: req.user.tenantId, id },
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
        `UPDATE owner_commission_rates SET ends_on = DATE_SUB(:startsOn, INTERVAL 1 DAY) WHERE id = :id`,
        { startsOn, id: active.id },
      );
    }

    const [result] = await conn.query(
      `INSERT INTO owner_commission_rates (tenant_id, owner_id, rate, starts_on, ends_on, set_by)
       VALUES (:tenantId, :ownerId, :rate, :startsOn, NULL, :setBy)`,
      { tenantId: req.user.tenantId, ownerId: id, rate: parsed.data.rate, startsOn, setBy: req.user.id },
    );

    await conn.commit();

    logger.info('Taux de commission modifié', {
      tenantId: req.user.tenantId,
      ownerId: id,
      rateId: result.insertId,
      rate: parsed.data.rate,
      startsOn,
      previousClosedId: active?.id ?? null,
      by: req.user.id,
    });

    res.status(201).json({ rateId: result.insertId, rate: parsed.data.rate, startsOn, endsOn: null });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/owners/:id/carnet-charges.pdf?from=AAAA-MM&to=AAAA-MM — carnet des
// charges SONEB/SBEE (point par relevé, entrées, reversements). Employé :
// téléchargements illimités, sans code de vérification (comme le relevé).
router.get('/:id/carnet-charges.pdf', requireChargesEnabled, requireAnyPermission('charges', 'proprietaires', 'comptabilite'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const { fromMonth, toMonth } = resolveMonthWindow(req.query.from, req.query.to);
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    const carnet = await getOwnerCarnet(req.user.tenantId, id, { fromMonth, toMonth, scopeAgentId });
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    streamUtilityCarnetPdf(res, { tenant: tenantRows[0], owner, carnet });
  } catch (err) {
    next(err);
  }
});

// GET /api/owners/:id/statement.pdf — relevé (patrimoine + historique des versements).
router.get('/:id/statement.pdf', canReadDocs, requireFeature('owner_portal'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);

    // Même règle que la fiche : un agent restreint ne fait figurer que ses
    // propres Biens dans le relevé, jamais le patrimoine complet.
    const unitParams = { id };
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
      { id },
    );

    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });

    // Charges SONEB/SBEE des 6 derniers mois (étape 31) — dans la portée de l'agent, comme les unités.
    const { fromMonth, toMonth } = resolveMonthWindow();
    const charges = await getOwnerCarnet(req.user.tenantId, id, { fromMonth, toMonth, scopeAgentId });

    streamOwnerStatementPdf(res, {
      tenant: tenantRows[0],
      owner,
      charges,
      units: unitRows.map((u) => ({
        propertyCode: u.property_code,
        address: u.address,
        unitCode: u.unit_code,
        designationLabel: unitDesignationLabel(u),
        status: u.status,
        monthlyRent: Number(u.monthly_rent),
        currentRenter: u.renter_first_name ? `${u.renter_first_name} ${u.renter_last_name}` : null,
      })),
      depositTransfers: await (async () => {
        const dep = require('../services/depositTransfers');
        const [pos, rows] = await Promise.all([dep.getDepositPositions(req.user.tenantId, id), dep.listTransfers(req.user.tenantId, id, { limit: 24 })]);
        return { withOwner: pos.withOwnerTotal, rows };
      })(),
      payouts: payoutRows.map((p) => ({
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: p.paid_at,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/portal-link — (ré)génère le lien secret du portail
// propriétaire (étape 13, idée n°1) : recette du mois, versements, relevé
// PDF, sans compte ni mot de passe. Un seul lien valide à la fois —
// régénérer révoque immédiatement l'ancien. Le token en clair n'est renvoyé
// qu'ici, une seule fois (même principe que le portail locataire).
router.post('/:id/portal-link', canManage, requireFeature('owner_portal'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const owner = await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    assertMandateActive(owner);

    const token = generatePortalToken();
    await pool.query('UPDATE owners SET portal_token_hash = :hash, portal_link_created_at = NOW() WHERE id = :id', {
      hash: hashToken(token),
      id,
    });

    logger.info('Lien du portail propriétaire (re)généré', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    res.status(201).json({ token, path: `/portail/proprietaire/${token}` });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/end-mandate — archive ce propriétaire (demande utilisateur, 2026-10-18) :
// action volontaire du DG, jamais automatique sur « 0 Bien ». Motif obligatoire, bloquée tant qu'il
// reste au moins un Bien rattaché (il faut d'abord les réattribuer/supprimer) — un mandat terminé ne
// doit jamais laisser un Bien sans propriétaire géré. La fiche devient ensuite en lecture seule
// (`assertMandateActive` ci-dessus) jusqu'à une éventuelle réactivation.
router.post('/:id/end-mandate', canMandate, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = endMandateSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const owner = await loadOwner(pool, req.user.tenantId, id, null);
    if (owner.mandate_ended_at) throw new ApiError(409, 'Le mandat de ce propriétaire est déjà terminé.');

    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM properties WHERE owner_id = :id AND tenant_id = :tenantId',
      { id, tenantId: req.user.tenantId },
    );
    if (count > 0) {
      throw new ApiError(
        409,
        `Ce propriétaire a encore ${count} Bien${count > 1 ? 's' : ''} rattaché${count > 1 ? 's' : ''} — réattribuez-les d'abord.`,
      );
    }

    // Audit comptabilité avancée (2026-10-18) : si le module SYSCOHADA est actif pour cette
    // entreprise, ce propriétaire peut avoir un ou plusieurs comptes tiers (ex. 165 caution, 411/421
    // loyers) avec un solde non nul — un mandat qui se termine avec de l'argent encore en jeu doit
    // être régularisé avant d'être archivé, pas juste rangé à part en silence. N'affecte que les
    // entreprises ayant activé le module (la requête ne trouve simplement aucune ligne sinon).
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
      { tenantId: req.user.tenantId, id },
    );
    if (glBalanceRows.length > 0) {
      const details = glBalanceRows.map((r) => `${r.account_label} (${r.account_code})`).join(', ');
      throw new ApiError(
        409,
        `Ce propriétaire a encore un solde non nul en comptabilité avancée (${details}) — régularisez-le d'abord.`,
      );
    }

    await pool.query(
      `UPDATE owners SET mandate_ended_at = NOW(), mandate_ended_by = :by, mandate_end_reason = :reason WHERE id = :id`,
      { by: req.user.id, reason: parsed.data.reason, id },
    );

    logger.info('Mandat propriétaire terminé', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    const updated = await loadOwner(pool, req.user.tenantId, id, null);
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/owners/:id/reactivate-mandate — unique porte de sortie de l'archive (ex. un règlement
// tardif après le départ). DG uniquement, aucune précondition (toujours possible).
router.post('/:id/reactivate-mandate', canMandate, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const owner = await loadOwner(pool, req.user.tenantId, id, null);
    if (!owner.mandate_ended_at) throw new ApiError(409, 'Le mandat de ce propriétaire est déjà actif.');

    await pool.query(
      `UPDATE owners SET mandate_ended_at = NULL, mandate_ended_by = NULL, mandate_end_reason = NULL WHERE id = :id`,
      { id },
    );

    logger.info('Mandat propriétaire réactivé', { tenantId: req.user.tenantId, ownerId: id, by: req.user.id });
    const updated = await loadOwner(pool, req.user.tenantId, id, null);
    res.json({ owner: toPublicOwner(updated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.recordOwnerPayout = recordOwnerPayout;
