'use strict';

/**
 * Accès base de données du portail locataire (lecture seule sur son bail + signalement d'incident).
 * La route (`routes/portal.js`) garde la validation, les codes HTTP, les PDF et la mise en forme publique.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { claimIdempotencyKey } = require('./paymentGuards');
const complaintEvents = require('./complaintEvents');

/**
 * Charge le bail ACTIF du locataire authentifié par son token (ou lève 404).
 * Le portail ne donne accès qu'à la situation en cours, jamais à l'historique
 * de baux antérieurs (v1, volontairement minimal).
 */
async function loadActivePortalLease(tenantId, renterId) {
  const [rows] = await pool.query(
    `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom, p.address AS property_address
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId AND l.status = 'active'
     ORDER BY l.start_date DESC LIMIT 1`,
    { renterId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Aucun bail actif');
  return rows[0];
}

/**
 * Charge le DERNIER bail du locataire (actif OU terminé) — étape 48 : la
 * dérogation étroite à la restriction ci-dessus, pour les deux seules routes qui
 * en ont besoin, à l'entrée ET à la sortie, un état des lieux signé reste
 * consultable même après la fin du bail — jamais l'historique complet.
 */
async function loadLastPortalLease(tenantId, renterId) {
  const [rows] = await pool.query(
    `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom, p.address AS property_address
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId
     ORDER BY l.start_date DESC LIMIT 1`,
    { renterId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Aucun bail pour ce locataire');
  return rows[0];
}

/** Même forme que `loadInspectionReportRow` de routes/leases.js (dupliquée
 * volontairement — pas de module partagé entre les deux routeurs). */
async function loadPortalInspectionReport(reportsTable, leaseId) {
  const [rows] = await pool.query(
    `SELECT t.*, fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role
     FROM ${reportsTable} t
     LEFT JOIN users fu ON fu.id = t.finalized_by
     WHERE t.lease_id = :leaseId LIMIT 1`,
    { leaseId },
  );
  return rows[0] ?? null;
}

async function nextComplaintCode(tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM complaints WHERE tenant_id = :tenantId AND code LIKE :prefix`,
    { tenantId, prefix: `INC-${year}-%` },
  );
  return `INC-${year}-${String(Number(rows[0].n) + 1).padStart(4, '0')}`;
}

async function loadTenantRow(tenantId) {
  const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: tenantId });
  return tenant;
}

async function loadRenterRow(renterId) {
  const [[renter]] = await pool.query('SELECT * FROM renters WHERE id = :id LIMIT 1', { id: renterId });
  return renter;
}

/**
 * Tableau de bord : entreprise, bail actif et, pour celui-ci, paiements + quittances, charges non
 * soldées, derniers règlements de charges, présence d'un contrat signé ; dernier bail (actif ou terminé)
 * avec présence d'états des lieux signés. Lignes brutes — la mise en forme reste dans la route.
 */
async function getDashboardData(tenantId, renterId) {
  const [tenantRows] = await pool.query(
    'SELECT company_name, logo_path, fedapay_collect_enabled FROM tenants WHERE id = :tenantId LIMIT 1',
    { tenantId },
  );

  const [leaseRows] = await pool.query(
    `SELECT l.*, u.code AS unit_code, u.designation, u.designation_custom
       FROM leases l JOIN property_units u ON u.id = l.unit_id
       WHERE l.renter_id = :renterId AND l.tenant_id = :tenantId AND l.status = 'active'
       ORDER BY l.start_date DESC LIMIT 1`,
    { renterId, tenantId },
  );
  const activeLease = leaseRows[0] || null;

  let payRows = [];
  let chargeRows = [];
  let cpRows = [];
  let hasSignedContract = false;
  if (activeLease) {
    [payRows] = await pool.query(
      `SELECT rp.*, rc.id AS receipt_id, rc.receipt_number
         FROM rent_payments rp
         LEFT JOIN receipts rc ON rc.payment_id = rp.id
         WHERE rp.lease_id = :leaseId AND rp.deleted_at IS NULL
         ORDER BY rp.paid_at DESC, rp.id DESC`,
      { leaseId: activeLease.id },
    );

    // Charges SONEB/SBEE non entièrement réglées de ce bail.
    [chargeRows] = await pool.query(
      `SELECT uc.id, uc.utility_type, uc.period_start, uc.period_end, uc.amount,
                uc.status, COALESCE(SUM(up.amount), 0) AS paid_total
         FROM utility_charges uc
         LEFT JOIN utility_payments up ON up.charge_id = uc.id
         WHERE uc.lease_id = :leaseId AND uc.deleted_at IS NULL AND uc.status != 'payee'
         GROUP BY uc.id
         ORDER BY uc.period_start DESC`,
      { leaseId: activeLease.id },
    );

    // Règlements de charges déjà faits (avec reçu téléchargeable) — les 24 plus récents.
    [cpRows] = await pool.query(
      `SELECT up.id, up.amount, up.paid_at, uc.utility_type, uc.period_start, uc.period_end
         FROM utility_payments up
         JOIN utility_charges uc ON uc.id = up.charge_id
         WHERE uc.lease_id = :leaseId AND uc.deleted_at IS NULL
         ORDER BY up.paid_at DESC, up.id DESC LIMIT 24`,
      { leaseId: activeLease.id },
    );

    // Contrat de bail (étape 46) — le bouton de téléchargement n'a de sens que s'il a
    // effectivement été signé par les deux parties (jamais un brouillon depuis le portail public).
    const [[contract]] = await pool.query(
      "SELECT status FROM lease_contracts WHERE lease_id = :leaseId AND status = 'finalized' LIMIT 1",
      { leaseId: activeLease.id },
    );
    hasSignedContract = !!contract;
  }

  // Dernier bail (actif ou terminé) — état des lieux signés, consultables même après la fin du bail (étape 48).
  const [lastLeaseRows] = await pool.query(
    `SELECT id, status FROM leases WHERE renter_id = :renterId AND tenant_id = :tenantId ORDER BY start_date DESC LIMIT 1`,
    { renterId, tenantId },
  );
  let lastLease = null;
  if (lastLeaseRows[0]) {
    const [[moveIn]] = await pool.query(
      "SELECT id FROM move_in_reports WHERE lease_id = :leaseId AND status = 'finalized' LIMIT 1",
      { leaseId: lastLeaseRows[0].id },
    );
    const [[moveOut]] = await pool.query(
      "SELECT id FROM move_out_reports WHERE lease_id = :leaseId AND status = 'finalized' LIMIT 1",
      { leaseId: lastLeaseRows[0].id },
    );
    lastLease = { id: lastLeaseRows[0].id, hasSignedMoveIn: !!moveIn, hasSignedMoveOut: !!moveOut };
  }

  return { tenantRow: tenantRows[0] ?? null, activeLease, payRows, chargeRows, cpRows, hasSignedContract, lastLease };
}

/** Données de SA quittance de loyer (paiement du bail actif + quittance + émetteur). */
async function getRentReceiptData(tenantId, renterId, paymentId) {
  const lease = await loadActivePortalLease(tenantId, renterId);

  const [paymentRows] = await pool.query(
    'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId AND deleted_at IS NULL LIMIT 1',
    { paymentId, leaseId: lease.id },
  );
  if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');

  const [receiptRows] = await pool.query('SELECT * FROM receipts WHERE payment_id = :paymentId LIMIT 1', { paymentId });
  if (!receiptRows[0]) throw new ApiError(404, 'Quittance introuvable');

  const renter = await loadRenterRow(renterId);
  const tenant = await loadTenantRow(tenantId);
  // Cachet/signature de l'employé qui a réellement encaissé ce paiement.
  const [issuerRows] = await pool.query('SELECT * FROM users WHERE id = :id LIMIT 1', {
    id: paymentRows[0].recorded_by,
  });

  return { lease, payment: paymentRows[0], receipt: receiptRows[0], renter, tenant, issuer: issuerRows[0] || null };
}

/** Données du reçu de SON règlement de charges. */
async function getChargeReceiptData(tenantId, renterId, paymentId) {
  const lease = await loadActivePortalLease(tenantId, renterId);
  const [[row]] = await pool.query(
    `SELECT up.id, up.amount, up.paid_at, uc.utility_type, uc.period_start, uc.period_end
       FROM utility_payments up JOIN utility_charges uc ON uc.id = up.charge_id
       WHERE up.id = :paymentId AND uc.lease_id = :leaseId AND up.tenant_id = :tenantId AND uc.deleted_at IS NULL LIMIT 1`,
    { paymentId, leaseId: lease.id, tenantId },
  );
  if (!row) throw new ApiError(404, 'Paiement introuvable');
  const renter = await loadRenterRow(renterId);
  const tenant = await loadTenantRow(tenantId);
  return { tenant, renter, row };
}

/** Données du contrat signé (bail actif). `loadContractRow` vient de `services/leaseContract`. */
async function getContractData(tenantId, renterId, loadContractRow) {
  const lease = await loadActivePortalLease(tenantId, renterId);

  const contractRow = await loadContractRow(tenantId, lease.id);
  if (!contractRow || contractRow.status !== 'finalized') {
    throw new ApiError(404, "Le contrat de ce bail n'a pas encore été signé par les deux parties.");
  }

  const tenant = await loadTenantRow(tenantId);
  // Pas d'employé "signataire" particulier depuis le portail : le DG de
  // l'entreprise signe par défaut (toujours exactement un par tenant).
  const [dgRows] = await pool.query(
    "SELECT first_name, last_name, role, stamp_path, signature_path FROM users WHERE tenant_id = :tenantId AND role = 'dg' LIMIT 1",
    { tenantId },
  );
  const issuer = dgRows[0] || { first_name: tenant?.company_name ?? "L'entreprise", last_name: '' };

  return { lease, contractRow, tenant, issuer };
}

/** Données de l'état des lieux d'entrée signé (dernier bail). */
async function getMoveInData(tenantId, renterId) {
  const lease = await loadLastPortalLease(tenantId, renterId);

  const row = await loadPortalInspectionReport('move_in_reports', lease.id);
  if (!row || row.status !== 'finalized') {
    throw new ApiError(404, "L'état des lieux d'entrée de ce bail n'a pas encore été signé.");
  }

  const renter = await loadRenterRow(renterId);
  const tenant = await loadTenantRow(tenantId);
  return { lease, row, renter, tenant };
}

/** Données du PV de sortie signé (dernier bail) + lignes de l'état des lieux d'entrée pour comparaison. */
async function getMoveOutData(tenantId, renterId) {
  const lease = await loadLastPortalLease(tenantId, renterId);

  const row = await loadPortalInspectionReport('move_out_reports', lease.id);
  if (!row || row.status !== 'finalized') {
    throw new ApiError(404, "L'état des lieux de sortie de ce bail n'a pas encore été signé.");
  }

  const renter = await loadRenterRow(renterId);
  const tenant = await loadTenantRow(tenantId);
  const moveInRow = await loadPortalInspectionReport('move_in_reports', lease.id);
  return { lease, row, renter, tenant, moveInRow };
}

/** Signalement d'incident sur son bail actif, avec clé d'idempotence optionnelle. */
async function createPortalComplaint(tenantId, renterId, data) {
  const conn = await pool.getConnection();
  try {
    const lease = await loadActivePortalLease(tenantId, renterId);
    const code = await nextComplaintCode(tenantId);

    await conn.beginTransaction();
    // Clé d'idempotence (même principe que routes/complaints.js) : un envoi
    // en double sur reconnexion instable n'enregistre rien de plus.
    if (data.idempotencyKey) await claimIdempotencyKey(conn, tenantId, 'complaint', data.idempotencyKey);

    const [result] = await conn.query(
      `INSERT INTO complaints
         (tenant_id, lease_id, code, title, description, priority, reported_at, created_by, reported_via_portal)
       VALUES (:tenantId, :leaseId, :code, :title, :description, :priority, CURDATE(), NULL, 1)`,
      {
        tenantId,
        leaseId: lease.id,
        code,
        title: data.title,
        description: data.description,
        priority: data.priority,
      },
    );
    await complaintEvents.recordReported(conn, { tenantId, complaintId: result.insertId, renterId });
    const trackingToken = await complaintEvents.ensureTrackingToken(conn, result.insertId);
    await conn.commit();
    return { complaintId: result.insertId, code, leaseId: lease.id, trackingPath: `/suivi/${trackingToken}` };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Paiement en ligne de SON loyer : valide le montant (borne : un an de loyer) et charge les parties. */
async function prepareRentCheckout(tenantId, renterId, amount) {
  const lease = await loadActivePortalLease(tenantId, renterId);
  if (!Number.isInteger(amount) || amount < 100 || amount > Number(lease.monthly_rent) * 12) {
    throw new ApiError(400, 'Montant invalide');
  }
  const tenant = await loadTenantRow(tenantId);
  const [[renter]] = await pool.query('SELECT first_name, last_name, email FROM renters WHERE id = :id LIMIT 1', { id: renterId });
  return { tenant, renter, leaseId: lease.id };
}

/** Paiement en ligne d'une facture de charges : le montant est le RESTE DÛ calculé côté serveur. */
async function prepareChargeCheckout(tenantId, renterId, chargeId) {
  const lease = await loadActivePortalLease(tenantId, renterId);
  const [[charge]] = await pool.query(
    'SELECT id, amount FROM utility_charges WHERE id = :id AND lease_id = :leaseId AND deleted_at IS NULL LIMIT 1',
    { id: chargeId, leaseId: lease.id },
  );
  if (!charge) throw new ApiError(404, 'Facture introuvable');
  const [[{ paidTotal }]] = await pool.query('SELECT COALESCE(SUM(amount), 0) AS paidTotal FROM utility_payments WHERE charge_id = :id', { id: chargeId });
  const remaining = Number(charge.amount) - Number(paidTotal);
  if (remaining <= 0) throw new ApiError(400, 'Cette facture est déjà entièrement réglée');
  const tenant = await loadTenantRow(tenantId);
  const [[renter]] = await pool.query('SELECT first_name, last_name, email FROM renters WHERE id = :id LIMIT 1', { id: renterId });
  return { tenant, renter, remaining };
}

module.exports = {
  getDashboardData,
  getRentReceiptData,
  getChargeReceiptData,
  getContractData,
  getMoveInData,
  getMoveOutData,
  createPortalComplaint,
  prepareRentCheckout,
  prepareChargeCheckout,
};
