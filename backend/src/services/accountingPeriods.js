'use strict';

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');

function toPeriod(dateStr) {
  // Accepte 'AAAA-MM-JJ' ou un objet Date déjà sérialisé par mysql2.
  const s = dateStr instanceof Date ? dateStr.toISOString() : String(dateStr);
  return s.slice(0, 7);
}

/** Vrai si le mois AAAA-MM de `dateStr` est déjà clôturé pour ce tenant. */
async function isPeriodClosed(tenantId, dateStr) {
  const [rows] = await pool.query(
    'SELECT 1 FROM accounting_periods WHERE tenant_id = :tenantId AND period = :period LIMIT 1',
    { tenantId, period: toPeriod(dateStr) },
  );
  return rows.length > 0;
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
  const d = rows[0]?.accounting_start_date;
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Lève une 403 explicite si le mois de `dateStr` est clôturé, ou si `dateStr`
 * est antérieure à la date de démarrage de la comptabilité du tenant.
 * À appeler avant toute création/modification/suppression d'une écriture
 * financière (paiement, versement, dépense, charge SONEB/SBEE) datée dans ce
 * mois. La lecture (consultation des périodes anciennes) n'est jamais
 * concernée par cette vérification.
 */
async function assertPeriodOpen(tenantId, dateStr) {
  if (await isPeriodClosed(tenantId, dateStr)) {
    throw new ApiError(
      403,
      `Le mois ${toPeriod(dateStr)} est clôturé : aucune écriture financière ne peut plus y être ajoutée, modifiée ou supprimée.`,
    );
  }
  const startDate = await getAccountingStartDate(tenantId);
  if (startDate && String(dateStr).slice(0, 10) < startDate) {
    throw new ApiError(
      403,
      `La comptabilité de cette entreprise démarre le ${startDate} : aucune écriture ne peut être datée avant cette date.`,
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
 */
async function getPeriodClosability(tenantId, period) {
  const first = firstDayOfPeriod(period);
  const last = lastDayOfPeriod(period);

  const [leases] = await pool.query(
    `SELECT l.id, l.rent_due_day, r.first_name, r.last_name, un.code AS unit_code
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

  const maxDueDay = Math.max(...leases.map((l) => l.rent_due_day));
  const closableFromDate = new Date(Date.UTC(y, m - 1, maxDueDay));
  closableFromDate.setUTCDate(closableFromDate.getUTCDate() + CLOSABLE_MARGIN_DAYS);
  const closableFrom = closableFromDate.toISOString().slice(0, 10);

  const pendingLeases = leases
    .filter((l) => today < new Date(Date.UTC(y, m - 1, l.rent_due_day)).toISOString().slice(0, 10))
    .map((l) => ({
      leaseId: l.id,
      renterName: `${l.first_name} ${l.last_name}`,
      unitCode: l.unit_code,
      dueDay: l.rent_due_day,
    }));

  return { maxDueDay, closableFrom, pendingLeases, isClosable: today >= closableFrom };
}

module.exports = {
  isPeriodClosed,
  assertPeriodOpen,
  toPeriod,
  getAccountingStartDate,
  getPeriodClosability,
};
