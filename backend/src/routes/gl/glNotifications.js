'use strict';

/**
 * Notifications DG (actions sensibles + résumés automatiques node-cron) —
 * `gl_notifications`, migration 041. Toujours adressées au DG (résolu à
 * l'écriture, voir `glNotificationService.notifyDg`) : seul le rôle `dg`
 * y accède, jamais via une permission (même `comptabilite_avancee` ne
 * suffit pas — un comptable n'est pas forcément destinataire de ce qui est
 * adressé au DG).
 */

const { Router } = require('express');
const { pool } = require('../../config/db');
const { ApiError } = require('../../middleware/error');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = Router();
router.use(requireAuth);
router.use(requireRole('dg'));

// GET /api/gl/notifications?unreadOnly=true
router.get('/', async (req, res, next) => {
  try {
    let where = 'tenant_id = :tenantId AND user_id = :userId';
    if (req.query.unreadOnly === 'true') where += ' AND read_at IS NULL';

    const [rows] = await pool.query(
      `SELECT * FROM gl_notifications WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
      { tenantId: req.user.tenantId, userId: req.user.id },
    );
    const [[{ n: unreadCount }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM gl_notifications WHERE tenant_id = :tenantId AND user_id = :userId AND read_at IS NULL',
      { tenantId: req.user.tenantId, userId: req.user.id },
    );

    res.json({
      unreadCount: Number(unreadCount),
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        entityTable: r.entity_table,
        entityId: r.entity_id,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gl/notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const [result] = await pool.query(
      'UPDATE gl_notifications SET read_at = NOW() WHERE id = :id AND tenant_id = :tenantId AND user_id = :userId AND read_at IS NULL',
      { id, tenantId: req.user.tenantId, userId: req.user.id },
    );
    if (result.affectedRows === 0) {
      const [existing] = await pool.query('SELECT id FROM gl_notifications WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
        id,
        tenantId: req.user.tenantId,
      });
      if (!existing[0]) throw new ApiError(404, 'Notification introuvable');
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gl/notifications/read-all
router.patch('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE gl_notifications SET read_at = NOW() WHERE tenant_id = :tenantId AND user_id = :userId AND read_at IS NULL',
      { tenantId: req.user.tenantId, userId: req.user.id },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
