'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');

function toPeriod(dateStr) {
  // Accepte 'AAAA-MM-JJ' ou un objet Date déjà sérialisé par mysql2.
  const s = dateStr instanceof Date ? dateStr.toISOString() : String(dateStr);
  return s.slice(0, 7);
}

function toIsoDate(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Refonte de la clôture (étape 1/5, 2026-10-16) : une période clôturée est identifiée par son
 * intervalle de dates réel (`period_start`/`period_end`), jamais seulement par un libellé 'AAAA-MM'
 * — nécessaire dès qu'une entreprise choisit un rythme autre que calendaire (ex. le 5 au 4 du mois
 * suivant, qui chevauche deux mois civils et n'a pas d'étiquette correcte). Renvoie la ligne clôturée
 * qui couvre `dateStr`, ou `null` si cette date tombe dans la période actuellement OUVERTE.
 */
async function findClosedPeriodCovering(executor, tenantId, dateStr) {
  const d = toIsoDate(dateStr);
  const [rows] = await executor.query(
    'SELECT period_start, period_end FROM accounting_periods WHERE tenant_id = :tenantId AND period_start <= :d AND period_end >= :d LIMIT 1',
    { tenantId, d },
  );
  return rows[0] ?? null;
}

/** Vrai si `dateStr` tombe dans une période déjà clôturée pour ce tenant. */
async function isPeriodClosed(tenantId, dateStr) {
  return (await findClosedPeriodCovering(pool, tenantId, dateStr)) !== null;
}

/**
 * Date de démarrage de la comptabilité pour ce tenant (AAAA-MM-JJ), ou null
 * si aucune n'a été définie (pas de borne basse). Définie et modifiable
 * uniquement par le DG, à tout moment — contrairement à la clôture, ce n'est
 * pas un acte définitif, juste un paramètre d'entreprise.
 */
async function getAccountingStartDate(tenantId) {
  const [rows] = await pool.query('SELECT accounting_start_date FROM tenants WHERE id = :tenantId LIMIT 1', {
    tenantId,
  });
  return toIsoDate(rows[0]?.accounting_start_date);
}

/**
 * Rythme de période de ce tenant (étape 1/5) : 'calendaire' (par défaut, pour TOUTE entreprise
 * tant qu'elle n'a pas explicitement changé ce réglage — aucune interface ne l'expose encore, voir
 * le plan), 'jour_fixe' (jour de départ 1-28 choisi par le DG) ou 'libre' (date de fin saisie à
 * chaque clôture).
 */
async function getTenantRhythm(tenantId) {
  const [rows] = await pool.query(
    'SELECT period_rhythm_mode, period_start_day FROM tenants WHERE id = :tenantId LIMIT 1',
    { tenantId },
  );
  return { mode: rows[0]?.period_rhythm_mode ?? 'calendaire', startDay: rows[0]?.period_start_day ?? null };
}

/**
 * Début de la période actuellement OUVERTE pour ce tenant — toujours CALCULÉ, jamais une ligne en
 * base (même principe que `getAccountingStartDate` : un paramètre déduit, pas stocké). C'est le
 * lendemain de la fin de la dernière période clôturée, ou la date de démarrage de la comptabilité
 * si aucune période n'a encore été clôturée. Renvoie `null` si ni l'une ni l'autre n'existe — dans
 * ce cas, la période ouverte n'a pas de début connu (comportement identique à avant cette étape :
 * aucune restriction tant que rien n'a jamais été figé).
 */
async function getOpenPeriodStart(executor, tenantId) {
  const [rows] = await executor.query(
    'SELECT MAX(period_end) AS lastEnd FROM accounting_periods WHERE tenant_id = :tenantId',
    { tenantId },
  );
  const lastEnd = rows[0]?.lastEnd;
  if (lastEnd) {
    const d = new Date(`${toIsoDate(lastEnd)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return getAccountingStartDate(tenantId);
}

/**
 * Propose automatiquement la date de fin d'une période 'calendaire' ou 'jour_fixe' (jamais pour
 * 'libre', qui n'a par définition aucune longueur fixe — le DG la saisit toujours lui-même).
 * 'jour_fixe' avance exactement d'un mois civil, ancré sur `rhythm.startDay` au lieu du 1er — même
 * calcul que `addMonth`/`shiftMonth` (rentTracking.js), juste décalé.
 */
function computeProposedPeriodEnd(rhythm, periodStartIso) {
  const [y, m, day] = periodStartIso.split('-').map(Number);
  // Un jour avant le même jour-ancre du mois suivant (ou le 1er si calendaire).
  const end = new Date(Date.UTC(y, m - 1 + 1, rhythm.mode === 'jour_fixe' ? day : 1));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/**
 * Lève une 403 explicite si `dateStr` tombe dans une période déjà clôturée, ou si `dateStr` est
 * antérieure à la date de démarrage de la comptabilité du tenant. À appeler avant toute
 * création/modification/suppression d'une écriture financière (paiement, versement, dépense,
 * charge SONEB/SBEE) datée dans cette période. La lecture (consultation des périodes anciennes)
 * n'est jamais concernée par cette vérification.
 */
async function assertPeriodOpen(tenantId, dateStr) {
  const closed = await findClosedPeriodCovering(pool, tenantId, dateStr);
  if (closed) {
    throw new ApiError(
      403,
      `La période du ${toIsoDate(closed.period_start)} au ${toIsoDate(closed.period_end)} est clôturée : aucune écriture financière ne peut plus y être ajoutée, modifiée ou supprimée.`,
    );
  }
  const startDate = await getAccountingStartDate(tenantId);
  if (startDate && toIsoDate(dateStr) < startDate) {
    throw new ApiError(
      403,
      `La comptabilité de cette entreprise démarre le ${startDate} : aucune écriture ne peut être datée avant cette date.`,
    );
  }
}

/**
 * Bug corrigé (audit sécurité/logique) : `assertPeriodOpen` ci-dessus est un simple `SELECT`,
 * exécuté AVANT `conn.beginTransaction()` dans tous ses appelants — rien n'empêchait une clôture de
 * période de se glisser entre cette vérification et l'écriture réelle (course). `assertPeriodOpenLocked
 * (conn, ...)` referme cette fenêtre : à appeler UNE SECONDE FOIS, juste après
 * `conn.beginTransaction()`, sur la connexion de la transaction en cours.
 *
 * Refonte de la clôture (étape 1/5) : l'ancien verrou posait un `SELECT ... FOR UPDATE` sur la clé
 * UNIQUE exacte `accounting_periods (tenant_id, period)` — un « gap lock » qui fonctionnait même
 * quand le mois n'était pas encore clôturé (rien à verrouiller, mais la clé existait conceptuellement).
 * Cette clé exacte n'existe plus : la recherche se fait désormais par intervalle de dates
 * (`period_start <= ? AND period_end >= ?`), qui n'a rien d'unique à gap-locker. Le point de
 * verrouillage devient donc la ligne du TENANT lui-même (`SELECT ... FROM tenants ... FOR UPDATE`) —
 * elle existe toujours, se verrouille donc toujours correctement, et sérialise à la fois toute
 * écriture financière en cours ET toute tentative de clôture concurrente pour ce même tenant
 * (`POST /api/accounting/periods` acquiert le même verrou avant son propre `INSERT`).
 */
async function assertPeriodOpenLocked(conn, tenantId, dateStr) {
  await conn.query('SELECT 1 FROM tenants WHERE id = :tenantId FOR UPDATE', { tenantId });
  const closed = await findClosedPeriodCovering(conn, tenantId, dateStr);
  if (closed) {
    throw new ApiError(
      403,
      `La période du ${toIsoDate(closed.period_start)} au ${toIsoDate(closed.period_end)} est clôturée : aucune écriture financière ne peut plus y être ajoutée, modifiée ou supprimée.`,
    );
  }
}

// Marge de sécurité après l'échéance la plus tardive des baux actifs du mois,
// pour laisser le temps aux derniers paiements d'arriver avant de proposer la
// clôture comme sûre. Valeur fixe pour l'instant (pas de réglage exposé —
// ajustable ici si un besoin de configuration apparaît).
const CLOSABLE_MARGIN_DAYS = 5;

function firstDayOfPeriod(period) {
  return `${period}-01`;
}

function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Calcule si le mois `period` (AAAA-MM) d'un tenant est déjà « clôturable »
 * sans risque : l'échéance de loyer la plus tardive parmi les baux actifs
 * pendant ce mois (`rent_due_day`, propre à chaque locataire — ne sert qu'à
 * son propre calcul de retard, jamais à la période elle-même), plus une
 * marge de sécurité. Sans bail chevauchant ce mois, rien ne bloque : le mois
 * est clôturable dès son premier jour.
 *
 * Renvoie aussi les baux dont l'échéance de ce mois précis n'est pas encore
 * passée (`pendingLeases`) — utilisé pour l'avertissement affiché au DG s'il
 * choisit de clôturer avant que le mois ne soit marqué clôturable.
 *
 * Refonte de la clôture (étape 1/5) : volontairement INCHANGÉE, calendaire uniquement — le calcul
 * repose sur `rent_due_day` (jour du mois CIVIL), qui n'a pas de sens pour un rythme 'jour_fixe'/
 * 'libre' (une période de ce type peut chevaucher deux mois civils). Sa généralisation est reportée
 * à l'étape 2, qui introduit `rent_due_offset_days`. Pour l'instant, la route de clôture ne
 * l'appelle que pour les tenants restés en rythme 'calendaire' (voir `routes/accounting.js`).
 */
async function getPeriodClosability(tenantId, period) {
  const first = firstDayOfPeriod(period);
  const last = lastDayOfPeriod(period);

  // Bug corrigé (audit fermeture du mois, point 7, 16/10/2026) : `rent_timing` est désormais lu — un
  // bail en 'terme_echu' n'a son loyer de CE mois dû que le mois SUIVANT (voir `rentTracking.js`,
  // `computeArrears` : même décalage). Sans ça, le signal « clôturable sans risque » pouvait
  // s'allumer avant même que le loyer à terme échu de ce mois ne soit exigible — trop tôt, pas trop
  // tard, c'est-à-dire exactement le sens dangereux pour un garde-fou censé protéger contre une
  // clôture prématurée.
  const [leases] = await pool.query(
    `SELECT l.id, l.rent_due_day, l.rent_timing, l.start_date, r.first_name, r.last_name, un.code AS unit_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     WHERE l.tenant_id = :tenantId AND l.start_date <= :last AND (l.end_date IS NULL OR l.end_date >= :first)`,
    { tenantId, first, last },
  );

  const today = new Date().toISOString().slice(0, 10);
  const [y, m] = period.split('-').map(Number);

  if (leases.length === 0) {
    return { maxDueDay: null, closableFrom: first, pendingLeases: [], isClosable: today >= first };
  }

  // Échéance RÉELLE de chaque bail pour ce mois précis — jamais juste `rent_due_day` appliqué
  // aveuglément au mois de la période : décalée d'un mois pour 'terme_echu'. `Date.UTC` normalise
  // lui-même un jour hors plage (ex. 31 dans un mois de 28/30 jours) vers le premier jour du mois
  // suivant — comportement correct (il n'existe pas de 31 février), reflété fidèlement dans la date
  // renvoyée plutôt que de prétendre qu'un jour inexistant s'est produit dans le mois affiché.
  const dueDateOf = (lease) => new Date(Date.UTC(y, m - 1 + (lease.rent_timing === 'terme_echu' ? 1 : 0), lease.rent_due_day));

  const maxDueDate = leases.reduce((latest, l) => {
    const d = dueDateOf(l);
    return d > latest ? d : latest;
  }, dueDateOf(leases[0]));
  const closableFromDate = new Date(maxDueDate);
  closableFromDate.setUTCDate(closableFromDate.getUTCDate() + CLOSABLE_MARGIN_DAYS);
  const closableFrom = closableFromDate.toISOString().slice(0, 10);

  const pendingLeases = leases
    .filter((l) => today < dueDateOf(l).toISOString().slice(0, 10))
    .map((l) => ({
      leaseId: l.id,
      renterName: `${l.first_name} ${l.last_name}`,
      unitCode: l.unit_code,
      dueDay: l.rent_due_day,
    }));

  return {
    // Rendu tel quel pour compatibilité (affichage existant du jour du mois) — la date RÉELLEMENT
    // utilisée pour le calcul est `maxDueDate`/`closableFrom`, qui tient compte du décalage éventuel.
    maxDueDay: maxDueDate.getUTCDate(),
    closableFrom,
    pendingLeases,
    isClosable: today >= closableFrom,
  };
}

/**
 * Généralisation de `getPeriodClosability` à un rythme quelconque (étape 2/5, 2026-10-16) — utilisée
 * UNIQUEMENT par la route de clôture, pour les tenants non-calendaire (`jour_fixe`/`libre`). Les
 * autres usages existants de `getPeriodClosability` ci-dessus (tableau de bord, rappel de clôture,
 * tâches du DG) restent délibérément calendaire-only — voir le plan, étape 2, "hors scope explicite"
 * (pas encore de sélecteur de période non-calendaire pour ces écrans). Pour un tenant calendaire,
 * retombe directement sur `getPeriodClosability` (comportement inchangé).
 *
 * Import différé de `rentTracking.js` (dans le corps de la fonction, pas en tête de fichier) : évite
 * toute dépendance circulaire au chargement, ce fichier restant un service de bas niveau.
 */
async function getPeriodClosabilityForRhythm(tenantId, rhythm, periodStart, periodEnd) {
  if (rhythm.mode === 'calendaire') {
    return getPeriodClosability(tenantId, periodStart.slice(0, 7));
  }

  const { resolveRentDueDate } = require('./rentTracking');
  const [leases] = await pool.query(
    `SELECT l.id, l.rent_due_day, l.rent_due_offset_days, l.rent_timing, r.first_name, r.last_name, un.code AS unit_code
     FROM leases l
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     WHERE l.tenant_id = :tenantId AND l.start_date <= :last AND (l.end_date IS NULL OR l.end_date >= :first)`,
    { tenantId, first: periodStart, last: periodEnd },
  );

  const today = new Date().toISOString().slice(0, 10);
  if (leases.length === 0) {
    return { maxDueDay: null, closableFrom: periodStart, pendingLeases: [], isClosable: today >= periodStart };
  }

  const dueDateOf = (lease) =>
    resolveRentDueDate({
      rhythm,
      periodKey: periodStart,
      rentDueDay: lease.rent_due_day,
      rentDueOffsetDays: lease.rent_due_offset_days,
      rentTiming: lease.rent_timing,
    });

  const maxDueDate = leases.reduce((latest, l) => {
    const d = dueDateOf(l);
    return d > latest ? d : latest;
  }, dueDateOf(leases[0]));
  const closableFromDate = new Date(`${maxDueDate}T00:00:00Z`);
  closableFromDate.setUTCDate(closableFromDate.getUTCDate() + CLOSABLE_MARGIN_DAYS);
  const closableFrom = closableFromDate.toISOString().slice(0, 10);

  const pendingLeases = leases
    .filter((l) => today < dueDateOf(l))
    .map((l) => ({
      leaseId: l.id,
      renterName: `${l.first_name} ${l.last_name}`,
      unitCode: l.unit_code,
      dueDay: l.rent_due_day ?? l.rent_due_offset_days,
    }));

  // Pas de "jour du mois" univoque hors calendaire (une période peut chevaucher deux mois civils) —
  // `closableFrom` reste le signal exploitable par la route, `maxDueDay` n'a de sens qu'en calendaire.
  return { maxDueDay: null, closableFrom, pendingLeases, isClosable: today >= closableFrom };
}

module.exports = {
  isPeriodClosed,
  assertPeriodOpen,
  assertPeriodOpenLocked,
  toPeriod,
  getAccountingStartDate,
  getPeriodClosability,
  getPeriodClosabilityForRhythm,
  getTenantRhythm,
  getOpenPeriodStart,
  computeProposedPeriodEnd,
  firstDayOfPeriod,
  lastDayOfPeriod,
};
