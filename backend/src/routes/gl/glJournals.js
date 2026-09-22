'use strict';

/** Journaux (caisse, banque, mobile money, opérations diverses, à-nouveaux) — lecture seule en V1, préchargés par le seed. */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { requireAuth, requirePermission } = require('../../middleware/auth');

const router = Router();
router.use(requireAuth);
const canAdvanced = requirePermission('comptabilite_avancee');

router.get('/', canAdvanced, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM gl_journals WHERE tenant_id = :tenantId ORDER BY code ASC',
      { tenantId: req.user.tenantId },
    );
    res.json({
      journals: rows.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        isSystem: !!r.is_system,
        isActive: !!r.is_active,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
