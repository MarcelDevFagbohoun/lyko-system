'use strict';

// Étape 10 (fonctionnalités transversales) — Tableau de bord DG : vue
// d'ensemble multi-modules (occupation du parc, plaintes en cours, journal
// d'activité). Strictement réservé au DG (`requireRole('dg')`), cohérent
// avec le cadrage de la maquette « Supervision DG » — les chiffres
// financiers (loyers encaissés, impayés, dépenses...) restent calculés par
// `GET /api/accounting/dashboard`, déjà existant : cette route ne duplique
// pas ce calcul, le frontend compose les deux réponses.

const { Router } = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listRecentActivity } = require('../services/activity');

const router = Router();
router.use(requireAuth, requireRole('dg'));

const COMPLAINT_STATUS_LABELS = {
  ouverte: 'Ouverte',
  en_cours: 'En cours',
  resolue: 'Résolue',
  fermee: 'Fermée',
};

// GET /api/dashboard/overview — occupation du parc + activité récente hors finances.
router.get('/overview', async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;

    const [[unitStats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'loue' THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN status = 'libre' THEN 1 ELSE 0 END) AS free,
              SUM(CASE WHEN status = 'reserve' THEN 1 ELSE 0 END) AS reserved
       FROM property_units WHERE tenant_id = :tenantId`,
      { tenantId },
    );
    const [[{ n: propertiesCount }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM properties WHERE tenant_id = :tenantId',
      { tenantId },
    );
    const [[{ n: ownersCount }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM owners WHERE tenant_id = :tenantId',
      { tenantId },
    );
    const [[{ n: rentersCount }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM renters WHERE tenant_id = :tenantId',
      { tenantId },
    );
    const [[{ n: activeLeasesCount }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM leases WHERE tenant_id = :tenantId AND status = 'active'",
      { tenantId },
    );
    const [[{ n: openComplaintsCount }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM complaints WHERE tenant_id = :tenantId AND status IN ('ouverte', 'en_cours')",
      { tenantId },
    );
    const [recentComplaints] = await pool.query(
      `SELECT c.id, c.code, c.title, c.priority, c.status, c.reported_at,
              r.first_name, r.last_name
       FROM complaints c
       JOIN leases l ON l.id = c.lease_id
       JOIN renters r ON r.id = l.renter_id
       WHERE c.tenant_id = :tenantId AND c.status IN ('ouverte', 'en_cours')
       ORDER BY c.priority = 'urgente' DESC, c.reported_at ASC
       LIMIT 5`,
      { tenantId },
    );

    const totalUnits = Number(unitStats.total);
    const occupiedUnits = Number(unitStats.occupied);

    res.json({
      units: {
        total: totalUnits,
        occupied: occupiedUnits,
        free: Number(unitStats.free),
        reserved: Number(unitStats.reserved),
        occupancyRate: totalUnits > 0 ? occupiedUnits / totalUnits : 0,
      },
      propertiesCount: Number(propertiesCount),
      ownersCount: Number(ownersCount),
      rentersCount: Number(rentersCount),
      activeLeasesCount: Number(activeLeasesCount),
      complaints: {
        openCount: Number(openComplaintsCount),
        recent: recentComplaints.map((c) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          priority: c.priority,
          status: c.status,
          statusLabel: COMPLAINT_STATUS_LABELS[c.status] ?? c.status,
          reportedAt: c.reported_at instanceof Date ? c.reported_at.toISOString().slice(0, 10) : c.reported_at,
          renterName: `${c.first_name} ${c.last_name}`,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/activity?limit= — journal d'activité unifié (DG uniquement).
router.get('/activity', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const entries = await listRecentActivity(req.user.tenantId, limit);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
