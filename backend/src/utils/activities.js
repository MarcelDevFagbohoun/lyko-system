'use strict';

const MAX_ACTIVITIES = 8;
const MAX_ACTIVITY_LENGTH = 40;

/** Nettoie une liste d'activités : texte sur une ligne, bornes de longueur/nombre, sans doublon (casse ignorée). */
function normalizeActivities(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ACTIVITY_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_ACTIVITIES) break;
  }
  return out;
}

/** Lit la colonne `tenants.activities` (JSON) — toujours un tableau, jamais d'exception sur une valeur corrompue. */
function parseActivities(raw) {
  if (!raw) return [];
  try {
    return normalizeActivities(JSON.parse(raw));
  } catch {
    return [];
  }
}

module.exports = { MAX_ACTIVITIES, MAX_ACTIVITY_LENGTH, normalizeActivities, parseActivities };
