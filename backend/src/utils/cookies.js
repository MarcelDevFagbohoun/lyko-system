'use strict';

const config = require('../config/env');

const REFRESH_COOKIE_NAME = 'lyko_refresh';

/** Convertit une durée jsonwebtoken ("15m", "7d", "1h"...) en millisecondes. */
function msFromDuration(str, fallbackMs = 7 * 24 * 60 * 60 * 1000) {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(String(str).trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return n * unitMs;
}

/**
 * Le refresh token n'est envoyé qu'aux routes /api/auth/* (scope minimal),
 * en httpOnly + sameSite=lax (même « site » que le front en dev/prod usuels),
 * secure en production.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: msFromDuration(config.jwt.refreshTtl),
  };
}

module.exports = { REFRESH_COOKIE_NAME, refreshCookieOptions, msFromDuration };
