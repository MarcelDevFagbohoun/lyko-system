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

/**
 * Date de filtre reçue d'un client (« AAAA-MM-JJ ») rendue sûre pour MySQL : un jour au-delà de la fin du mois
 * (« 2026-04-31 », envoyé par d'anciens écrans) est ramené au dernier jour du mois ; tout ce qui n'est pas une date
 * (texte libre, mois 13…) devient '' (= pas de filtre). MySQL 8 refuse les dates impossibles (erreur 500), MariaDB les
 * tolérait : sans ce filet, une plage « mois entier » plantait en production sur les mois de moins de 31 jours.
 */
function clampIsoDate(value) {
  if (typeof value !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return '';
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

module.exports = { isoDate, todayIso, clampIsoDate };
