'use strict';

/**
 * Outils d'état des lieux génériques, jamais liés à un bail en particulier (contrairement aux routes
 * `/leases/:leaseId/move-in-report`/`move-out-report`) — pour l'instant : la fiche VIERGE imprimable
 * (demande utilisateur, 2026-11-03 : « reconstituer tous les éléments de notre état des lieux... pour
 * des états des lieux manuels sur le terrain dans le cas où la personne ne veut pas le faire directement
 * sur la plateforme »). Même permission que la saisie en ligne : qui fait des états des lieux doit
 * pouvoir imprimer la fiche à emporter sur le terrain.
 */

const { Router } = require('express');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { cloneMasterZones } = require('../services/inspection');
const { streamInspectionBlankFormPdf } = require('../services/pdf');

const router = Router();
router.use(requireAuth);

const canEtatsDesLieux = requirePermission('etats_des_lieux');

// GET /api/inspections/blank-form.pdf?kind=entree|sortie — fiche vierge à imprimer, reconstituant tous
// les éléments de la grille standard (identique à ce que proposerait l'écran en ligne pour un bail sans
// état des lieux d'entrée). Ne crée ni ne lit aucun brouillon : un simple outil, téléchargeable à tout
// moment, à ressaisir ensuite dans l'écran habituel une fois rempli à la main.
router.get('/blank-form.pdf', canEtatsDesLieux, async (req, res, next) => {
  const kind = req.query.kind === 'sortie' ? 'sortie' : req.query.kind === 'entree' ? 'entree' : null;
  if (!kind) return next(new ApiError(400, "Paramètre 'kind' invalide (attendu : entree ou sortie)"));

  try {
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    const zones = cloneMasterZones();
    streamInspectionBlankFormPdf(res, { tenant, kind, zones });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
