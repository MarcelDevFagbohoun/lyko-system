'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireAnyPermission, requireRole } = require('../middleware/auth');
const {
  createOwnerSchema,
  updateOwnerSchema,
  createPayoutSchema,
  updateCommissionRateSchema,
} = require('../validators/owners');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { streamOwnerStatementPdf } = require('../services/pdf');
const { toActor } = require('../utils/actor');
const { assertPeriodOpen } = require('../services/accountingPeriods');
const { resolvePropertyScope } = require('../services/scope');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);

// Lecture du répertoire/de la fiche (nom, téléphone, patrimoine) : ouverte à
// tout employé authentifié, même sans permission `proprietaires` assignée —
// un agent doit pouvoir consulter, seulement pas gérer (même principe que
// les locataires). `requireAuth` au niveau du router suffit déjà.
const canRead = (req, res, next) => next();
// Relevé PDF généré à la demande : reste réservé à qui gère la relation
// propriétaire/locataire ou à la comptabilité, comme l'attestation de loyer.
const canReadDocs = requireAnyPermission('proprietaires', 'comptabilite', 'locataires');
// Créer/modifier une fiche propriétaire : propriétaires (module dédié) ou
// locataires (création à la volée d'un propriétaire depuis le formulaire
// Bien) — pas comptabilite, qui n'a pas vocation à modifier les fiches.
const canManage = requireAnyPermission('proprietaires', 'locataires');
// Enregistrer un versement : action financière (relation propriétaire),
// réservée à proprietaires/comptabilite — pas locataires, qui gère les
// Biens mais pas les flux d'argent vers les bailleurs.
const canPayout = requireAnyPermission('proprietaires', 'comptabilite');
// Modifier le taux de commission : DG uniquement (cahier des charges), pas
// même le comptable — c'est une décision de gérance, pas une saisie.
const canCommission = requireRole('dg');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
};

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

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
    ...extra,
  };
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
    `SELECT o.*, cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.role AS creator_role
     FROM owners o LEFT JOIN users cu ON cu.id = o.created_by
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
              COUNT(DISTINCT p.id) AS properties_count,
              COUNT(u.id) AS units_count,
              SUM(CASE WHEN u.status = 'loue' THEN 1 ELSE 0 END) AS units_occupied,
              SUM(CASE WHEN u.status = 'loue' THEN u.monthly_rent ELSE 0 END) AS monthly_rent_total
       FROM owners o
       LEFT JOIN users cu ON cu.id = o.created_by
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

    const [payoutRows] = await pool.query(
      `SELECT op.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name, u.role AS recorded_by_role
       FROM owner_payouts op
       JOIN users u ON u.id = op.recorded_by
       WHERE op.owner_id = :id
       ORDER BY op.paid_at DESC, op.id DESC`,
      { id },
    );

    const [rateRows] = await pool.query(
      `SELECT cr.*, u.first_name AS set_by_first_name, u.last_name AS set_by_last_name, u.role AS set_by_role
       FROM owner_commission_rates cr
       JOIN users u ON u.id = cr.set_by
       WHERE cr.owner_id = :id
       ORDER BY cr.starts_on DESC`,
      { id },
    );
    const commissionRates = rateRows.map((r) => ({
      id: r.id,
      rate: Number(r.rate),
      startsOn: isoDate(r.starts_on),
      endsOn: isoDate(r.ends_on),
      setBy: toActor(r.set_by_first_name, r.set_by_last_name, r.set_by_role),
      createdAt: r.created_at,
    }));

    res.json({
      owner: toPublicOwner(owner),
      properties: [...propertiesById.values()],
      payouts: payoutRows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        periodLabel: p.period_label,
        paidAt: isoDate(p.paid_at),
        paymentMethod: p.payment_method,
        paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
        notes: p.notes,
        recordedBy: toActor(p.recorded_by_first_name, p.recorded_by_last_name, p.recorded_by_role),
      })),
      // Taux de commission (nouveau) : le premier élément (ends_on IS NULL)
      // est le taux actif, le reste l'historique — jamais écrasé.
      activeCommissionRate: commissionRates.find((r) => !r.endsOn) ?? null,
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

  try {
    const [result] = await pool.query(
      `INSERT INTO owners (tenant_id, name, phone, email, address, notes, created_by)
       VALUES (:tenantId, :name, :phone, :email, :address, :notes, :createdBy)`,
      { tenantId: req.user.tenantId, ...data, createdBy: req.user.id },
    );
    logger.info('Propriétaire créé', { tenantId: req.user.tenantId, ownerId: result.insertId, by: req.user.id });
    res.status(201).json({ ownerId: result.insertId });
  } catch (err) {
    next(err);
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
    await loadOwner(pool, req.user.tenantId, id, scopeAgentId);

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

// POST /api/owners/:id/payouts — enregistrer un versement (loyers nets reversés).
router.post('/:id/payouts', canPayout, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadOwner(pool, req.user.tenantId, id, scopeAgentId);
    await assertPeriodOpen(req.user.tenantId, data.paidAt);

    const [result] = await pool.query(
      `INSERT INTO owner_payouts (tenant_id, owner_id, amount, period_label, paid_at, payment_method, notes, recorded_by)
       VALUES (:tenantId, :ownerId, :amount, :periodLabel, :paidAt, :paymentMethod, :notes, :recordedBy)`,
      {
        tenantId: req.user.tenantId,
        ownerId: id,
        amount: data.amount,
        periodLabel: data.periodLabel,
        paidAt: data.paidAt,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        recordedBy: req.user.id,
      },
    );

    logger.info('Versement propriétaire enregistré', {
      tenantId: req.user.tenantId,
      ownerId: id,
      payoutId: result.insertId,
      by: req.user.id,
    });
    res.status(201).json({ payoutId: result.insertId });
  } catch (err) {
    next(err);
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
    await loadOwner(conn, req.user.tenantId, id, scopeAgentId);

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

// GET /api/owners/:id/statement.pdf — relevé (patrimoine + historique des versements).
router.get('/:id/statement.pdf', canReadDocs, async (req, res, next) => {
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

    streamOwnerStatementPdf(res, {
      tenant: tenantRows[0],
      owner,
      units: unitRows.map((u) => ({
        propertyCode: u.property_code,
        address: u.address,
        unitCode: u.unit_code,
        designationLabel: unitDesignationLabel(u),
        status: u.status,
        monthlyRent: Number(u.monthly_rent),
        currentRenter: u.renter_first_name ? `${u.renter_first_name} ${u.renter_last_name}` : null,
      })),
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
router.post('/:id/portal-link', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await loadOwner(pool, req.user.tenantId, id, scopeAgentId);

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

module.exports = router;
