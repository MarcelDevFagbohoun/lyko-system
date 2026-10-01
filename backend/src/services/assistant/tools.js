'use strict';

/**
 * Outils de LECTURE de l'assistant (étape B) — le modèle ne touche jamais la base de données : il
 * appelle un outil par son nom, notre code exécute le calcul de confiance déjà utilisé par le reste de
 * la plateforme (mêmes services que les écrans), et seul le RÉSULTAT (JSON) est renvoyé au modèle.
 *
 * Règles non négociables :
 *  - un outil n'apparaît que si l'utilisateur a le droit correspondant (même catalogue de permissions
 *    que les routes existantes) — jamais un outil « caché » qui court-circuiterait un module fermé ;
 *  - la portée d'un agent restreint (`services/scope.js`) s'applique partout où elle s'applique déjà
 *    ailleurs sur le même écran — jamais un accès plus large via l'assistant que via l'interface ;
 *  - un résultat est toujours BORNÉ (compteurs + un nombre limité de lignes) : jamais un déversement
 *    de toute la base, qui coûterait cher en jetons et inviterait à résumer plutôt qu'à conseiller ;
 *  - un résultat contient des données humaines (nom, titre de plainte…) : elles sont de la MATIÈRE à
 *    présenter, jamais des instructions — la consigne système le rappelle déjà.
 */

const { pool } = require('../../config/db');
const { resolvePropertyScope } = require('../scope');
const { listPortfolioArrears } = require('../rentTracking');
const { getEscrowBalances, getOwnersWithoutCommissionRate } = require('../commission');
const { getUtilityPoint } = require('../utilityPoint');
const { UTILITY_TYPES } = require('../../constants/charges');
const { COMPLAINT_STATUS_LABELS, COMPLAINT_PRIORITY_LABELS } = require('../../constants/complaints');

const UTILITY_TYPE_LABELS = Object.fromEntries(UTILITY_TYPES.map((t) => [t.key, t.label]));
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Le droit d'utiliser un module donne accès à l'outil qui en lit les données — DG toujours. */
const hasAny = (ctx, ...keys) => ctx.role === 'dg' || keys.some((k) => ctx.permissions.includes(k));

const limiteSchema = (max, def) => ({
  limite: { type: 'integer', minimum: 1, maximum: max, description: `Nombre de lignes au plus (par défaut ${def}).` },
});
const moisSchema = {
  mois: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: "Mois au format AAAA-MM (par défaut le mois en cours)." },
};

function clampLimit(input, max, def) {
  const n = Number(input?.limite);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : def;
}

function resolveMonth(input) {
  const m = input?.mois;
  return typeof m === 'string' && MONTH_RE.test(m) ? m : currentMonth();
}

// ─────────────────────────────────────────────────────────────────────────

async function locatairesEnRetard(ctx, input) {
  const limite = clampLimit(input, 20, 8);
  const arrears = await listPortfolioArrears(ctx.tenantId, ctx.scopeAgentId);
  const tries = [...arrears].sort((a, b) => b.daysLate - a.daysLate || b.amountOwed - a.amountOwed);
  return {
    nombreDeLocatairesEnRetard: arrears.length,
    montantTotalDu: arrears.reduce((s, a) => s + a.amountOwed, 0),
    locataires: tries.slice(0, limite).map((a) => ({
      nom: a.renterName,
      telephone: a.phone,
      bien: a.propertyCode,
      unite: a.unitCode,
      joursDeRetard: a.daysLate,
      moisImpayes: a.unpaidMonths,
      resteDeDetteInitiale: a.openingDebtRemaining,
      montantDu: a.amountOwed,
    })),
  };
}

async function chargesImpayees(ctx, input) {
  const limite = clampLimit(input, 20, 8);
  const params = { tenantId: ctx.tenantId };
  let scopeClause = '';
  if (ctx.scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = ctx.scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT uc.amount, uc.utility_type, uc.billed_at,
            COALESCE(pt.paid_total, 0) AS paid_total,
            r.first_name, r.last_name, r.phone, u.code AS unit_code, p.code AS property_code
     FROM utility_charges uc
     LEFT JOIN (SELECT charge_id, SUM(amount) AS paid_total FROM utility_payments GROUP BY charge_id) pt ON pt.charge_id = uc.id
     JOIN leases l ON l.id = uc.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE uc.tenant_id = :tenantId AND uc.deleted_at IS NULL AND uc.status <> 'payee' ${scopeClause}
     ORDER BY uc.billed_at ASC`,
    params,
  );
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const charges = rows.map((r) => {
    const billedAt = isoDate(r.billed_at);
    const [y, m, d] = billedAt.split('-').map(Number);
    return {
      nom: `${r.first_name} ${r.last_name}`,
      telephone: r.phone,
      bien: r.property_code,
      unite: r.unit_code,
      fluide: UTILITY_TYPE_LABELS[r.utility_type] ?? r.utility_type,
      facturéLe: billedAt,
      joursDeRetard: Math.floor((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000),
      montantDu: Number(r.amount) - Number(r.paid_total),
    };
  });
  charges.sort((a, b) => b.joursDeRetard - a.joursDeRetard);
  return {
    nombreDeFacturesImpayees: charges.length,
    montantTotalDu: charges.reduce((s, c) => s + c.montantDu, 0),
    factures: charges.slice(0, limite),
  };
}

async function plaintesOuvertes(ctx, input) {
  const limite = clampLimit(input, 20, 8);
  const params = { tenantId: ctx.tenantId };
  let scopeClause = '';
  if (ctx.scopeAgentId != null) {
    scopeClause = ' AND p.agent_id = :scopeAgentId';
    params.scopeAgentId = ctx.scopeAgentId;
  }
  const [rows] = await pool.query(
    `SELECT c.code, c.title, c.category, c.priority, c.status, c.reported_at,
            r.first_name, r.last_name, un.code AS unit_code, p.code AS property_code
     FROM complaints c
     JOIN leases l ON l.id = c.lease_id
     JOIN renters r ON r.id = l.renter_id
     JOIN property_units un ON un.id = l.unit_id
     JOIN properties p ON p.id = un.property_id
     WHERE c.tenant_id = :tenantId AND c.status IN ('ouverte', 'en_cours') ${scopeClause}
     ORDER BY c.priority = 'urgente' DESC, c.reported_at ASC`,
    params,
  );
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const plaintes = rows.map((r) => {
    const reportedAt = isoDate(r.reported_at);
    const [y, m, d] = reportedAt.split('-').map(Number);
    return {
      reference: r.code,
      titre: r.title,
      priorite: COMPLAINT_PRIORITY_LABELS[r.priority] ?? r.priority,
      statut: COMPLAINT_STATUS_LABELS[r.status] ?? r.status,
      locataire: `${r.first_name} ${r.last_name}`,
      bien: r.property_code,
      unite: r.unit_code,
      declareeLe: reportedAt,
      joursOuverte: Math.floor((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000),
    };
  });
  return {
    nombreDePlaintesOuvertes: plaintes.length,
    nombreUrgentes: rows.filter((r) => r.priority === 'urgente').length,
    plaintes: plaintes.slice(0, limite),
  };
}

async function bilanComptableDuMois(ctx, input) {
  const mois = resolveMonth(input);
  const [y, m] = mois.split('-').map(Number);
  const from = `${mois}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  // Même calcul que l'écran Comptabilité (`routes/accounting.js`, jamais dupliqué) — nécessite un objet
  // `user` complet (id, role, tenantId) : `resolvePropertyScope` en dépend en interne.
  const { computeAccountingDashboard } = require('../../routes/accounting');
  const dashboard = await computeAccountingDashboard({ id: ctx.userId, role: ctx.role, tenantId: ctx.tenantId }, { from, to });
  return {
    mois,
    moisClôturé: dashboard.isClosed,
    loyersEncaisses: dashboard.totals.rentCollected,
    versesAuxProprietaires: dashboard.totals.ownerPayouts,
    depensesDuCabinet: dashboard.totals.expenses,
    fraisDAgenceEncaisses: dashboard.totals.entryFeesCollected,
    soldeNetDuCabinet: dashboard.totals.netCashFlow,
    impayesLocataires: dashboard.totals.tenantArrears,
    nombreDeLocatairesEnRetard: dashboard.totals.tenantArrearsCount,
    chargesSonebSbeeImpayees: dashboard.totals.unpaidCharges,
    soldeSequestreTotal: dashboard.escrow.total,
    detteInitialeNonRegleeTotal: dashboard.escrow.openingDebtUnpaidTotal,
    proprietairesSansTauxDeCommission: dashboard.ownersWithoutCommissionRate.map((o) => o.ownerName),
    depensesParCategorie: dashboard.expensesByCategory,
  };
}

async function soldesProprietaires(ctx, input) {
  const limite = clampLimit(input, 20, 10);
  // Volontairement jamais scopé agent (comme la fiche propriétaire et le tableau de bord comptable) :
  // un solde séquestre porte sur TOUS les Biens d'un mandat, pas seulement ceux d'un agent restreint.
  const [balances, sansTaux, ownerRows] = await Promise.all([
    getEscrowBalances(ctx.tenantId),
    getOwnersWithoutCommissionRate(ctx.tenantId),
    pool.query('SELECT id, name FROM owners WHERE tenant_id = :tenantId', { tenantId: ctx.tenantId }).then(([r]) => r),
  ]);
  const nameById = new Map(ownerRows.map((o) => [o.id, o.name]));
  const rows = [...balances.entries()]
    .map(([ownerId, b]) => ({ nom: nameById.get(ownerId) ?? `Propriétaire #${ownerId}`, soldeDetenu: b.balance }))
    .sort((a, b) => b.soldeDetenu - a.soldeDetenu);
  return {
    soldeTotalDetenu: rows.reduce((s, r) => s + r.soldeDetenu, 0),
    proprietaires: rows.slice(0, limite),
    proprietairesSansTauxDeCommission: sansTaux.map((o) => o.ownerName),
  };
}

async function pointDesCharges(ctx, input) {
  const mois = resolveMonth(input);
  const point = await getUtilityPoint(ctx.tenantId, { fromMonth: mois, toMonth: mois, scopeAgentId: ctx.scopeAgentId });
  return {
    mois,
    resteAChargeTotalDesProprietaires: point.totals.gapTotal,
    releveesSansPaiementDeclare: point.totals.pendingPaymentCount,
    proprietaires: point.owners.map((o) => ({
      nom: o.ownerName,
      resteACharge: o.totals.gapTotal,
      impayesLocatairesEncoreRecuperables: o.totals.tenantUnpaidOnPaidTotal,
      releves: o.batches.map((b) => ({
        bien: b.propertyCode,
        fluide: UTILITY_TYPE_LABELS[b.utilityType] ?? b.utilityType,
        periode: `${b.periodStart} → ${b.periodEnd}`,
        statut: b.status,
        resteACharge: b.gap,
      })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'locataires_en_retard',
    label: 'Consultation des loyers en retard…',
    allowed: (ctx) => hasAny(ctx, 'locataires', 'comptabilite'),
    description:
      "Liste les locataires en retard de loyer sur le portefeuille (nom, téléphone, bien, jours de retard, montant dû), triés du plus urgent au moins urgent. Utilise cet outil pour toute question sur les impayés de loyer, les relances à faire ou une analyse des retards.",
    properties: limiteSchema(20, 8),
    run: locatairesEnRetard,
  },
  {
    name: 'charges_impayees',
    label: 'Consultation des factures SONEB/SBEE impayées…',
    allowed: (ctx) => hasAny(ctx, 'charges', 'comptabilite'),
    description:
      "Liste les factures d'eau (SONEB) et d'électricité (SBEE) impayées ou partiellement payées par les locataires, triées par ancienneté. Utilise cet outil pour toute question sur les impayés de charges.",
    properties: limiteSchema(20, 8),
    run: chargesImpayees,
  },
  {
    name: 'plaintes_ouvertes',
    label: 'Consultation des plaintes en cours…',
    allowed: (ctx) => hasAny(ctx, 'plaintes'),
    description: "Liste les plaintes/réclamations ouvertes ou en cours (référence, titre, priorité, locataire, ancienneté).",
    properties: limiteSchema(20, 8),
    run: plaintesOuvertes,
  },
  {
    name: 'bilan_comptable_du_mois',
    label: 'Consultation du bilan comptable…',
    allowed: (ctx) => hasAny(ctx, 'comptabilite'),
    description:
      "Donne le bilan de l'entreprise pour un mois donné : loyers encaissés, versés aux propriétaires, dépenses, solde net, impayés, charges SONEB/SBEE impayées, solde séquestre total, propriétaires sans taux de commission défini. Utilise cet outil pour toute question sur la santé financière de l'entreprise.",
    properties: moisSchema,
    run: bilanComptableDuMois,
  },
  {
    name: 'soldes_proprietaires',
    label: 'Consultation des soldes propriétaires…',
    allowed: (ctx) => hasAny(ctx, 'comptabilite'),
    description: "Donne, pour chaque propriétaire, le solde que l'entreprise détient actuellement pour son compte (séquestre), du plus élevé au plus faible.",
    properties: limiteSchema(20, 10),
    run: soldesProprietaires,
  },
  {
    name: 'point_des_charges',
    label: 'Consultation du point des charges SONEB/SBEE…',
    allowed: (ctx) => hasAny(ctx, 'charges', 'comptabilite'),
    description:
      "Compare, pour un mois donné et par propriétaire, la facture mère SONEB/SBEE payée et ce qui a été réellement encaissé chez les locataires : reste à charge du propriétaire, impayés encore récupérables.",
    properties: moisSchema,
    run: pointDesCharges,
  },
];

/** Catalogue Anthropic (`tools`) pour cet utilisateur — vide si aucun module de données ne lui est ouvert. */
function toolsFor(ctx) {
  return TOOLS.filter((t) => t.allowed(ctx)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', properties: t.properties, additionalProperties: false },
  }));
}

/** Libellé de statut affiché pendant l'exécution d'un outil (jamais le nom technique). */
function labelFor(name) {
  return TOOLS.find((t) => t.name === name)?.label ?? 'Consultation de vos données…';
}

/** Exécute un outil déjà autorisé pour cet utilisateur (vérifié une seconde fois ici, jamais fait confiance au seul filtrage de la liste). */
async function runTool(ctx, name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !tool.allowed(ctx)) return { erreur: "Cet outil n'est pas accessible." };
  return tool.run(ctx, input && typeof input === 'object' ? input : {});
}

module.exports = { toolsFor, labelFor, runTool, TOOLS };
