'use strict';

/**
 * Logger minimal structuré (JSON en prod, lisible en dev).
 * Volontairement sans dépendance : suffisant pour l'étape 0,
 * remplaçable par pino/winston plus tard sans changer les appels.
 */
const { isProd } = require('../config/env');

function emit(level, msg, meta) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  if (isProd) {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const tag = { info: 'ℹ', warn: '⚠', error: '✖', debug: '·' }[level] || '•';
    const extra = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    process.stdout.write(`${tag} ${msg}${extra}\n`);
  }
}

module.exports = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  debug: (msg, meta) => {
    if (!isProd) emit('debug', msg, meta);
  },
};
