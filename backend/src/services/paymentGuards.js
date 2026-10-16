'use strict';

/**
 * Garde-fous contre l'enregistrement en double d'un paiement de loyer (étape 36).
 *
 * 1. Clé d'idempotence (voie normale) : le navigateur en joint une à chaque envoi
 *    du formulaire ; `claimIdempotencyKey` la consomme DANS la transaction du
 *    paiement. Deux envois portant la même clé = un seul paiement ; deux envois
 *    de clés différentes ne sont JAMAIS confondus, quels que soient montant, date
 *    et mode.
 * 2. Heuristique héritée (envois SANS clé : ancien client, script) : un paiement
 *    identique — même mois de départ, même date, même mode ET MÊME MONTANT —
 *    enregistré il y a moins de 2 minutes. Elle ne comparait pas le montant :
 *    payer le reste d'un mois partiel juste après un premier versement (même mode,
 *    même jour) était refusé à tort.
 */

const { ApiError } = require('../middleware/error');

// Bug corrigé (audit sécurité/logique) : ce garde-fou sert désormais aussi à
// des envois non financiers (plaintes) — le message ne doit plus dire
// spécifiquement « paiement ».
const DUPLICATE_MESSAGE = 'Cet envoi a déjà été enregistré (envoi en double évité). Rechargez la page pour le voir.';

/** Réclame une clé (scope + clé) ; lève 409 `duplicate_request` si elle a déjà servi. À appeler dans la transaction du paiement. */
async function claimIdempotencyKey(conn, tenantId, scope, key) {
  try {
    await conn.query('INSERT INTO request_idempotency_keys (tenant_id, scope, idem_key) VALUES (:tenantId, :scope, :key)', {
      tenantId,
      scope,
      key,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, DUPLICATE_MESSAGE, { code: ['duplicate_request'] });
    throw err;
  }
}

/**
 * Vrai si un paiement strictement identique (période couverte, date, mode, montant) vient d'être
 * enregistré sur ce bail.
 *
 * Correctif de sécurité (refonte de la clôture, étape 2/5, 2026-10-16) : comparait auparavant sur
 * `covers_month` ('AAAA-MM'), qui n'est plus renseignée que pour les baux calendaire (migration
 * 085) — pour tout bail non-calendaire, la clause devenait `covers_month = NULL`, TOUJOURS fausse
 * en SQL, rendant ce garde-fou hérité silencieusement inerte (jamais un faux-positif, mais plus
 * aucune protection sur ce chemin de repli). Pivote désormais sur `covers_period_start`, TOUJOURS
 * renseignée quel que soit le rythme — règle le problème pour tout le monde, et simplifie l'appelant
 * (plus besoin de choisir quelle colonne comparer selon le bail).
 */
async function hasRecentIdenticalRentPayment(conn, { leaseId, coversPeriodStart, paidAt, paymentMethod, amount }) {
  const [rows] = await conn.query(
    `SELECT id FROM rent_payments
     WHERE lease_id = :leaseId AND covers_period_start = :coversPeriodStart AND paid_at = :paidAt AND payment_method = :paymentMethod
       AND amount = :amount AND created_at > (NOW() - INTERVAL 2 MINUTE) AND deleted_at IS NULL
     LIMIT 1`,
    { leaseId, coversPeriodStart, paidAt, paymentMethod, amount },
  );
  return rows.length > 0;
}

module.exports = { claimIdempotencyKey, hasRecentIdenticalRentPayment, DUPLICATE_MESSAGE };
