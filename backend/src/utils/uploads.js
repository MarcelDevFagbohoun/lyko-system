'use strict';

const crypto = require('crypto');
const { ApiError } = require('../middleware/error');

/**
 * Étape 12 (audit sécurité) — deux protections sur les fichiers téléversés :
 *
 * 1. Contrôle du CONTENU réel (octets magiques). multer ne connaît que le
 *    `Content-Type` déclaré par le client ; on vérifie ici la signature
 *    binaire et on ignore l'extension/MIME annoncés.
 * 2. Noms de fichiers NON ÉNUMÉRABLES sous `tenants/<id>/…` — un suffixe
 *    aléatoire par fichier empêche de deviner l'URL même avec un `<id>`
 *    séquentiel.
 *
 * Étape 49 (audit sécurité, suite) — troisième protection : la plupart des
 * fichiers exigent désormais une authentification pour être LUS, pas
 * seulement un nom non devinable. Seuls le logo d'entreprise et les photos
 * d'annonces marketplace restent servis en statique sous `/uploads/…` (ils
 * doivent rester visibles sans session, y compris sur le site public Quick
 * Immo) — voir `routes/files.js` et `app.js`. Tout le reste (photos de bien,
 * de plainte, d'état des lieux, justificatifs de dépense, cachets/
 * signatures, avatars) passe par `toProtectedFileUrl` ci-dessous.
 */

const PROTECTED_URL_PREFIX = '/api/files';

/** URL d'un fichier téléversé qui exige désormais une authentification (voir `routes/files.js`). */
function toProtectedFileUrl(relPath) {
  return `${PROTECTED_URL_PREFIX}/${relPath}`;
}

/** Reconstruit le chemin relatif (`tenants/<id>/…`) à partir d'une URL `/uploads/…` OU `/api/files/…`. */
function stripFileUrlPrefix(url) {
  return url.replace(/^\/(uploads|api\/files)\//, '');
}

/** @returns {'png'|'jpg'|'webp'|'pdf'|null} */
function detectFileType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

const IMAGE_TYPES = ['png', 'jpg', 'webp'];

/**
 * Valide un fichier multer (memoryStorage) d'après son contenu réel.
 * @param {{buffer: Buffer}|undefined} file
 * @param {{ pdf?: boolean, label?: string }} [opts] `pdf: true` autorise aussi les PDF.
 * @returns {string} l'extension réelle ('png' | 'jpg' | 'webp' | 'pdf')
 */
function assertUploadType(file, { pdf = false, label = 'Fichier' } = {}) {
  const type = file && detectFileType(file.buffer);
  const allowed = pdf ? [...IMAGE_TYPES, 'pdf'] : IMAGE_TYPES;
  if (!type || !allowed.includes(type)) {
    throw new ApiError(400, `${label} : contenu non reconnu (attendu ${allowed.join(', ').toUpperCase()})`);
  }
  return type;
}

/** `<base>-<20 hex aléatoires>.<ext>` — non devinable. */
function randomFileName(base, ext) {
  return `${base}-${crypto.randomBytes(10).toString('hex')}.${ext}`;
}

module.exports = { detectFileType, assertUploadType, randomFileName, toProtectedFileUrl, stripFileUrlPrefix };
