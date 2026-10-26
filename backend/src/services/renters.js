'use strict';

/**
 * Accès base de données du module locataires : lecture (liste, fiche), création de locataire + bail,
 * nouveau bail, notes, portail. La route (`routes/renters.js`) ne garde que la validation, les codes
 * HTTP et la mise en forme publique (`toPublic*`).
 */

const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { computeEntryProrata } = require('./rentTracking');
const { generatePortalToken, hashToken } = require('../utils/tokens');
const { assertRenterInScope } = require('./scope');
const { assertPeriodOpen, assertPeriodOpenLocked, getTenantRhythm } = require('./accountingPeriods');
const { genererEcriture, isModuleActive } = require('./gl/glPostingService');
const { recordAdditionalDeposits, listLeaseDeposits } = require('./leaseDeposits');
const { createEntryReceiptIfAnyPayment } = require('./leaseEntryReceipt');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Colonnes communes bail + unité + bien + propriétaire, réutilisées par la
// liste et la fiche (le propriétaire est une fiche à part depuis l'étape 5 :
// jointure sur owners plutôt que des colonnes texte sur properties).
const LEASE_UNIT_PROPERTY_SELECT = `
  l.id AS lease_id, l.monthly_rent AS lease_monthly_rent, l.deposit_amount,
  l.deposit_status, l.opening_debt_amount, l.up_to_date_at_onboarding,
  l.entry_fee_amount, l.entry_fee_received_at, l.entry_fee_received_method,
  l.entry_proration, l.entry_prorata_amount, l.entry_prorata_days, l.entry_prorata_due_date,
  l.entry_prorata_received_at, l.entry_prorata_received_method,
  l.rent_due_day, l.rent_due_offset_days, l.rent_timing, l.start_date, l.end_date, l.status AS lease_status,
  l.created_at AS lease_created_at,
  lu.first_name AS lease_creator_first_name, lu.last_name AS lease_creator_last_name, lu.role AS lease_creator_role,
  ler.receipt_number AS entry_receipt_number,
  u.id AS unit_id, u.code AS unit_code, u.designation, u.designation_custom,
  u.soneb_meter_number, u.sbee_meter_number, u.furnished,
  p.id AS property_id, p.code AS property_code, p.address, p.property_type, p.levels,
  o.id AS owner_id, o.name AS owner_name, o.phone AS owner_phone
`;
// Jointure sur l'auteur du bail — à ajouter au FROM partout où
// LEASE_UNIT_PROPERTY_SELECT est utilisé.
const LEASE_CREATOR_JOIN = 'LEFT JOIN users lu ON lu.id = l.created_by';
// Reçu d'entrée (demande utilisateur, 2026-10-17) — au plus une ligne par bail, voir migration 091.
const LEASE_ENTRY_RECEIPT_JOIN = 'LEFT JOIN lease_entry_receipts ler ON ler.lease_id = l.id';

const RENTER_WITH_ACTORS_SELECT = `SELECT r.*, ru.first_name AS renter_creator_first_name, ru.last_name AS renter_creator_last_name, ru.role AS renter_creator_role,
              nu.first_name AS notes_updater_first_name, nu.last_name AS notes_updater_last_name, nu.role AS notes_updater_role
       FROM renters r
       LEFT JOIN users ru ON ru.id = r.created_by
       LEFT JOIN users nu ON nu.id = r.notes_updated_by`;

/**
 * Un même numéro de téléphone ne doit jamais être utilisé par deux
 * locataires différents de la même entreprise — un vrai doublon a été trouvé
 * sur une entreprise réelle (deux locataires actifs, deux baux différents)
 * en construisant ce contrôle : la contrainte UNIQUE en base n'a donc PAS pu
 * être ajoutée (migration 059) tant que ce cas précis n'est pas corrigé —
 * seul ce contrôle applicatif empêche tout NOUVEAU doublon en attendant.
 * Le téléphone d'un locataire n'est jamais modifiable après création
 * (aucune route ne l'expose), donc seule la création doit être vérifiée.
 */
async function assertRenterPhoneAvailable(conn, tenantId, phone) {
  const [rows] = await conn.query('SELECT id FROM renters WHERE tenant_id = :tenantId AND phone = :phone LIMIT 1', {
    tenantId,
    phone,
  });
  if (rows[0]) throw new ApiError(409, 'Ce numéro de téléphone est déjà utilisé par un autre locataire');
}

/**
 * Module comptabilité SYSCOHADA (nouveau) — la caution n'avait jusqu'ici
 * aucun mouvement de trésorerie réel (`leases.deposit_amount` purement
 * déclaratif). Enregistre sa RÉCEPTION réelle (date + mode) et, si le module
 * est activé, génère sa contrepartie comptable (compte 165, tiers-locataire)
 * dans LA MÊME transaction que la création du bail — mêmes principes que
 * `recordRentPayment` (leases.js). Sans effet si `depositAmount` est 0 (bail
 * sans caution) ou si le mode de règlement n'a pas été fourni.
 */
async function recordDepositReceived(conn, { tenantId, leaseId, amount, paymentMethod, paidAt, renterName, createdBy }) {
  if (!amount || amount <= 0 || !paymentMethod) return;

  // Bug corrigé (audit fermeture du mois, point 1, 16/10/2026) : cette caution — un vrai mouvement de
  // trésorerie — ne vérifiait jamais la clôture du mois. Toujours appelée DANS la transaction déjà
  // ouverte par l'appelant : la version verrouillée (`FOR UPDATE`) suffit ici, la pré-vérification
  // non verrouillée a déjà eu lieu avant `beginTransaction`.
  await assertPeriodOpenLocked(conn, tenantId, paidAt);

  await conn.query('UPDATE leases SET deposit_received_at = :paidAt, deposit_received_method = :method WHERE id = :id', {
    paidAt,
    method: paymentMethod,
    id: leaseId,
  });

  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId,
      operationType: 'caution_recue',
      entryDate: paidAt,
      amount,
      paymentMethod,
      narrationVars: { locataire: renterName },
      sourceTable: 'leases',
      sourceId: leaseId,
      createdBy,
      context: { leaseId },
    });
  }
}

/**
 * Frais d'agence pris DIRECTEMENT au locataire à la signature du bail — 100 %
 * produit du CABINET, jamais reversé au propriétaire (demande explicite de
 * l'utilisateur : « ça devient directement celui de l'entreprise, jamais
 * comptabilisé dans la recette du propriétaire »). Même principe que
 * `recordDepositReceived` ci-dessus (trace réelle + contrepartie GL dans LA
 * MÊME transaction), mais `sourceTable` volontairement DIFFÉRENT ('leases'
 * est déjà pris par la caution sur ce même bail) : `glActivationService`
 * dédoublonne son rattrapage par (source_table, source_id) SANS regarder le
 * type d'opération — réutiliser 'leases' ferait ignorer silencieusement ces
 * frais s'ils coexistent avec une caution sur le même bail.
 */
async function recordEntryFeeReceived(conn, { tenantId, leaseId, amount, paymentMethod, paidAt, renterName, createdBy }) {
  if (!amount || amount <= 0 || !paymentMethod) return;

  // Bug corrigé (audit fermeture du mois, point 1) — voir `recordDepositReceived` ci-dessus.
  await assertPeriodOpenLocked(conn, tenantId, paidAt);

  await conn.query(
    'UPDATE leases SET entry_fee_received_at = :paidAt, entry_fee_received_method = :method WHERE id = :id',
    { paidAt, method: paymentMethod, id: leaseId },
  );

  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId,
      operationType: 'frais_agence_encaisse',
      entryDate: paidAt,
      amount,
      paymentMethod,
      narrationVars: { locataire: renterName },
      sourceTable: 'lease_entry_fees',
      sourceId: leaseId,
      createdBy,
      context: {},
    });
  }
}

/**
 * Convention de paiement du loyer (avance/terme échu, demande directe de
 * l'utilisateur, 2026-09-24) — si l'agent n'en a pas choisi une explicitement
 * à la création du bail, retombe sur le réglage par défaut de l'entreprise
 * (Paramètres). Jamais un défaut codé en dur ici : chaque entreprise choisit
 * le sien (`tenants.default_rent_timing`, lui-même par défaut 'avance').
 */
async function resolveRentTiming(conn, tenantId, explicit) {
  if (explicit) return explicit;
  const [rows] = await conn.query('SELECT default_rent_timing FROM tenants WHERE id = :tenantId LIMIT 1', {
    tenantId,
  });
  return rows[0]?.default_rent_timing ?? 'avance';
}

/** Même principe que `resolveRentTiming`, pour le prorata d'entrée (étape 42, `tenants.default_entry_proration`, défaut 'aucun'). */
async function resolveEntryProration(conn, tenantId, explicit) {
  if (explicit) return explicit;
  const [rows] = await conn.query('SELECT default_entry_proration FROM tenants WHERE id = :tenantId LIMIT 1', {
    tenantId,
  });
  return rows[0]?.default_entry_proration ?? 'aucun';
}

/** `entries` (cautions supplémentaires soumises) avec `paidAt` par défaut = date de début du bail — même
 * convention que la caution de loyer/les frais d'agence/le prorata ci-dessus. */
function withDefaultPaidAt(entries, startDate) {
  if (!entries) return entries;
  return Object.fromEntries(
    Object.entries(entries).map(([type, entry]) => [type, { ...entry, paidAt: entry.paidAt || startDate }]),
  );
}

/**
 * Audit fermeture du mois (point 1, 16/10/2026) : caution, frais d'agence, prorata d'entrée et
 * cautions supplémentaires sont tous de vrais mouvements de trésorerie à la signature d'un bail,
 * jamais vérifiés contre la clôture du mois jusqu'ici. Chacun peut avoir sa PROPRE date (jamais
 * supposée identique à `startDate`) — toutes les dates distinctes effectivement utilisées (montant >
 * 0 ET mode de règlement fourni, sinon rien n'est écrit) sont vérifiées AVANT d'ouvrir la transaction
 * (échec rapide, jamais une transaction partiellement construite puis annulée).
 */
function collectLeaseEntryPaidDates({
  depositAmount,
  depositPaymentMethod,
  depositPaidAt,
  entryFeeAmount,
  entryFeePaymentMethod,
  entryFeePaidAt,
  entryProrataAmount,
  entryProrataPaymentMethod,
  entryProrataPaidAt,
  additionalDeposits,
  startDate,
}) {
  const dates = new Set();
  if (depositAmount > 0 && depositPaymentMethod) dates.add(depositPaidAt || startDate);
  if (entryFeeAmount > 0 && entryFeePaymentMethod) dates.add(entryFeePaidAt || startDate);
  if (entryProrataAmount > 0 && entryProrataPaymentMethod) dates.add(entryProrataPaidAt || startDate);
  for (const entry of Object.values(additionalDeposits ?? {})) {
    if (Number(entry?.amount) > 0 && entry?.paymentMethod) dates.add(entry.paidAt || startDate);
  }
  return [...dates];
}

async function assertLeaseEntryPeriodsOpen(tenantId, dates) {
  for (const date of dates) await assertPeriodOpen(tenantId, date);
}

/** Types de cautions supplémentaires (SBEE/SONEB/peinture) activés par CETTE entreprise (étape 43). */
async function loadDepositTogglesRow(conn, tenantId) {
  const [rows] = await conn.query(
    'SELECT deposit_sbee_enabled, deposit_soneb_enabled, deposit_peinture_enabled FROM tenants WHERE id = :tenantId LIMIT 1',
    { tenantId },
  );
  return rows[0] ?? { deposit_sbee_enabled: 0, deposit_soneb_enabled: 0, deposit_peinture_enabled: 0 };
}

/**
 * Prorata d'entrée réglé à la signature (étape 42) — même principe que
 * `recordEntryFeeReceived` ci-dessus (trace réelle + contrepartie GL dans LA
 * MÊME transaction), mais `sourceTable` DIFFÉRENT ('lease_entry_prorata',
 * jamais 'leases' ni 'lease_entry_fees') pour ne jamais se faire ignorer par
 * le dédoublonnage par (source_table, source_id) si une caution ou des frais
 * d'agence existent déjà sur ce même bail.
 */
async function recordEntryProrataReceived(conn, { tenantId, leaseId, amount, paymentMethod, paidAt, renterName, createdBy }) {
  if (!amount || amount <= 0 || !paymentMethod) return;

  // Bug corrigé (audit fermeture du mois, point 1) — voir `recordDepositReceived` ci-dessus.
  await assertPeriodOpenLocked(conn, tenantId, paidAt);

  await conn.query(
    'UPDATE leases SET entry_prorata_received_at = :paidAt, entry_prorata_received_method = :method WHERE id = :id',
    { paidAt, method: paymentMethod, id: leaseId },
  );

  if (await isModuleActive(conn, tenantId)) {
    await genererEcriture(conn, {
      tenantId,
      operationType: 'prorata_entree_encaisse',
      entryDate: paidAt,
      amount,
      paymentMethod,
      narrationVars: { locataire: renterName },
      sourceTable: 'lease_entry_prorata',
      sourceId: leaseId,
      createdBy,
      context: { leaseId },
    });
  }
}

/**
 * Marketplace : une Unité qui reçoit un nouveau bail n'est plus vacante —
 * son éventuelle annonce doit disparaître, pour ne jamais réafficher un
 * contenu obsolète (prix, description, photos) la prochaine fois qu'elle
 * se libère. Renvoie les chemins de photos à supprimer du disque APRÈS le
 * commit (jamais avant, pour ne rien perdre si la transaction échoue).
 */
async function clearMarketplaceListing(conn, tenantId, unitId) {
  const [rows] = await conn.query(
    'SELECT photo_paths FROM marketplace_listings WHERE unit_id = :unitId AND tenant_id = :tenantId',
    { unitId, tenantId },
  );
  if (!rows[0]) return [];
  await conn.query('DELETE FROM marketplace_listings WHERE unit_id = :unitId AND tenant_id = :tenantId', {
    unitId,
    tenantId,
  });
  return rows[0].photo_paths || [];
}

/**
 * Charge une unité LIBRE de l'entreprise courante, ou lève une erreur
 * explicite. `scopeAgentId` (étape 14) : un agent restreint ne peut installer
 * un locataire que sur une unité d'un Bien qui lui est attribué — 404, pas
 * 409, pour ne jamais laisser deviner qu'une unité existe hors de sa portée.
 */
async function loadAvailableUnit(conn, tenantId, unitId, scopeAgentId = null) {
  const [rows] = await conn.query(
    `SELECT u.*, p.code AS property_code, p.agent_id AS property_agent_id
     FROM property_units u JOIN properties p ON p.id = u.property_id
     WHERE u.id = :unitId AND u.tenant_id = :tenantId LIMIT 1`,
    { unitId, tenantId },
  );
  if (!rows[0]) throw new ApiError(404, 'Unité introuvable');
  if (scopeAgentId != null && Number(rows[0].property_agent_id) !== Number(scopeAgentId)) {
    throw new ApiError(404, 'Unité introuvable');
  }
  if (rows[0].status !== 'libre') {
    throw new ApiError(409, `Cette unité n'est pas libre (statut : ${rows[0].status}).`);
  }
  return rows[0];
}

/** Fiche locataire (avec auteurs de création/note), ou `undefined`. */
async function findRenterWithActors(db, tenantId, id) {
  const [rows] = await db.query(`${RENTER_WITH_ACTORS_SELECT} WHERE r.id = :id AND r.tenant_id = :tenantId LIMIT 1`, {
    id,
    tenantId,
  });
  return rows[0];
}

async function assertRenterExists(db, tenantId, id) {
  const [existing] = await db.query('SELECT id FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1', {
    id,
    tenantId,
  });
  if (!existing[0]) throw new ApiError(404, 'Locataire introuvable');
}

async function loadRenterWithActorsById(id) {
  const [rows] = await pool.query(`${RENTER_WITH_ACTORS_SELECT} WHERE r.id = :id`, { id });
  return rows[0];
}

// ─── Lecture ────────────────────────────────────────────────────────────────

/**
 * Liste avec bail actif. Renvoie les lignes brutes, les paiements de loyer par bail et, pour les
 * locataires sans bail actif, leur dernier bail terminé (ligne brute) — la mise en forme publique
 * reste dans la route.
 */
async function listRenters(tenantId, scopeAgentId) {
  // Portée « Biens gérés » (étape 14) : un agent restreint ne voit que les
  // locataires dont le bail actif porte sur un Bien qui lui est attribué —
  // via une sous-requête EXISTS plutôt que le LEFT JOIN `p` ci-dessous
  // (celui-ci reste LEFT car un locataire sans bail actif doit continuer
  // d'apparaître pour qui a un accès complet).
  const params = { tenantId };
  let scopeClause = '';
  if (scopeAgentId != null) {
    scopeClause = `
        AND EXISTS (
          SELECT 1 FROM leases sl
          JOIN property_units su ON su.id = sl.unit_id
          JOIN properties sp ON sp.id = su.property_id
          WHERE sl.renter_id = r.id AND sl.status = 'active' AND sp.agent_id = :scopeAgentId
        )`;
    params.scopeAgentId = scopeAgentId;
  }

  const [rows] = await pool.query(
    `SELECT r.*,
              ru.first_name AS renter_creator_first_name, ru.last_name AS renter_creator_last_name, ru.role AS renter_creator_role,
              ${LEASE_UNIT_PROPERTY_SELECT}
       FROM renters r
       LEFT JOIN users ru ON ru.id = r.created_by
       LEFT JOIN leases l ON l.renter_id = r.id AND l.status = 'active'
       ${LEASE_CREATOR_JOIN}
       ${LEASE_ENTRY_RECEIPT_JOIN}
       LEFT JOIN property_units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = u.property_id
       LEFT JOIN owners o ON o.id = p.owner_id
       WHERE r.tenant_id = :tenantId
       ${scopeClause}
       ORDER BY r.created_at DESC`,
    params,
  );

  const leaseIds = rows.filter((r) => r.lease_id).map((r) => r.lease_id);
  // Rythme de CHAQUE bail (étape 2/5) : dérivé de ses propres colonnes (`rent_due_day` renseigné =
  // calendaire), jamais besoin de requêter le tenant — un bail garde son rythme pour toute sa durée.
  const isCalendaireByLease = new Map(rows.filter((r) => r.lease_id).map((r) => [r.lease_id, r.rent_due_day != null]));
  const paymentsByLease = new Map();
  if (leaseIds.length > 0) {
    const placeholders = leaseIds.map(() => '?').join(',');
    const [payments] = await pool.query(
      `SELECT lease_id, covers_month, covers_period_start, amount FROM rent_payments WHERE lease_id IN (${placeholders}) AND deleted_at IS NULL`,
      leaseIds,
    );
    for (const p of payments) {
      if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
      const coversMonth = isCalendaireByLease.get(p.lease_id)
        ? p.covers_month
        : p.covers_period_start instanceof Date
          ? p.covers_period_start.toISOString().slice(0, 10)
          : String(p.covers_period_start).slice(0, 10);
      paymentsByLease.get(p.lease_id).push({ coversMonth, amount: Number(p.amount) });
    }
  }

  // Archive des locataires (demande utilisateur, 2026-10-18) : un locataire sans bail actif reste
  // dans la liste mais la liste frontend le classe à part — elle a besoin, pour l'y afficher
  // utilement, du DERNIER bail terminé (jamais plusieurs, une seule ligne par locataire) : date de
  // sortie, dernière unité occupée. `ROW_NUMBER()` plutôt qu'une sous-requête corrélée par ligne —
  // une seule requête pour tous les locataires archivés de cette page, jamais une par locataire.
  const rentersWithoutActiveLease = rows.filter((r) => !r.lease_id).map((r) => r.id);
  const lastEndedLeaseRowByRenter = new Map();
  if (rentersWithoutActiveLease.length > 0) {
    const placeholders = rentersWithoutActiveLease.map(() => '?').join(',');
    const [endedRows] = await pool.query(
      `SELECT * FROM (
           SELECT l.renter_id, l.monthly_rent, l.end_date,
                  u.code AS unit_code, u.designation, u.designation_custom,
                  p.address, o.name AS owner_name,
                  ROW_NUMBER() OVER (PARTITION BY l.renter_id ORDER BY l.end_date DESC, l.id DESC) AS rn
           FROM leases l
           JOIN property_units u ON u.id = l.unit_id
           JOIN properties p ON p.id = u.property_id
           JOIN owners o ON o.id = p.owner_id
           WHERE l.tenant_id = ? AND l.renter_id IN (${placeholders}) AND l.status = 'ended'
         ) t WHERE rn = 1`,
      [tenantId, ...rentersWithoutActiveLease],
    );
    for (const r of endedRows) lastEndedLeaseRowByRenter.set(r.renter_id, r);
  }

  return { rows, paymentsByLease, lastEndedLeaseRowByRenter };
}

/**
 * Fiche complète : locataire, baux et, par bail, cautions supplémentaires, règlements de la dette
 * initiale, paiements (+ reçus), états des lieux d'entrée/sortie — tous en lignes brutes, groupés
 * par `lease_id` (une requête par type pour tout l'historique, jamais N requêtes).
 */
async function getRenterDetail(tenantId, id) {
  const renterRow = await findRenterWithActors(pool, tenantId, id);
  if (!renterRow) throw new ApiError(404, 'Locataire introuvable');

  const [leaseRows] = await pool.query(
    `SELECT l.*, ${LEASE_UNIT_PROPERTY_SELECT}
       FROM leases l
       ${LEASE_CREATOR_JOIN}
       ${LEASE_ENTRY_RECEIPT_JOIN}
       JOIN property_units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN owners o ON o.id = p.owner_id
       WHERE l.renter_id = :id AND l.tenant_id = :tenantId
       ORDER BY l.start_date DESC`,
    { id, tenantId },
  );

  const leaseIds = leaseRows.map((l) => l.id);
  let paymentsByLease = new Map();
  let receiptsByPayment = new Map();
  let moveInByLease = new Map();
  let moveOutByLease = new Map();
  const openingDebtPaymentsByLease = new Map();
  const additionalDepositsByLease = new Map();

  if (leaseIds.length > 0) {
    const placeholders = leaseIds.map(() => '?').join(',');

    // Cautions supplémentaires (étape 43) — mêmes types que le catalogue (SBEE, SONEB, peinture).
    const [additionalDeposits] = await pool.query(
      `SELECT * FROM lease_deposits WHERE lease_id IN (${placeholders})`,
      leaseIds,
    );
    for (const d of additionalDeposits) {
      if (!additionalDepositsByLease.has(d.lease_id)) additionalDepositsByLease.set(d.lease_id, []);
      additionalDepositsByLease.get(d.lease_id).push(d);
    }

    const [openingDebtPayments] = await pool.query(
      `SELECT lodp.*, pu.first_name AS recorder_first_name, pu.last_name AS recorder_last_name, pu.role AS recorder_role
         FROM lease_opening_debt_payments lodp JOIN users pu ON pu.id = lodp.recorded_by
         WHERE lodp.lease_id IN (${placeholders}) ORDER BY lodp.paid_at DESC, lodp.id DESC`,
      leaseIds,
    );
    for (const p of openingDebtPayments) {
      if (!openingDebtPaymentsByLease.has(p.lease_id)) openingDebtPaymentsByLease.set(p.lease_id, []);
      openingDebtPaymentsByLease.get(p.lease_id).push(p);
    }

    const [payments] = await pool.query(
      `SELECT rp.*, pu.first_name AS recorder_first_name, pu.last_name AS recorder_last_name, pu.role AS recorder_role
         FROM rent_payments rp LEFT JOIN users pu ON pu.id = rp.recorded_by
         WHERE rp.lease_id IN (${placeholders}) AND rp.deleted_at IS NULL ORDER BY rp.paid_at DESC, rp.id DESC`,
      leaseIds,
    );
    const paymentIds = payments.map((p) => p.id);
    let receipts = [];
    if (paymentIds.length > 0) {
      const ph2 = paymentIds.map(() => '?').join(',');
      [receipts] = await pool.query(`SELECT * FROM receipts WHERE payment_id IN (${ph2})`, paymentIds);
    }
    receiptsByPayment = new Map(receipts.map((r) => [r.payment_id, r]));
    for (const p of payments) {
      if (!paymentsByLease.has(p.lease_id)) paymentsByLease.set(p.lease_id, []);
      paymentsByLease.get(p.lease_id).push(p);
    }

    const [reports] = await pool.query(
      `SELECT mir.*, cu.first_name AS conductor_first_name, cu.last_name AS conductor_last_name, cu.role AS conductor_role,
                fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role
         FROM move_in_reports mir
         LEFT JOIN users cu ON cu.id = mir.conducted_by
         LEFT JOIN users fu ON fu.id = mir.finalized_by
         WHERE mir.lease_id IN (${placeholders})`,
      leaseIds,
    );
    moveInByLease = new Map(reports.map((r) => [r.lease_id, r]));

    const [outReports] = await pool.query(
      `SELECT mor.*, cu.first_name AS conductor_first_name, cu.last_name AS conductor_last_name, cu.role AS conductor_role,
                fu.first_name AS finalizer_first_name, fu.last_name AS finalizer_last_name, fu.role AS finalizer_role
         FROM move_out_reports mor
         LEFT JOIN users cu ON cu.id = mor.conducted_by
         LEFT JOIN users fu ON fu.id = mor.finalized_by
         WHERE mor.lease_id IN (${placeholders})`,
      leaseIds,
    );
    moveOutByLease = new Map(outReports.map((r) => [r.lease_id, r]));
  }

  return {
    renterRow,
    leaseRows,
    paymentsByLease,
    receiptsByPayment,
    moveInByLease,
    moveOutByLease,
    openingDebtPaymentsByLease,
    additionalDepositsByLease,
  };
}

// ─── Écriture ───────────────────────────────────────────────────────────────

/**
 * Conditions du bail à créer, calculées côté serveur (jamais transmises par le client) :
 * loyer, convention de paiement, rythme du TENANT (pas du bail, qui n'existe pas encore),
 * prorata d'entrée (étape 42). Vérifie aussi, AVANT toute transaction, que les périodes des
 * mouvements de trésorerie de la signature sont ouvertes.
 */
async function prepareLeaseTerms(conn, tenantId, unit, data) {
  const rent = data.monthlyRent ?? Number(unit.monthly_rent);
  const rentTiming = await resolveRentTiming(conn, tenantId, data.rentTiming);
  // Refonte de la clôture (étape 2/5) : `rent_due_day` (jour du mois civil) pour une entreprise
  // calendaire ; `rent_due_offset_days` sinon (rythme choisi par le DG sur la page Clôture).
  const tenantRhythm = await getTenantRhythm(tenantId);
  const isCalendaireLease = tenantRhythm.mode === 'calendaire';
  // Prorata d'entrée (étape 42) : jours + montant TOUJOURS calculés par le serveur. `days`/`dueDate`
  // gardés même si la politique est 'aucun' (transparence/affichage) ; seul `entryProrataAmount`
  // retombe à 0 pour ne rien facturer dans ce cas. Un bail non-calendaire n'a jamais de prorata
  // d'entrée (voir `rentTracking.js`, doc de `computeEntryProrata`).
  const entryProration = await resolveEntryProration(conn, tenantId, data.entryProration);
  const prorata = isCalendaireLease
    ? computeEntryProrata({ startDate: data.startDate, monthlyRent: rent, rentDueDay: data.rentDueDay })
    : { days: 0, amount: 0, dueDate: data.startDate };
  const entryProrataAmount = entryProration === 'prorata' && isCalendaireLease ? prorata.amount : 0;

  // Audit fermeture du mois (point 1) : pré-vérification AVANT d'ouvrir la transaction — voir
  // `collectLeaseEntryPaidDates`. La version verrouillée (dans la transaction) reste le vrai
  // garde-fou contre une course ; celle-ci n'est qu'un échec rapide.
  await assertLeaseEntryPeriodsOpen(
    tenantId,
    collectLeaseEntryPaidDates({
      depositAmount: data.depositAmount,
      depositPaymentMethod: data.depositPaymentMethod,
      depositPaidAt: data.depositPaidAt,
      entryFeeAmount: data.entryFeeAmount,
      entryFeePaymentMethod: data.entryFeePaymentMethod,
      entryFeePaidAt: data.entryFeePaidAt,
      entryProrataAmount,
      entryProrataPaymentMethod: data.entryProrataPaymentMethod,
      entryProrataPaidAt: data.entryProrataPaidAt,
      additionalDeposits: data.additionalDeposits,
      startDate: data.startDate,
    }),
  );

  return { rent, rentTiming, isCalendaireLease, entryProration, prorata, entryProrataAmount };
}

/**
 * Dans la transaction ouverte par l'appelant : insère le bail, enregistre caution / frais d'agence /
 * prorata / cautions supplémentaires, émet le reçu d'entrée, passe l'unité à « loué » et retire son
 * annonce marketplace. Renvoie ce dont la route a besoin pour répondre (+ photos à supprimer après commit).
 */
async function insertLeaseWithEntries(conn, { tenantId, userId, renterId, renterName, data, terms }) {
  const { rent, rentTiming, isCalendaireLease, entryProration, prorata, entryProrataAmount } = terms;

  const [leaseResult] = await conn.query(
    `INSERT INTO leases (tenant_id, unit_id, renter_id, monthly_rent, deposit_amount, rent_due_day, rent_due_offset_days, rent_timing, start_date, created_by, opening_debt_amount, up_to_date_at_onboarding, entry_fee_amount, entry_proration, entry_prorata_amount, entry_prorata_days, entry_prorata_due_date)
       VALUES (:tenantId, :unitId, :renterId, :rent, :deposit, :dueDay, :dueOffsetDays, :rentTiming, :startDate, :createdBy, :openingDebtAmount, :upToDate, :entryFeeAmount, :entryProration, :entryProrataAmount, :entryProrataDays, :entryProrataDueDate)`,
    {
      tenantId,
      unitId: data.unitId,
      renterId,
      rent,
      deposit: data.depositAmount,
      dueDay: isCalendaireLease ? data.rentDueDay : null,
      dueOffsetDays: isCalendaireLease ? null : data.rentDueOffsetDays,
      rentTiming,
      startDate: data.startDate,
      createdBy: userId,
      openingDebtAmount: data.openingDebtAmount,
      upToDate: data.upToDateAtOnboarding ? 1 : 0,
      entryFeeAmount: data.entryFeeAmount,
      entryProration,
      entryProrataAmount,
      entryProrataDays: prorata.days,
      entryProrataDueDate: prorata.dueDate,
    },
  );
  const leaseId = leaseResult.insertId;

  await recordDepositReceived(conn, {
    tenantId,
    leaseId,
    amount: data.depositAmount,
    paymentMethod: data.depositPaymentMethod,
    paidAt: data.depositPaidAt || data.startDate,
    renterName,
    createdBy: userId,
  });

  await recordEntryFeeReceived(conn, {
    tenantId,
    leaseId,
    amount: data.entryFeeAmount,
    paymentMethod: data.entryFeePaymentMethod,
    paidAt: data.entryFeePaidAt || data.startDate,
    renterName,
    createdBy: userId,
  });

  await recordEntryProrataReceived(conn, {
    tenantId,
    leaseId,
    amount: entryProrataAmount,
    paymentMethod: data.entryProrataPaymentMethod,
    paidAt: data.entryProrataPaidAt || data.startDate,
    renterName,
    createdBy: userId,
  });

  await recordAdditionalDeposits(conn, {
    tenantId,
    leaseId,
    renterName,
    createdBy: userId,
    enabledTenantRow: await loadDepositTogglesRow(conn, tenantId),
    entries: withDefaultPaidAt(data.additionalDeposits, data.startDate),
  });
  const additionalDeposits = await listLeaseDeposits(tenantId, leaseId, conn);

  // Reçu d'entrée (demande utilisateur, 2026-10-17) : regroupe caution, frais d'agence, cautions
  // supplémentaires et prorata en UN seul reçu dès que l'un d'eux a réellement été payé à la
  // signature — voir `services/leaseEntryReceipt.js`. Relit la ligne `leases` fraîche : c'est elle
  // qui fait foi de ce qui a été réellement marqué reçu.
  const [freshLeaseRows] = await conn.query('SELECT * FROM leases WHERE id = :id LIMIT 1', { id: leaseId });
  const entryReceipt = await createEntryReceiptIfAnyPayment(conn, {
    tenantId,
    leaseId,
    createdBy: userId,
    lease: freshLeaseRows[0],
    additionalDeposits,
  });

  await conn.query("UPDATE property_units SET status = 'loue' WHERE id = :unitId", { unitId: data.unitId });
  const clearedMarketplacePhotos = await clearMarketplaceListing(conn, tenantId, data.unitId);

  return { leaseId, additionalDeposits, entryReceipt, clearedMarketplacePhotos };
}

async function removeClearedPhotos(relPaths) {
  for (const rel of relPaths) {
    await fs.unlink(path.join(UPLOADS_ROOT, rel)).catch(() => {});
  }
}

function entryProrataSummary(terms) {
  return {
    proration: terms.entryProration,
    amount: terms.entryProrataAmount,
    days: terms.prorata.days,
    dueDate: terms.prorata.dueDate,
  };
}

/** Création d'un locataire + bail sur une unité libre, + lien du portail (token en clair renvoyé une seule fois). */
async function createRenter(tenantId, userId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const unit = await loadAvailableUnit(conn, tenantId, data.unitId, scopeAgentId);
    await assertRenterPhoneAvailable(conn, tenantId, data.phone);

    const terms = await prepareLeaseTerms(conn, tenantId, unit, data);

    await conn.beginTransaction();

    const [renterResult] = await conn.query(
      `INSERT INTO renters (tenant_id, first_name, last_name, phone, email, profession, notes, created_by)
       VALUES (:tenantId, :firstName, :lastName, :phone, :email, :profession, :notes, :createdBy)`,
      {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        email: data.email,
        profession: data.profession,
        notes: data.notes,
        createdBy: userId,
      },
    );
    const renterId = renterResult.insertId;

    const { leaseId, additionalDeposits, entryReceipt, clearedMarketplacePhotos } = await insertLeaseWithEntries(conn, {
      tenantId,
      userId,
      renterId,
      renterName: `${data.firstName} ${data.lastName}`,
      data,
      terms,
    });

    // Lien du portail locataire (étape 13, idée n°2) : généré automatiquement dès la création,
    // jamais une étape à part que quelqu'un pourrait oublier. Le token n'est renvoyé qu'ici, une
    // seule fois (voir `regeneratePortalLink` pour le régénérer plus tard).
    const portalToken = generatePortalToken();
    await conn.query('UPDATE renters SET portal_token_hash = :hash, portal_link_created_at = NOW() WHERE id = :id', {
      hash: hashToken(portalToken),
      id: renterId,
    });

    await conn.commit();
    await removeClearedPhotos(clearedMarketplacePhotos);

    return {
      renterId,
      leaseId,
      entryProrata: entryProrataSummary(terms),
      additionalDeposits,
      entryReceipt,
      portalToken,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Nouveau bail (renouvellement / changement d'unité) pour un locataire existant. */
async function createLease(tenantId, userId, renterId, scopeAgentId, data) {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT id, first_name, last_name FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
      { id: renterId, tenantId },
    );
    if (!existing[0]) throw new ApiError(404, 'Locataire introuvable');
    await assertRenterInScope(tenantId, renterId, scopeAgentId);

    const unit = await loadAvailableUnit(conn, tenantId, data.unitId, scopeAgentId);
    const terms = await prepareLeaseTerms(conn, tenantId, unit, data);

    await conn.beginTransaction();

    const { leaseId, additionalDeposits, entryReceipt, clearedMarketplacePhotos } = await insertLeaseWithEntries(conn, {
      tenantId,
      userId,
      renterId,
      renterName: `${existing[0].first_name} ${existing[0].last_name}`,
      data,
      terms,
    });

    await conn.commit();
    await removeClearedPhotos(clearedMarketplacePhotos);

    return { leaseId, entryProrata: entryProrataSummary(terms), additionalDeposits, entryReceipt };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Mise à jour de l'identité (prénom, nom, email, profession) ; renvoie la fiche mise à jour. */
async function updateRenter(tenantId, id, scopeAgentId, data) {
  await assertRenterExists(pool, tenantId, id);
  await assertRenterInScope(tenantId, id, scopeAgentId);

  const fields = [];
  const params = { id };
  if (data.firstName !== undefined) { fields.push('first_name = :firstName'); params.firstName = data.firstName; }
  if (data.lastName !== undefined) { fields.push('last_name = :lastName'); params.lastName = data.lastName; }
  if (data.email !== undefined) { fields.push('email = :email'); params.email = data.email; }
  if (data.profession !== undefined) { fields.push('profession = :profession'); params.profession = data.profession; }

  if (fields.length > 0) {
    await pool.query(`UPDATE renters SET ${fields.join(', ')} WHERE id = :id`, params);
  }
  return loadRenterWithActorsById(id);
}

/** Note interne libre ; renvoie la fiche mise à jour. */
async function updateRenterNotes(tenantId, userId, id, scopeAgentId, notes) {
  await assertRenterExists(pool, tenantId, id);
  await assertRenterInScope(tenantId, id, scopeAgentId);

  await pool.query(
    'UPDATE renters SET notes = :notes, notes_updated_by = :by, notes_updated_at = NOW() WHERE id = :id',
    { id, notes, by: userId },
  );
  return loadRenterWithActorsById(id);
}

/** (Ré)génère le lien secret du portail ; l'ancien est révoqué. Renvoie le token en clair. */
async function regeneratePortalLink(tenantId, id, scopeAgentId) {
  await assertRenterInScope(tenantId, id, scopeAgentId);

  const [renterRows] = await pool.query(
    'SELECT id, first_name, last_name, phone FROM renters WHERE id = :id AND tenant_id = :tenantId LIMIT 1',
    { id, tenantId },
  );
  if (!renterRows[0]) throw new ApiError(404, 'Locataire introuvable');

  const token = generatePortalToken();
  await pool.query('UPDATE renters SET portal_token_hash = :hash, portal_link_created_at = NOW() WHERE id = :id', {
    hash: hashToken(token),
    id,
  });
  return token;
}

module.exports = {
  listRenters,
  getRenterDetail,
  createRenter,
  createLease,
  updateRenter,
  updateRenterNotes,
  regeneratePortalLink,
};
