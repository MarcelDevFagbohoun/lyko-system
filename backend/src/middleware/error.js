'use strict';

const logger = require('../utils/logger');
const config = require('../config/env');

/** Erreur applicative avec code HTTP explicite. */
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** 404 pour toute route non déclarée. */
function notFoundHandler(req, res, _next) {
  res.status(404).json({ error: 'Ressource introuvable', path: req.originalUrl });
}

// Bug corrigé (audit sécurité/logique) : sous forte concurrence sur un même
// verrou (ex. plusieurs paiements + une clôture de mois sur la même période),
// InnoDB peut détecter un cycle d'attente entre transactions et en annuler
// une lui-même (`ER_LOCK_DEADLOCK`) — ce n'est jamais une corruption de
// données (MySQL garantit qu'aucune des deux n'est appliquée à moitié), mais
// sans ce mappage l'utilisateur recevait une 500 brute avec le message MySQL
// en anglais. Un simple nouvel essai de la même action suffit presque
// toujours ; on retourne donc une 409 claire plutôt que de retenter
// automatiquement (la requête n'est pas idempotente à ce niveau générique).
const TRANSIENT_LOCK_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/** Gestionnaire d'erreurs terminal (doit garder les 4 arguments). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (TRANSIENT_LOCK_CODES.has(err.code)) {
    logger.warn('Conflit de verrou transitoire (nouvel essai attendu côté client)', { code: err.code, path: req.originalUrl });
    return res.status(409).json({ error: 'Conflit temporaire avec une autre opération en cours — merci de réessayer.' });
  }
  // multer (upload de fichiers) lève des MulterError sans .status : ce sont
  // toujours des erreurs de requête (taille/type de fichier), donc 400.
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) {
    logger.error('Erreur non gérée', { message: err.message, stack: err.stack, path: req.originalUrl });
  }
  res.status(status).json({
    error: status >= 500 && config.isProd ? 'Erreur interne du serveur' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
