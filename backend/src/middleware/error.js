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

/** Gestionnaire d'erreurs terminal (doit garder les 4 arguments). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
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
