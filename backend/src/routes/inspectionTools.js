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
const { blankFormSchema } = require('../validators/inspections');
const { cloneMasterZones, listInProgressInspections } = require('../services/inspection');
const { streamInspectionBlankFormPdf } = require('../services/pdf');
const { resolvePropertyScope } = require('../services/scope');

const router = Router();
router.use(requireAuth);

const canEtatsDesLieux = requirePermission('etats_des_lieux');

// GET /api/inspections/in-progress — boîte « État des lieux » (demande utilisateur, 2026-11-03 :
// « comme une boîte mail ») : tout état des lieux en cours, entrée comme sortie, pour tout le cabinet
// (un employé restreint ne voit que son périmètre « Biens gérés », comme ailleurs — voir
// `resolvePropertyScope`). Reste visible ici jusqu'à sa phase terminale : finalisation pour une
// entrée, archivage manuel pour une sortie (voir services/inspection.js).
router.get('/in-progress', canEtatsDesLieux, async (req, res, next) => {
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const items = await listInProgressInspections(req.user.tenantId, scopeAgentId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/inspections/master-zones — la grille standard (JSON, pas le PDF), pour que l'écran permette
// de la personnaliser (ajouter/retirer une pièce ou un élément) AVANT de générer le formulaire vierge
// (demande utilisateur, 2026-11-03 : « il doit pouvoir éditer le formulaire, ajouter d'autres choses
// s'il veut avant de le télécharger ») — même grille pour l'entrée et la sortie, le `kind` ne change que
// la mise en page du PDF (voir POST /blank-form.pdf ci-dessous), jamais la liste de départ.
router.get('/master-zones', canEtatsDesLieux, (req, res) => {
  res.json({ zones: cloneMasterZones() });
});

// POST /api/inspections/blank-form.pdf — fiche vierge à imprimer, à partir de la liste de zones/éléments
// que l'utilisateur a choisie à l'écran (démarrée depuis `GET /master-zones`, puis librement adaptée) —
// jamais figée côté serveur. Ne crée ni ne lit aucun brouillon : un simple outil, à ressaisir ensuite
// dans l'écran habituel une fois rempli à la main.
router.post('/blank-form.pdf', canEtatsDesLieux, async (req, res, next) => {
  const parsed = blankFormSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: req.user.tenantId });
    streamInspectionBlankFormPdf(res, { tenant, kind: parsed.data.kind, zones: parsed.data.zones });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
