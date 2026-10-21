'use strict';

const { Router } = require('express');
const { pingDatabase } = require('../config/db');
const pkg = require('../../package.json');
const config = require('../config/env');
const logger = require('../utils/logger');

const router = Router();

// Santé du process (toujours 200 si le serveur répond).
router.get('/', (_req, res) => {
  res.json({
    service: 'api',
    ...(config.isProd ? {} : { version: pkg.version }),
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Santé de la base de données (critère de validation de l'étape 0).
router.get('/db', async (_req, res, next) => {
  try {
    const diag = await pingDatabase();
    // En production : aucun détail technique (version, nom de base) exposé publiquement.
    res.json(config.isProd ? { status: 'ok' } : { status: 'ok', ...diag });
  } catch (err) {
    logger.error('Santé base de données : indisponible', { message: err.message, code: err.code });
    if (config.isProd) return res.status(503).json({ status: 'unavailable' });
    res.status(503).json({
      status: 'unavailable',
      error: err.message,
      code: err.code || null,
    });
    void next;
  }
});

module.exports = router;
