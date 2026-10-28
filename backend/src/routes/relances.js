'use strict';

const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireAnyPermission } = require('../middleware/auth');
const { createRelanceSchema, outcomeSchema } = require('../validators/relances');
const { resolvePropertyScope } = require('../services/scope');
const relances = require('../services/relances');
const logger = require('../utils/logger');

const router = Router();
// Même union de permissions que le Centre de relance (`GET /accounting/arrears`,
// `/utility-arrears`) : accessible à qui gère les locataires, la comptabilité, OU les charges —
// jamais besoin des trois à la fois.
router.use(requireAuth, requireAnyPermission('locataires', 'comptabilite', 'charges'));

// POST /api/relances — enregistre l'envoi d'une relance (date du jour, auteur).
router.post('/', async (req, res, next) => {
  const parsed = createRelanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const relance = await relances.recordRelance(req.user.tenantId, req.user.id, scopeAgentId, parsed.data);
    logger.info('Relance enregistrée', {
      tenantId: req.user.tenantId, entityType: parsed.data.entityType, entityId: parsed.data.entityId, by: req.user.id,
    });
    res.status(201).json({ relance });
  } catch (err) {
    next(err);
  }
});

// GET /api/relances?entityType=&entityId= — historique des relances d'UN dossier (bail ou facture).
router.get('/', async (req, res, next) => {
  const entityType = req.query.entityType === 'charge' ? 'charge' : req.query.entityType === 'bail' ? 'bail' : null;
  const entityId = Number(req.query.entityId);
  if (!entityType || !Number.isInteger(entityId)) return next(new ApiError(400, 'Paramètres invalides'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const list = await relances.listRelances(req.user.tenantId, entityType, entityId, scopeAgentId);
    res.json({ relances: list });
  } catch (err) {
    next(err);
  }
});

// GET /api/relances/by-lease/:leaseId — fil complet (loyer + charges) pour la fiche locataire.
router.get('/by-lease/:leaseId', async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const list = await relances.listRelancesForLease(req.user.tenantId, leaseId, scopeAgentId);
    res.json({ relances: list });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/relances/:id — ajoute ou corrige le retour (réponse du locataire, suite donnée).
router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next(new ApiError(400, 'Identifiant invalide'));
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const relance = await relances.setOutcome(req.user.tenantId, req.user.id, scopeAgentId, id, parsed.data.note);
    res.json({ relance });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
