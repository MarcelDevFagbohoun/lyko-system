'use strict';

/**
 * Cœur commun de l'enregistrement d'un paiement de loyer : chargement d'un bail dans sa portée, numérotation
 * des quittances et `recordRentPayment` (seul endroit qui insère dans `rent_payments`). Utilisé par les
 * routes des baux, le portail locataire, les liens de paiement et le webhook FedaPay. Déplacé à l'identique
 * depuis `routes/leases.js`.
 */

const { ApiError } = require('../middleware/error');
const { UNIT_DESIGNATIONS } = require('../constants/properties');
const { computeArrears, allocateRentPayment } = require('./rentTracking');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');

const DESIGNATION_LABELS = Object.fromEntries(UNIT_DESIGNATIONS.map((d) => [d.key, d.label]));

/**
 * Charge un bail appartenant à l'entreprise courante (+ unité/bien), ou lève
 * 404. `scopeAgentId` (étape 14) : un agent restreint à un sous-ensemble du
 * portefeuille n'accède qu'aux baux dont le Bien lui est attribué — 404,
 * jamais 403, pour ne jamais confirmer qu'un bail existe hors de sa portée.
 * Seul point d'entrée de ce routeur vers un bail : suffit à couvrir tous les
 * appels ci-dessous (paiements, quittances, états des lieux).
 */
async function loadLease(conn, tenantId, leaseId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT l.*, u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
            p.id AS property_id, p.address AS property_address, p.agent_id AS property_agent_id
     FROM leases l
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.id = :leaseId AND l.tenant_id = :tenantId LIMIT 1`,
    { leaseId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Bail introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Bail introuvable');
  }
  const row = rows[0];
  row.property_label =
    row.designation === 'autre' ? row.designation_custom : DESIGNATION_LABELS[row.designation];
  return row;
}

async function nextReceiptNumber(conn, tenantId) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM receipts WHERE tenant_id = :tenantId AND receipt_number LIKE :prefix`,
    { tenantId, prefix: `QT-${year}-%` },
  );
  const seq = Number(rows[0].n) + 1;
  return `QT-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Insère la quittance d'un paiement — `nextReceiptNumber` ci-dessus n'est qu'un `COUNT(*)`, jamais un
 * compteur verrouillé : deux paiements de BAUX DIFFÉRENTS enregistrés au même instant (deux employés, ou
 * deux requêtes concurrentes) peuvent calculer le même numéro avant que l'un des deux ne commite. Le
 * verrou posé sur le bail lui-même (plus haut dans `recordRentPayment`) ne sérialise que les paiements
 * d'un MÊME bail, pas ce cas. `uq_receipts_number (tenant_id, receipt_number)` est le filet de sécurité
 * final : un conflit ici signifie « un autre paiement vient de prendre ce numéro », jamais une vraie
 * erreur — on retente avec le numéro suivant (étape 51bis, Basse #1).
 */
async function insertReceiptForPayment(conn, tenantId, paymentId, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const receiptNumber = await nextReceiptNumber(conn, tenantId);
    try {
      const [result] = await conn.query(
        `INSERT INTO receipts (tenant_id, payment_id, receipt_number) VALUES (:tenantId, :paymentId, :number)`,
        { tenantId, paymentId, number: receiptNumber },
      );
      return { receiptId: result.insertId, receiptNumber };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < maxAttempts) continue;
      throw err;
    }
  }
  throw new Error('Impossible de générer un numéro de quittance unique après plusieurs tentatives.');
}

/**
 * Cœur commun de l'enregistrement d'un paiement de loyer : verrouille le
 * bail, calcule l'allocation multi-mois, insère les lignes `rent_payments` +
 * `receipts`. Seul endroit qui insère dans `rent_payments` — utilisé par la
 * route manuelle (staff) ci-dessous ET par les chemins FedaPay (portail,
 * lien de paiement, webhook), jamais dupliqué.
 *
 * `recordedBy` : `null` pour un paiement confirmé par FedaPay (aucun employé
 * ne l'a saisi). `onlineTransactionId`, s'il est fourni, n'est attaché qu'à
 * la PREMIÈRE ligne créée (la colonne est UNIQUE — un paiement qui se
 * répartit sur plusieurs mois ne doit pas tenter d'insérer la même
 * référence FedaPay deux fois) ; il suffit à identifier la transaction pour
 * l'idempotence, vérifiée en amont par l'appelant avant même d'arriver ici.
 * Appelant responsable du verrou de transaction (`conn.beginTransaction()`)
 * et du `SELECT ... FOR UPDATE` sur le bail avant d'appeler cette fonction.
 */
async function recordRentPayment(
  conn,
  { tenantId, lease, coversMonth, amount, paymentMethod, paidAt, notes, recordedBy, onlineTransactionId = null },
) {
  // Nom du locataire pour le libellé de l'écriture comptable uniquement —
  // `lease` (chargé par `loadLease`) ne porte pas cette jointure.
  const [renterRows] = await conn.query('SELECT first_name, last_name FROM renters WHERE id = :id LIMIT 1', {
    id: lease.renter_id,
  });
  const renterName = renterRows[0] ? `${renterRows[0].first_name} ${renterRows[0].last_name}` : 'Locataire';

  // Refonte de la clôture (étape 2/5, 2026-10-16) : le rythme d'UN bail se déduit directement de ses
  // propres colonnes (`rent_due_day` renseigné = calendaire, `rent_due_offset_days` renseigné =
  // non-calendaire — les deux sont mutuellement exclusifs, contrainte CHECK en base) : jamais besoin
  // de requêter le rythme du TENANT dans ce chemin critique, un bail garde le sien pour toute sa
  // durée. `jour_fixe` et `libre` se comportent de façon identique dans `rentTracking.js` (même pas
  // d'avancement, ancré sur le jour de la clé courante) — seul "calendaire vs le reste" compte ici.
  const isCalendaire = lease.rent_due_day != null;
  const rhythm = { mode: isCalendaire ? 'calendaire' : 'jour_fixe' };

  const [payRows] = await conn.query(
    'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
    { leaseId: lease.id },
  );
  const startDate =
    lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
  const arrears = computeArrears({
    startDate,
    createdAt: lease.created_at,
    upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
    rentDueDay: lease.rent_due_day,
    rentDueOffsetDays: lease.rent_due_offset_days,
    rentTiming: lease.rent_timing,
    monthlyRent: lease.monthly_rent,
    entryProration: lease.entry_proration,
    payments: payRows.map((r) => ({
      coversMonth: isCalendaire
        ? r.covers_month
        : r.covers_period_start instanceof Date
          ? r.covers_period_start.toISOString().slice(0, 10)
          : String(r.covers_period_start).slice(0, 10),
      amount: Number(r.amount),
    })),
    rhythm,
  });
  const startMonth = coversMonth && coversMonth >= arrears.nextDueMonth ? coversMonth : arrears.nextDueMonth;
  // Le reliquat déjà réglé ne s'applique que si `startMonth` EST le mois en
  // retard identifié (`arrears.nextDueMonth`) — un `coversMonth` explicite
  // plus tardif (paiement d'avance en avance) démarre sur un mois neuf.
  const alreadyPaidForStartMonth = startMonth === arrears.nextDueMonth ? arrears.paidForNextDueMonth : 0;

  const { fullMonths, partialAmount, monthsCovered, allocations } = allocateRentPayment({
    nextDueMonth: startMonth,
    monthlyRent: lease.monthly_rent,
    alreadyPaidForNextDueMonth: alreadyPaidForStartMonth,
    amount,
    rhythm,
  });

  const created = [];
  for (const [i, alloc] of allocations.entries()) {
    // `covers_month` ('AAAA-MM') reste renseignée uniquement pour un bail calendaire — voir migration
    // 085 — `covers_period_start` (date réelle) est TOUJOURS renseignée, quel que soit le rythme.
    const coversPeriodStart = isCalendaire ? `${alloc.coversMonth}-01` : alloc.coversMonth;
    const [paymentResult] = await conn.query(
      `INSERT INTO rent_payments (tenant_id, lease_id, covers_month, covers_period_start, amount, payment_method, paid_at, notes, recorded_by, online_transaction_id)
       VALUES (:tenantId, :leaseId, :coversMonth, :coversPeriodStart, :amount, :method, :paidAt, :notes, :recordedBy, :onlineTransactionId)`,
      {
        tenantId,
        leaseId: lease.id,
        coversMonth: isCalendaire ? alloc.coversMonth : null,
        coversPeriodStart,
        amount: alloc.amount,
        method: paymentMethod,
        paidAt,
        notes: notes ?? null,
        recordedBy: recordedBy ?? null,
        onlineTransactionId: i === 0 ? onlineTransactionId : null,
      },
    );
    const paymentId = paymentResult.insertId;
    const { receiptId, receiptNumber } = await insertReceiptForPayment(conn, tenantId, paymentId);

    // Module comptabilité SYSCOHADA (nouveau) — génère la contrepartie en
    // partie double dans LA MÊME transaction, SEULEMENT si l'entreprise a
    // activé le module (`isModuleActive`) : une entreprise qui ne l'a jamais
    // configuré continue de fonctionner exactement comme avant, jamais
    // bloquée par une comptabilité qu'elle n'a pas mise en place. Une fois
    // activé, une écriture qui échoue (exercice clôturé...) fait échouer le
    // paiement aussi, jamais l'inverse.
    if (await isModuleActive(conn, tenantId)) {
      await genererEcriture(conn, {
        tenantId,
        operationType: 'loyer_encaisse',
        entryDate: paidAt,
        amount: alloc.amount,
        paymentMethod,
        narrationVars: { mois: alloc.coversMonth, locataire: renterName },
        sourceTable: 'rent_payments',
        sourceId: paymentId,
        createdBy: recordedBy,
        context: { leaseId: lease.id },
      });
    }

    created.push({
      paymentId,
      coversMonth: alloc.coversMonth,
      amount: alloc.amount,
      isPartial: alloc.isPartial,
      receipt: { id: receiptId, number: receiptNumber },
    });
  }

  return { startMonth, fullMonths, partialAmount, monthsCovered, payments: created };
}

module.exports = { loadLease, insertReceiptForPayment, recordRentPayment };
