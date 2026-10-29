'use strict';

/**
 * Logger minimal structuré (JSON en prod, lisible en dev).
 * Volontairement sans dépendance : suffisant pour l'étape 0,
 * remplaçable par pino/winston plus tard sans changer les appels.
 */
const { isProd } = require('../config/env');

// Sous `node --test`, le stdout du processus de test est le canal binaire du lanceur : une ligne de log qui s'y glisse en plein
// message provoque « Unable to deserialize cloned data » (échec intermittent d'un fichier entier). Les logs de test vont donc sur stderr.
const out = process.env.NODE_ENV === 'test' ? process.stderr : process.stdout;

function emit(level, msg, meta) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  if (isProd) {
    out.write(JSON.stringify(entry) + '\n');
  } else {
    const tag = { info: 'ℹ', warn: '⚠', error: '✖', debug: '·' }[level] || '•';
    const extra = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    out.write(`${tag} ${msg}${extra}\n`);
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
