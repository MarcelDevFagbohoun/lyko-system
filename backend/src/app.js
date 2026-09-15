'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const config = require('./config/env');
const { corsMiddleware, globalRateLimiter, helmetMiddleware } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const apiRoutes = require('./routes');
const logger = require('./utils/logger');

function createApp() {
  const app = express();

  // Derrière un reverse-proxy (nginx) en production : nécessaire pour le rate-limit et les IP réelles.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(globalRateLimiter);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Le token des portails locataire/propriétaire (lien secret, sans mot de
  // passe) apparaît dans l'URL : jamais en clair dans les journaux d'accès,
  // où que ce soit (même principe que ne jamais logguer un mot de passe).
  // Redéfinit le token `:url` utilisé par les deux formats morgan ci-dessous.
  const PORTAL_URL_PREFIXES = ['/api/portal/', '/api/owner-portal/'];
  morgan.token('url', (req) => {
    const url = req.originalUrl || req.url;
    const prefix = PORTAL_URL_PREFIXES.find((p) => url.startsWith(p));
    return prefix ? url.replace(new RegExp(`^(${prefix})[^/]+`), '$1[redacted]') : url;
  });

  // Journal d'accès : lisible en dev, une ligne HTTP par requête routée vers
  // le logger structuré en prod (capté sur stdout par Docker/agrégateur —
  // nécessaire à l'audit et au forensic, étape 12).
  app.use(
    config.isProd
      ? morgan('combined', { stream: { write: (line) => logger.info('http', { line: line.trim() }) } })
      : morgan('dev'),
  );

  app.get('/', (_req, res) => {
    res.json({ name: 'Lyko System API', docs: '/api/health' });
  });

  // Logos, cachets et signatures d'entreprise. Chargés en <img> par le front,
  // potentiellement sur un autre sous-domaine (app. / api.) en prod : CORP
  // `cross-origin` pour que l'affichage ne dépende pas du découpage de domaine.
  app.use(
    '/uploads',
    express.static(path.join(__dirname, '../uploads'), {
      maxAge: '1d',
      setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
    }),
  );

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
