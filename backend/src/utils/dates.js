'use strict';

/**
 * Dates « jour » (AAAA-MM-JJ) : source unique, utilisée par les routes et services.
 * Les colonnes DATE de MySQL reviennent en objets Date (UTC) : on les ramène en texte sans décalage de fuseau.
 */

/** Date, texte ou null → « AAAA-MM-JJ » (ou null si vide). */
function isoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Aujourd'hui (UTC) au format « AAAA-MM-JJ ». */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { isoDate, todayIso };
