'use strict';

/**
 * Clôture des périodes comptables et paramètres associés (date de démarrage). Déplacé à l'identique depuis
 * `routes/accounting.js` : la route garde la validation, les codes HTTP et les logs. La clôture est
 * DÉFINITIVE (aucune réouverture) — voir les commentaires conservés ci-dessous.
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const {
  getPeriodClosability,
  getTenantRhythm,
  getOpenPeriodStart,
  computeProposedPeriodEnd,
  getPeriodClosabilityForRhythm,
  firstDayOfPeriod,
  lastDayOfPeriod,
} = require('./accountingPeriods');
const { isModuleActive, resolveOpenFiscalYear } = require('./gl/glPostingService');
const { isLastPeriodOfFiscalYear } = require('./gl/glClosingService');
const { snapshotLeaseBalances } = require('./rentTracking');
const { storeBilanSnapshot } = require('./monthBilan');
const { formatMonthLabel } = require('./pdf');
const logger = require('../utils/logger');

/** Mois déjà clôturés (traçabilité), lignes brutes. */
async function listClosedPeriods(tenantId) {
  const [rows] = await pool.query(
    `SELECT ap.period, ap.period_start, ap.period_end, ap.closed_at, ap.forced, u.first_name, u.last_name, u.role
     FROM accounting_periods ap JOIN users u ON u.id = ap.closed_by
     WHERE ap.tenant_id = :tenantId ORDER BY ap.period_start DESC`,
    { tenantId },
  );
  return rows;
}

/**
 * Clôture une période (DG uniquement, vérifié par la route). Renvoie
 * { period, periodStart, periodEnd, forced, fiscalYearClosable }.
 */
async function closePeriod(tenantId, userId, data) {
  const { force } = data;

  const conn = await pool.getConnection();
  try {
    const rhythm = await getTenantRhythm(tenantId);
    const todayIso = new Date().toISOString().slice(0, 10);

    // `legacyPeriod` ('AAAA-MM') n'existe que pour les entreprises au rythme calendaire. Ce chemin
    // est VOLONTAIREMENT inchangé par rapport à avant l'étape 1/5 : mêmes vérifications, même
    // message, même donnée insérée.
    let legacyPeriod = null;
    let periodStart;
    let periodEnd;
    let closability;

    if (rhythm.mode === 'calendaire') {
      if (!data.period) {
        throw new ApiError(400, 'Formulaire invalide', { period: ['Requis'] });
      }
      legacyPeriod = data.period;
      // Bug corrigé (audit fermeture du mois, point 9, 16/10/2026) : rien n'empêchait, même avec
      // `force`, de clôturer un mois FUTUR (qui n'a même pas encore commencé) — un DG pouvait ainsi
      // bloquer définitivement (aucune réouverture n'existe, par choix assumé) un prépaiement de
      // loyer légitime pour un mois à venir, par simple erreur de saisie. `force` sert à outrepasser
      // la marge de sécurité (toutes les échéances pas encore passées), jamais à clôturer un mois qui
      // n'existe pas encore dans le temps — ce garde-fou s'applique donc AVANT `force`, sans exception.
      if (legacyPeriod > todayIso.slice(0, 7)) {
        throw new ApiError(400, `Impossible de clôturer un mois futur (${legacyPeriod}) : il n'a pas encore commencé.`);
      }
      periodStart = firstDayOfPeriod(legacyPeriod);
      periodEnd = lastDayOfPeriod(legacyPeriod);
      closability = await getPeriodClosability(tenantId, legacyPeriod);
    } else {
      // Rythmes 'jour_fixe'/'libre' (étape 1/5, écran depuis l'étape 2b — voir `GET /open-period`).
      // `periodStart` est TOUJOURS déduit (jamais fourni par le client) pour garantir la
      // continuité : impossible de choisir où commence une période.
      periodStart = await getOpenPeriodStart(pool, tenantId);
      if (!periodStart) {
        throw new ApiError(400, "Définissez d'abord une date de démarrage de la comptabilité avant de clôturer une première période.");
      }
      if (periodStart > todayIso) {
        throw new ApiError(400, `Impossible de clôturer une période qui n'a pas encore commencé (${periodStart}).`);
      }
      if (rhythm.mode === 'libre') {
        if (!data.periodEnd) {
          throw new ApiError(400, 'Formulaire invalide', { periodEnd: ['Requis en rythme libre'] });
        }
        periodEnd = data.periodEnd;
      } else {
        periodEnd = data.periodEnd ?? computeProposedPeriodEnd(rhythm, periodStart);
      }
      if (periodEnd < periodStart) {
        throw new ApiError(400, 'La date de fin doit être postérieure à la date de début.');
      }
      if (periodEnd > todayIso) {
        throw new ApiError(400, `Impossible de clôturer une période qui n'est pas encore terminée (jusqu'au ${periodEnd}).`);
      }
      // Étape 2/5 : la marge de sécurité par échéance de loyer est désormais calculée aussi pour
      // les rythmes non-calendaire (`rent_due_offset_days` existe maintenant) — voir
      // `getPeriodClosabilityForRhythm`. En rythme 'libre' spécifiquement, aucune date future n'est
      // prévisible par construction (voir `rentTracking.js`), donc le DG reste seul juge ; la
      // fonction gère déjà ce cas (comportement identique à avant pour 'libre').
      closability =
        rhythm.mode === 'libre'
          ? { isClosable: true, closableFrom: periodStart, maxDueDay: null, pendingLeases: [] }
          : await getPeriodClosabilityForRhythm(tenantId, rhythm, periodStart, periodEnd);
    }

    if (!closability.isClosable && !force) {
      throw new ApiError(
        409,
        `Cette période n'est pas encore clôturable en toute sécurité (à partir du ${closability.closableFrom}).`,
        {
          closableFrom: closability.closableFrom,
          maxDueDay: closability.maxDueDay,
          pendingLeases: closability.pendingLeases,
        },
      );
    }
    const forced = !closability.isClosable && force;

    // Emboîtement avec l'exercice SYSCOHADA (décision utilisateur, étape 1/5) : si le module est
    // actif, cette période doit appartenir à UN SEUL exercice ouvert — jamais chevaucher deux
    // exercices (configuration incohérente, rejetée explicitement plutôt que de deviner), jamais un
    // exercice déjà clôturé.
    let fiscalYearId = null;
    if (await isModuleActive(pool, tenantId)) {
      const startFiscalYearId = await resolveOpenFiscalYear(pool, tenantId, periodStart);
      const endFiscalYearId = await resolveOpenFiscalYear(pool, tenantId, periodEnd);
      if (startFiscalYearId !== endFiscalYearId) {
        throw new ApiError(
          409,
          "Cette période chevauche deux exercices comptables — ajustez les dates de l'exercice avant de clôturer.",
        );
      }
      fiscalYearId = startFiscalYearId;
    }

    await conn.beginTransaction();
    // Refonte de la clôture (étape 1/5) : l'ancien verrou posait un `SELECT ... FOR UPDATE` sur la
    // clé UNIQUE exacte `accounting_periods (tenant_id, period)` — un « gap lock » qui n'a plus de
    // sens une fois la recherche basée sur un intervalle de dates (voir `accountingPeriods.js`,
    // commentaire détaillé sur `assertPeriodOpenLocked`). Le même nouveau point de verrouillage
    // (la ligne du tenant) sérialise ici aussi bien une écriture financière en cours qu'une seconde
    // clôture concurrente du même tenant.
    await conn.query('SELECT 1 FROM tenants WHERE id = :tenantId FOR UPDATE', { tenantId });

    // Continuité stricte (décision utilisateur, étape 1/5) : la nouvelle période doit commencer
    // exactement le lendemain de la fin de la précédente clôture — jamais de trou, jamais de
    // chevauchement. Revérifiée SOUS VERROU (la valeur lue plus haut, hors transaction, n'était pas
    // protégée contre une clôture concurrente qui aurait changé la réponse entre les deux lectures).
    const expectedStart = await getOpenPeriodStart(conn, tenantId);
    if (expectedStart && legacyPeriod) {
      // Calendaire : la continuité se juge au MOIS (étape 54). Une date de démarrage de la
      // comptabilité en milieu de mois (ex. le 5 août) faisait refuser la clôture d'août, qui
      // commence forcément le 1er ; et le message ne disait pas quel mois clôturer d'abord.
      const expectedMonth = expectedStart.slice(0, 7);
      if (legacyPeriod > expectedMonth) {
        throw new ApiError(
          409,
          `Clôturez d'abord ${formatMonthLabel(expectedMonth)} : les mois se clôturent dans l'ordre, sans en sauter.`,
        );
      }
      if (legacyPeriod < expectedMonth) {
        throw new ApiError(409, `${formatMonthLabel(legacyPeriod)} est déjà clôturé ou antérieur au démarrage de la comptabilité.`);
      }
    } else if (expectedStart && periodStart !== expectedStart) {
      throw new ApiError(409, `La période à clôturer doit commencer le ${expectedStart} (continuité avec la dernière clôture).`);
    }
    const [existing] = await conn.query(
      'SELECT id FROM accounting_periods WHERE tenant_id = :tenantId AND period_start = :periodStart LIMIT 1',
      { tenantId, periodStart },
    );
    if (existing[0]) throw new ApiError(409, 'Cette période est déjà clôturée.');

    await conn.query(
      `INSERT INTO accounting_periods (tenant_id, period, period_start, period_end, fiscal_year_id, closed_by, forced)
       VALUES (:tenantId, :legacyPeriod, :periodStart, :periodEnd, :fiscalYearId, :by, :forced)`,
      {
        tenantId,
        legacyPeriod,
        periodStart,
        periodEnd,
        fiscalYearId,
        by: userId,
        forced: forced ? 1 : 0,
      },
    );
    await conn.commit();

    // Étape 2/5 : les deux figements ci-dessous s'exécutent désormais pour TOUT rythme (plus
    // seulement calendaire) — ils reçoivent `rhythm` + les bornes réelles déjà calculées plus haut,
    // au lieu de dépendre d'un `period` 'AAAA-MM'. Après la clôture elle-même, chacun dans son propre
    // try/catch : la clôture n'est pas transactionnelle avec ceci (déjà en base à ce stade), un échec
    // ici ne doit jamais faire croire au DG que la clôture elle-même a échoué, seule la photo serait
    // manquante.
    try {
      await snapshotLeaseBalances(tenantId, rhythm, periodStart, periodEnd);
    } catch (snapshotErr) {
      logger.error('Échec de la photo de solde à la clôture (période tout de même clôturée)', {
        tenantId,
        periodStart,
        periodEnd,
        error: snapshotErr.message,
      });
    }

    // Photo figée du bilan détaillé du mois (calendaire) — même principe : jamais bloquante.
    if (legacyPeriod) {
      try {
        await storeBilanSnapshot(tenantId, legacyPeriod, userId);
      } catch (bilanErr) {
        logger.error('Échec de la photo du bilan à la clôture (période tout de même clôturée)', {
          tenantId,
          period: legacyPeriod,
          error: bilanErr.message,
        });
      }
    }

    // Exercice SYSCOHADA : si cette période est la dernière d'un exercice encore ouvert, le signale
    // (sans jamais le clôturer automatiquement — décision toujours humaine, étape 3 pour l'UX réelle).
    const fiscalYearClosable = fiscalYearId ? await isLastPeriodOfFiscalYear(pool, tenantId, fiscalYearId, periodEnd) : false;

    return { period: legacyPeriod, periodStart, periodEnd, forced, fiscalYearClosable };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Date de démarrage de la comptabilité (ligne brute avec l'auteur du réglage). */
async function getStartDateRow(tenantId) {
  const [[row]] = await pool.query(
    `SELECT t.accounting_start_date, t.accounting_start_date_set_at,
            u.first_name, u.last_name, u.role
     FROM tenants t
     LEFT JOIN users u ON u.id = t.accounting_start_date_set_by
     WHERE t.id = :tenantId LIMIT 1`,
    { tenantId },
  );
  return row;
}

/** Définit/modifie la date de démarrage (`null` retire la restriction). */
async function setStartDate(tenantId, userId, startDate) {
  await pool.query(
    `UPDATE tenants
     SET accounting_start_date = :startDate, accounting_start_date_set_by = :by, accounting_start_date_set_at = NOW()
     WHERE id = :tenantId`,
    { startDate, by: userId, tenantId },
  );
}

module.exports = { listClosedPeriods, closePeriod, getStartDateRow, setStartDate };
