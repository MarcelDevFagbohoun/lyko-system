'use strict';

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const {
  createRenterSchema,
  updateRenterSchema,
  createLeaseSchema,
} = require('../validators/renters');
const { UNIT_DESIGNATIONS, PROPERTY_TYPES } = require('../constants/properties');
const { computeArrears } = require('../services/rentTracking');
const { streamCertificatePdf } = require('../services/pdf');
const { toActor } = require('../utils/actor');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const { resolvePropertyScope, assertRenterInScope } = require('../services/scope');
const logger = require('../utils/logger');

const router = Router();
router.use(requireAuth);

// Lecture de la liste/fiche (nom, téléphone, adresse, statut du bail) :
// ouverte à tout employé authentifié de l'entreprise, même sans permission
// `locataires` assignée — un agent sans cette permission doit pouvoir
// consulter l'annuaire, seulement pas le gérer. `requireAuth` au niveau du
// router suffit déjà ; ce middleware ne fait donc rien de plus, mais reste
// nommé pour documenter l'intention sur les routes qui l'utilisent.
const canRead = (req, res, next) => next();
// Document financier généré à la demande (attestation) : reste réservé à
// qui gère la relation locataire ou à la comptabilité — une simple
// consultation de fiche n'inclut pas la génération de documents officiels.
const canReadDocs = requireAnyPermission('locataires', 'comptabilite');
// Écriture (créer/modifier un locataire, ouvrir un bail) : réservé à qui gère
// la relation locataire (agent/DG).
const canManage = requirePermission('locataires');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));
const PROPERTY_TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.key, t.label]));

function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function unitDesignationLabel(row) {
  return row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
}

function toPublicUnitSummary(row) {
  return {
    id: row.unit_id,
    code: row.unit_code,
    designation: row.designation,
    designationLabel: unitDesignationLabel(row),
    sonebMeterNumber: row.soneb_meter_number,
    sbeeMeterNumber: row.sbee_meter_number,
    furnished: !!row.furnished,
    property: {
      id: row.property_id,
      code: row.property_code,
      owner: { id: row.owner_id, name: row.owner_name, phone: row.owner_phone },
      address: row.address,
      type: row.property_type,
      typeLabel: PROPERTY_TYPE_LABELS[row.property_type] ?? row.property_type,
      levels: row.levels,
    },
  };
}

function toPublicLease(row) {
  return {
    id: row.lease_id ?? row.id,
    monthlyRent: Number(row.lease_monthly_rent ?? row.monthly_rent),
    depositAmount: Number(row.deposit_amount),
    depositStatus: row.deposit_status,
    rentDueDay: row.rent_due_day,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    status: row.lease_status ?? row.status,
    createdBy: toActor(row.lease_creator_first_name, row.lease_creator_last_name, row.lease_creator_role),
    unit: toPublicUnitSummary(row),
  };
}

function toPublicRenter(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    profession: row.profession,
    notes: row.notes,
    createdBy: toActor(row.renter_creator_first_name, row.renter_creator_last_name, row.renter_creator_role),
    createdAt: row.created_at,
    // Jamais le token/hash lui-même ici (uniquement renvoyé une fois, à la
    // création du lien) — juste de quoi afficher « Générer » ou « Régénérer ».
    hasPortalLink: !!row.portal_token_hash,
  };
}

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
};

// Colonnes communes bail + unité + bien + propriétaire, réutilisées par la
// liste et la fiche (le propriétaire est une fiche à part depuis l'étape 5 :
// jointure sur owners plutôt que des colonnes texte sur properties).
const LEASE_UNIT_PROPERTY_SELECT = `
  l.id AS lease_id, l.monthly_rent AS lease_monthly_rent, l.deposit_amount,
  l.deposit_status, l.rent_due_day, l.start_date, l.end_date, l.status AS lease_status,
  lu.first_name AS lease_creator_first_name, lu.last_name AS lease_creator_last_name, lu.role AS lease_creator_role,
  u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
  u.soneb_meter_number, u.sbee_meter_number, u.furnished,
  p.id AS property_id, p.code AS property_code, p.address, p.property_type, p.levels,
  o.id AS owner_id, o.name AS owner_name, o.phone AS owner_phone
`;
// Jointure sur l'auteur du bail — à ajouter au FROM partout où
// LEASE_UNIT_PROPERTY_SELECT est utilisé.
const LEASE_CREATOR_JOIN = 'LEFT JOIN users lu ON lu.id = l.created_by';

// GET /api/renters — liste avec bail actif et statut de paiement.
router.get('/', canRead, async (req, res, next) => {
  try {
    // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que les
    // locataires dont le bail actif porte sur un Bien qui lui est attribué —
    // via une sous-requête EXISTS plutôt que le LEFT JOIN `p` ci-dessous
    // (celui-ci reste LEFT car un locataire sans bail actif doit continuer
    // d'apparaître pour qui a un accès complet).
    const scopeAgentId = await resolvePropertyScope(req.user);
    const params = { tenantId: req.user.tenantId };
    let scopeClause = '';
    if (scopeAgentId != null) {
      scopeClause = `
        AND EXISTS (
          SELECT 1 FROM leases sl
          JOIN property_units su ON su.id = sl.unit_id
          JOIN properties sp ON sp.id = su.property_id
          WHERE sl.renter_id = r.id AND sl.status = 'active' AND sp.agent_id = :scopeAgentId
        )`;
      params.scopeAgentId = scopeAgentId;
    }

    const [rows] = await pool.query(
      `SELECT r.*,
              ru.first_name AS renter_creator_first_name, ru.last_name AS renter_creator_last_name, ru.role AS renter_creator_role,
              ${LEASE_UNIT_PROPERTY_SELECT}
       FROM renters r
       LEFT JOIN users ru ON ru.id = r.created_by
       LEFT JOIN leases l ON l.renter_id = r.id AND l.status = 'active'
       ${LEASE_CREATOR_JOIN}
       LEFT JOIN property_units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = u.property_id
       LEFT JOIN owners o ON o.id = p.owner_id
       WHERE r.tenant_id = :tenantId
       ${scopeClause}
       ORDER BY r.created_at DESC`,
      params,
    );

    const leaseIds = rows.filter((r) => r.lease_id).map((r) => r.lease_id);
    const paymentsByLease = new Map();
    if (leaseIds.length > 0) {
      const placeholders = leaseIds.map(() => '?').join(',');
      const [payments] = await pool.query(
        `SELECT lease_id, covers_month FROM rent_payments WHERE lease_id IN (${placeholders})`,
        leaseIds,
      );
      for (const p of payments) {
        if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
        paymentsByLease.get(p.lease_id).push({ coversMonth: p.covers_month });
      }
    }

    const renters = rows.map((row) => {
      const renter = toPublicRenter(row);
      if (!row.lease_id) return { ...renter, activeLease: null, arrears: null };
      const lease = toPublicLease(row);
      const arrears = computeArrears({
        startDate: lease.startDate,
        rentDueDay: lease.rentDueDay,
        payments: paymentsByLease.get(row.lease_id) || [],
      });
      return { ...renter, activeLease: lease, arrears };
    });

    res.json({ renters });
  } catch (err) {
    next(err);
  }
});

// GET /api/renters/:id — fiche complète (baux, paiements, quittances, état des lieux).
router.get('/:id', canRead, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    const [renterRows] = await pool.query(
      `SELECT r.*, ru.first_name AS renter_creator_first_name, ru.last_name AS renter_creator_last_name, ru.role AS renter_creator_role
       FROM renters r LEFT JOIN users ru ON ru.id = r.created_by
       WHERE r.id = :id AND r.tenant_id = :tenantId LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!renterRows[0]) throw new ApiError(404, 'Locataire introuvable');

    const [leaseRows] = await pool.query(
      `SELECT l.*, ${LEASE_UNIT_PROPERTY_SELECT}
       FROM leases l
       ${LEASE_CREATOR_JOIN}
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN owners o ON o.id = p.owner_id
       WHERE l.renter_id = :id AND l.tenant_id = :tenantId
       ORDER BY l.start_date DESC`,
      { id, tenantId: req.user.tenantId },
    );

    const leaseIds = leaseRows.map((l) => l.id);
    let paymentsByLease = new Map();
    let receiptsByPayment = new Map();
    let moveInByLease = new Map();
    let moveOutByLease = new Map();

    if (leaseIds.length > 0) {
      const placeholders = leaseIds.map(() => '?').join(',');
      const [payments] = await pool.query(
        `SELECT rp.*, pu.first_name AS recorder_first_name, pu.last_name AS recorder_last_name, pu.role AS recorder_role
         FROM rent_payments rp JOIN users pu ON pu.id = rp.recorded_by
         WHERE rp.lease_id IN (${placeholders}) ORDER BY rp.paid_at DESC, rp.id DESC`,
        leaseIds,
      );
      const paymentIds = payments.map((p) => p.id);
      let receipts = [];
      if (paymentIds.length > 0) {
        const ph2 = paymentIds.map(() => '?').join(',');
        [receipts] = await pool.query(
          `SELECT * FROM receipts WHERE payment_id IN (${ph2})`,
          paymentIds,
        );
      }
      receiptsByPayment = new Map(receipts.map((r) => [r.payment_id, r]));

      for (const p of payments) {
        if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
        const receipt = receiptsByPayment.get(p.id);
        paymentsByLease.get(p.lease_id).push({
          id: p.id,
          coversMonth: p.covers_month,
          amount: Number(p.amount),
          paymentMethod: p.payment_method,
          paymentMethodLabel: PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method,
          paidAt: isoDate(p.paid_at),
          notes: p.notes,
          recordedBy: toActor(p.recorder_first_name, p.recorder_last_name, p.recorder_role),
          receipt: receipt ? { id: receipt.id, number: receipt.receipt_number, issuedAt: receipt.issued_at } : null,
        });
      }

      const [reports] = await pool.query(
        `SELECT mir.*, mu.first_name AS conductor_first_name, mu.last_name AS conductor_last_name, mu.role AS conductor_role
         FROM move_in_reports mir JOIN users mu ON mu.id = mir.conducted_by
         WHERE mir.lease_id IN (${placeholders})`,
        leaseIds,
      );
      moveInByLease = new Map(reports.map((r) => [r.lease_id, r]));

      const [outReports] = await pool.query(
        `SELECT mor.*, mu.first_name AS conductor_first_name, mu.last_name AS conductor_last_name, mu.role AS conductor_role
         FROM move_out_reports mor JOIN users mu ON mu.id = mor.conducted_by
         WHERE mor.lease_id IN (${placeholders})`,
        leaseIds,
      );
      moveOutByLease = new Map(outReports.map((r) => [r.lease_id, r]));
    }

    const leases = leaseRows.map((row) => {
      const lease = toPublicLease(row);
      const payments = paymentsByLease.get(row.id) || [];
      const isActive = row.status === 'active';
      const report = moveInByLease.get(row.id);
      const outReport = moveOutByLease.get(row.id);
      return {
        ...lease,
        payments,
        arrears: isActive
          ? computeArrears({ startDate: lease.startDate, rentDueDay: lease.rentDueDay, payments })
          : null,
        moveInReport: report
          ? {
              id: report.id,
              conductedAt: isoDate(report.conducted_at),
              items: report.items,
              generalNotes: report.general_notes,
              conductedBy: toActor(report.conductor_first_name, report.conductor_last_name, report.conductor_role),
            }
          : null,
        moveOutReport: outReport
          ? {
              id: outReport.id,
              conductedAt: isoDate(outReport.conducted_at),
              items: outReport.items,
              generalNotes: outReport.general_notes,
              otherDeductionsAmount: Number(outReport.other_deductions_amount),
              otherDeductionsNote: outReport.other_deductions_note,
              depositAmount: Number(outReport.deposit_amount),
              totalDeductions: Number(outReport.total_deductions),
              netRefund: Number(outReport.net_refund),
              conductedBy: toActor(outReport.conductor_first_name, outReport.conductor_last_name, outReport.conductor_role),
            }
          : null,
      };
    });

    res.json({
      renter: toPublicRenter(renterRows[0]),
      leases,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Charge une unité LIBRE de l'entreprise courante, ou lève une erreur
 * explicite. `scopeAgentId` (étape 14) : un agent restreint ne peut installer
 * un locataire que sur une unité d'un Bien qui lui est attribué — 404, pas
 * 409, pour ne jamais laisser deviner qu'une unité existe hors de sa portée.
 */
async function loadAvailableUnit(conn, tenantId, unitId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT u.*, p.code AS property_code, p.agent_id AS property_agent_id
     FROM property_units u JOIN properties p ON p.id = u.property_id
     WHERE u.id = :unitId AND u.tenant_id = :tenantId LIMIT 1`,
    { unitId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Unité introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Unité introuvable');
  }
  if (rows[0].status !== 'libre') {
    throw new ApiError(409, `Cette unité n'est pas libre (statut : ${rows[0].status}).`);
  }
  return rows[0];
}

// POST /api/renters — création d'un locataire + bail sur une unité libre existante.
router.post('/', canManage, async (req, res, next) => {
  const parsed = createRenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const unit = await loadAvailableUnit(conn, req.user.tenantId, data.unitId, scopeAgentId);

    await conn.beginTransaction();

    const [renterResult] = await conn.query(
      `INSERT INTO renters (tenant_id, first_name, last_name, phone, email, profession, notes, created_by)
       VALUES (:tenantId, :firstName, :lastName, :phone, :email, :profession, :notes, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        email: data.email,
        profession: data.profession,
        notes: data.notes,
        createdBy: req.user.id,
      },
    );
    const renterId = renterResult.insertId;

    const rent = data.monthlyRent ?? Number(unit.monthly_rent);
    const [leaseResult] = await conn.query(
      `INSERT INTO leases (tenant_id, unit_id, renter_id, monthly_rent, deposit_amount, rent_due_day, start_date, created_by)
       VALUES (:tenantId, :unitId, :renterId, :rent, :deposit, :dueDay, :startDate, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        unitId: data.unitId,
        renterId,
        rent,
        deposit: data.depositAmount,
        dueDay: data.rentDueDay,
        startDate: data.startDate,
        createdBy: req.user.id,
      },
    );
    const leaseId = leaseResult.insertId;

    await conn.query("UPDATE property_units SET status = 'loue' WHERE id = :unitId", { unitId: data.unitId });

    // Lien du portail locataire (étape 13, idée n°2) : généré automatiquement
    // dès la création, jamais une étape à part que quelqu'un pourrait oublier
    // — le locataire doit pouvoir suivre ses paiements, télécharger ses
    // quittances et signaler une plainte dès son premier jour. Le token n'est
    // renvoyé qu'ici, une seule fois (voir `POST /:id/portal-link` pour le
    // régénérer plus tard s'il est perdu/compromis).
    const portalToken = generatePortalToken();
    await conn.query('UPDATE renters SET portal_token_hash = :hash WHERE id = :id', {
      hash: hashToken(portalToken),
      id: renterId,
    });

    await conn.commit();

    logger.info('Locataire créé', { tenantId: req.user.tenantId, renterId, leaseId, unitId: data.unitId, by: req.user.id });
    res.status(201).json({
      renterId,
      leaseId,
      unitId: data.unitId,
      portalLink: { token: portalToken, path: `/portail/${portalToken}` },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/renters/:id — mise à jour de l'identité du locataire.
router.patch('/:id', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateRenterSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const [existing] = await pool.query(
      'SELECT id FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!existing[0]) throw new ApiError(404, 'Locataire introuvable');
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    const fields = [];
    const params = { id };
    if (data.firstName !== undefined) { fields.push('first_name = :firstName'); params.firstName = data.firstName; }
    if (data.lastName !== undefined) { fields.push('last_name = :lastName'); params.lastName = data.lastName; }
    if (data.email !== undefined) { fields.push('email = :email'); params.email = data.email; }
    if (data.profession !== undefined) { fields.push('profession = :profession'); params.profession = data.profession; }
    if (data.notes !== undefined) { fields.push('notes = :notes'); params.notes = data.notes; }

    if (fields.length > 0) {
      await pool.query(`UPDATE renters SET ${fields.join(', ')} WHERE id = :id`, params);
    }

    const [rows] = await pool.query(
      `SELECT r.*, ru.first_name AS renter_creator_first_name, ru.last_name AS renter_creator_last_name, ru.role AS renter_creator_role
       FROM renters r LEFT JOIN users ru ON ru.id = r.created_by WHERE r.id = :id`,
      { id },
    );
    res.json({ renter: toPublicRenter(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/renters/:id/leases — nouveau bail sur une unité libre (renouvellement / changement d'unité).
router.post('/:id/leases', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  const conn = await pool.getConnection();
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const [existing] = await conn.query(
      'SELECT id FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!existing[0]) throw new ApiError(404, 'Locataire introuvable');
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    const unit = await loadAvailableUnit(conn, req.user.tenantId, data.unitId, scopeAgentId);

    await conn.beginTransaction();

    const rent = data.monthlyRent ?? Number(unit.monthly_rent);
    const [leaseResult] = await conn.query(
      `INSERT INTO leases (tenant_id, unit_id, renter_id, monthly_rent, deposit_amount, rent_due_day, start_date, created_by)
       VALUES (:tenantId, :unitId, :renterId, :rent, :deposit, :dueDay, :startDate, :createdBy)`,
      {
        tenantId: req.user.tenantId,
        unitId: data.unitId,
        renterId: id,
        rent,
        deposit: data.depositAmount,
        dueDay: data.rentDueDay,
        startDate: data.startDate,
        createdBy: req.user.id,
      },
    );
    const leaseId = leaseResult.insertId;

    await conn.query("UPDATE property_units SET status = 'loue' WHERE id = :unitId", { unitId: data.unitId });

    await conn.commit();
    logger.info('Nouveau bail', { tenantId: req.user.tenantId, renterId: id, leaseId, unitId: data.unitId, by: req.user.id });
    res.status(201).json({ leaseId, unitId: data.unitId });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/renters/:id/certificate.pdf — attestation de loyer (bail actif).
router.get('/:id/certificate.pdf', canReadDocs, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    const [renterRows] = await pool.query(
      'SELECT * FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!renterRows[0]) throw new ApiError(404, 'Locataire introuvable');

    const [leaseRows] = await pool.query(
      `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom,
              p.address
       FROM leases l
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       WHERE l.renter_id = :id AND l.tenant_id = :tenantId AND l.status = 'active'
       ORDER BY l.start_date DESC LIMIT 1`,
      { id, tenantId: req.user.tenantId },
    );
    if (!leaseRows[0]) throw new ApiError(404, 'Aucun bail actif pour ce locataire');

    const unitRow = leaseRows[0];
    const label = unitDesignationLabel(unitRow);

    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', {
      id: req.user.tenantId,
    });
    const [issuerRows] = await pool.query('SELECT first_name, last_name FROM users WHERE id = :id LIMIT 1', {
      id: req.user.id,
    });

    streamCertificatePdf(res, {
      tenant: tenantRows[0],
      renter: renterRows[0],
      property: { label, address: unitRow.address },
      lease: leaseRows[0],
      issuer: issuerRows[0],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/renters/:id/portal-link — (ré)génère le lien secret du portail
// locataire (idée validée avec l'utilisateur : accès en lecture à ses
// paiements/quittances/attestation + signalement d'incident, sans compte,
// sans mot de passe). Un seul lien valide à la fois : régénérer révoque
// immédiatement l'ancien. Le token en clair n'est renvoyé qu'ici, une seule
// fois — seule son empreinte est conservée (voir `utils/tokens.js`).
router.post('/:id/portal-link', canManage, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await assertRenterInScope(req.user.tenantId, id, scopeAgentId);

    const [renterRows] = await pool.query(
      'SELECT id, first_name, last_name, phone FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id, tenantId: req.user.tenantId },
    );
    if (!renterRows[0]) throw new ApiError(404, 'Locataire introuvable');

    const token = generatePortalToken();
    await pool.query('UPDATE renters SET portal_token_hash = :hash WHERE id = :id', {
      hash: hashToken(token),
      id,
    });

    logger.info('Lien du portail locataire (re)généré', {
      tenantId: req.user.tenantId,
      renterId: id,
      by: req.user.id,
    });
    res.status(201).json({ token, path: `/portail/${token}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
