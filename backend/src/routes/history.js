'use strict';

// Étape 18 (troisième et dernière idée choisie par l'utilisateur, après le
// tableau de bord « Mes tâches » et le rapport mensuel exportable) —
// Historique personnel : le « Journal d'activité » existant
// (`routes/dashboard.js`) est réservé au DG et montre TOUT le cabinet ;
// ici, le comptable ou l'agent voit uniquement SES propres actions passées
// (créations, paiements, suppressions...), en réutilisant `listRecentActivity`
// avec un filtre par auteur plutôt que de dupliquer son gros UNION de requêtes.

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { listRecentActivity } = require('../services/activity');

const router = Router();
router.use(requireAuth);

// GET /api/history?limit= — actions personnelles de l'utilisateur connecté.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const entries = await listRecentActivity(req.user.tenantId, limit, req.user.id);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
