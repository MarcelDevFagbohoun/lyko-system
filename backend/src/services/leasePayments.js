'use strict';

/**
 * Opérations sur les baux et leurs paiements de loyer : fin de bail, registre, annulation et
 * enregistrement d'un paiement. Déplacé à l'identique depuis `routes/leases.js` : la route garde la
 * validation, les codes HTTP, les logs et la portée agent (`resolvePropertyScope`).
 */

const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { computeArrears, allocateRentPayment } = require('./rentTracking');
const { claimIdempotencyKey, hasRecentIdenticalRentPayment, DUPLICATE_MESSAGE } = require('./paymentGuards');
const { assertPeriodOpen, assertPeriodOpenLocked } = require('./accountingPeriods');
const { extourneEcriture } = require('./gl/glReversalService');
const { getEscrowBalances } = require('./commission');
const { resolveOwnerFromLease } = require('./gl/glAccountResolver');
const { notifyRentPaymentsRecorded } = require('./payments/notify');
const { loadLease, recordRentPayment } = require('./rentPayments');

/** Termine un bail (libère l'unité) — refusé tant qu'une caution est à régulariser. */
async function endLease(tenantId, leaseId, scopeAgentId, endDate) {
  const conn = await pool.getConnection();
  try {
    const lease = await loadLease(conn, tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est déjà terminé');

    if (Number(lease.deposit_amount) > 0 && lease.deposit_status === 'held') {
      throw new ApiError(
        409,
        'La caution de ce bail est encore à régulariser — terminez le bail via un état des lieux de sortie (Locataires → Sortie), pas ce raccourci.',
      );
    }
    const [[heldAdditional]] = await conn.query(
      "SELECT COUNT(*) AS n FROM lease_deposits WHERE lease_id = :leaseId AND status = 'held'",
      { leaseId },
    );
    if (Number(heldAdditional.n) > 0) {
      throw new ApiError(
        409,
        'Une caution supplémentaire (SBEE/SONEB/peinture) de ce bail est encore à régulariser — terminez le bail via un état des lieux de sortie (Locataires → Sortie), pas ce raccourci.',
      );
    }

    await conn.beginTransaction();
    await conn.query('UPDATE leases SET status = :status, end_date = :endDate WHERE id = :id', {
      status: 'ended',
      endDate: endDate,
      id: leaseId,
    });
    await conn.query("UPDATE property_units SET status = 'libre' WHERE id = :id", {
      id: lease.unit_id,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Registre des paiements non annulés du bail. */
async function listLeasePayments(tenantId, leaseId, scopeAgentId) {
  await loadLease(pool, tenantId, leaseId, scopeAgentId);
  const [payments] = await pool.query(
    'SELECT * FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL ORDER BY paid_at DESC, id DESC',
    { leaseId },
  );
  return payments;
}

/** Annule (suppression logique) un paiement de loyer et extourne son écriture GL. */
async function cancelPayment(tenantId, userId, leaseId, paymentId, scopeAgentId, reason) {
  const conn = await pool.getConnection();
  try {
    await loadLease(conn, tenantId, leaseId, scopeAgentId);

    const [paymentRows] = await conn.query(
      'SELECT * FROM rent_payments WHERE id = :paymentId AND lease_id = :leaseId AND tenant_id = :tenantId LIMIT 1',
      { paymentId, leaseId, tenantId: tenantId },
    );
    if (!paymentRows[0]) throw new ApiError(404, 'Paiement introuvable');
    if (paymentRows[0].deleted_at) throw new ApiError(409, 'Ce paiement est déjà annulé');

    await assertPeriodOpen(tenantId, paymentRows[0].paid_at);

    // Bug corrigé (audit comptable du 30/09/2026) : cette annulation ne
    // vérifiait jamais son impact sur le solde séquestre du propriétaire —
    // si ce loyer avait déjà servi de base à un versement, l'annuler après
    // coup pouvait faire passer le solde séquestre SOUS ZÉRO, silencieusement
    // (rien ne bloquait, rien n'alertait). Verrouille la fiche du
    // propriétaire (même principe que `assertPayoutWithinBalance`, appelé
    // pour un NOUVEAU versement) avant de décider.
    // Propriétaire EN VIGUEUR à la date du paiement annulé (pas forcément l'actuel) : c'est son
    // solde séquestre, pas celui du propriétaire courant du Bien, que ce loyer a réellement affecté.
    const owner = await resolveOwnerFromLease(conn, tenantId, leaseId, paymentRows[0].paid_at);

    // Bug corrigé (audit fermeture du mois, point 5, 16/10/2026) : SI une écriture GL validée existe
    // pour ce paiement, son extourne plus bas est datée AUJOURD'HUI (date de l'écriture MIROIR
    // elle-même, jamais celle du paiement annulé, déjà vérifiée ci-dessus) — jamais vérifiée contre la
    // clôture du mois jusqu'ici. Même principe que le correctif déjà en place sur l'extourne MANUELLE.
    const todayIso = new Date().toISOString().slice(0, 10);
    const [[existingGlEntry]] = await conn.query(
      "SELECT id FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'rent_payments' AND source_id = :paymentId AND status = 'validee' LIMIT 1",
      { tenantId: tenantId, paymentId },
    );
    if (existingGlEntry) await assertPeriodOpen(tenantId, todayIso);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — la vérification ci-dessus (avant `beginTransaction`)
    // n'empêchait pas une clôture de mois de se glisser entre les deux.
    await assertPeriodOpenLocked(conn, tenantId, paymentRows[0].paid_at);
    if (existingGlEntry) await assertPeriodOpenLocked(conn, tenantId, todayIso);
    await conn.query('SELECT id FROM owners WHERE id = :id AND tenant_id = :tenantId FOR UPDATE', {
      id: owner.id,
      tenantId: tenantId,
    });

    await conn.query(
      'UPDATE rent_payments SET deleted_at = NOW(), deleted_by = :by, deleted_reason = :reason WHERE id = :id',
      { by: userId, reason, id: paymentId },
    );

    // Relit le solde séquestre SOUS CE VERROU, avec l'annulation déjà
    // appliquée dans CETTE transaction (visible ici, pas encore commitée) —
    // si ce loyer avait déjà été versé au propriétaire, l'annuler ferait
    // passer son solde sous zéro : on refuse plutôt que de laisser un
    // décalage invisible entre ce qui a été versé et ce qui a réellement
    // été encaissé.
    const balancesAfterCancel = await getEscrowBalances(tenantId, conn);
    const ownerBalanceAfterCancel = balancesAfterCancel.get(owner.id)?.balance ?? 0;
    if (ownerBalanceAfterCancel < 0) {
      throw new ApiError(
        409,
        `Impossible d'annuler ce paiement : ce montant a déjà été versé à ${owner.name} (le solde séquestre passerait à ${ownerBalanceAfterCancel} FCFA). Régularisez d'abord ce versement.`,
      );
    }

    const [glEntryRows] = await conn.query(
      "SELECT id, status FROM gl_entries WHERE tenant_id = :tenantId AND source_table = 'rent_payments' AND source_id = :paymentId LIMIT 1",
      { tenantId: tenantId, paymentId },
    );
    if (glEntryRows[0] && glEntryRows[0].status === 'validee') {
      await extourneEcriture(conn, {
        tenantId: tenantId,
        entryId: glEntryRows[0].id,
        entryDate: new Date().toISOString().slice(0, 10),
        userId: userId,
        reason: `Paiement annulé — ${reason}`,
      });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Enregistre un paiement de loyer (répartition multi-mois, quittances, écriture GL). */
async function createPayment(tenantId, userId, leaseId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const lease = await loadLease(conn, tenantId, leaseId, scopeAgentId);
    if (lease.status !== 'active') throw new ApiError(400, 'Ce bail est terminé, impossible d\'ajouter un paiement');
    await assertPeriodOpen(tenantId, data.paidAt);

    await conn.beginTransaction();
    // Bug corrigé (audit sécurité/logique) : re-vérifie SOUS VERROU, dans la
    // transaction — voir le commentaire détaillé sur `assertPeriodOpenLocked`.
    await assertPeriodOpenLocked(conn, tenantId, data.paidAt);

    // Sérialise les enregistrements concurrents sur ce bail : un double-clic ou
    // deux requêtes simultanées ne pourront pas insérer chacune sans voir l'autre.
    await conn.query('SELECT id FROM leases WHERE id = :leaseId FOR UPDATE', { leaseId });

    // Garde anti-doublon (étape 36). Voie normale : une clé d'idempotence jointe à l'envoi,
    // réclamée ici dans la transaction — un vrai doublon (rejeu de la file hors-ligne après une
    // réponse perdue, nouvelle tentative réseau) est refusé, mais deux paiements VOULUS ne sont
    // jamais confondus, même de montants égaux le même jour avec le même mode (deux moitiés d'un
    // loyer, par exemple). Envoi SANS clé (ancien client) : heuristique héritée, qui compare
    // désormais aussi le MONTANT — elle refusait à tort de payer le reste d'un mois partiel juste
    // après un premier versement. (Le verrou FOR UPDATE ci-dessus sérialise déjà les envois
    // strictement simultanés ; un mois différent reste toujours permis.)
    if (data.idempotencyKey) {
      await claimIdempotencyKey(conn, tenantId, 'rent_payment', data.idempotencyKey);
    } else {
      const isCalendaireForGuard = lease.rent_due_day != null;
      const rhythmForGuard = { mode: isCalendaireForGuard ? 'calendaire' : 'jour_fixe' };
      const [payRowsForGuard] = await conn.query(
        'SELECT covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id = :leaseId AND deleted_at IS NULL',
        { leaseId },
      );
      const startDateForGuard =
        lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;
      const arrearsForGuard = computeArrears({
        startDate: startDateForGuard,
        createdAt: lease.created_at,
        upToDateAtOnboarding: !!lease.up_to_date_at_onboarding,
        rentDueDay: lease.rent_due_day,
        rentDueOffsetDays: lease.rent_due_offset_days,
        rentTiming: lease.rent_timing,
        monthlyRent: lease.monthly_rent,
        entryProration: lease.entry_proration,
        payments: payRowsForGuard.map((r) => ({
          coversMonth: isCalendaireForGuard
            ? r.covers_month
            : r.covers_period_start instanceof Date
              ? r.covers_period_start.toISOString().slice(0, 10)
              : String(r.covers_period_start).slice(0, 10),
          amount: Number(r.amount),
        })),
        rhythm: rhythmForGuard,
      });
      const startMonthForGuard =
        data.coversMonth && data.coversMonth >= arrearsForGuard.nextDueMonth
          ? data.coversMonth
          : arrearsForGuard.nextDueMonth;
      // Montant de la PREMIÈRE écriture que ce paiement créerait (même répartition que `recordRentPayment`).
      const firstAllocation = allocateRentPayment({
        nextDueMonth: startMonthForGuard,
        monthlyRent: lease.monthly_rent,
        alreadyPaidForNextDueMonth: startMonthForGuard === arrearsForGuard.nextDueMonth ? arrearsForGuard.paidForNextDueMonth : 0,
        amount: data.amount,
        rhythm: rhythmForGuard,
      }).allocations[0];
      if (
        firstAllocation &&
        (await hasRecentIdenticalRentPayment(conn, {
          leaseId,
          coversPeriodStart: isCalendaireForGuard ? `${startMonthForGuard}-01` : startMonthForGuard,
          paidAt: data.paidAt,
          paymentMethod: data.paymentMethod,
          amount: firstAllocation.amount,
        }))
      ) {
        throw new ApiError(409, DUPLICATE_MESSAGE, { code: ['duplicate_request'] });
      }
    }

    const { fullMonths, partialAmount, monthsCovered, payments: created } = await recordRentPayment(conn, {
      tenantId: tenantId,
      lease,
      coversMonth: data.coversMonth,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      paidAt: data.paidAt,
      notes: data.notes,
      recordedBy: userId,
    });

    await conn.commit();
    notifyRentPaymentsRecorded(tenantId, created.map((c) => c.paymentId));
    return { created, monthsCovered, fullMonths, partialAmount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { endLease, listLeasePayments, cancelPayment, createPayment };
