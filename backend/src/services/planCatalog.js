'use strict';

/**
 * Catalogue EFFECTIF des offres = valeurs par défaut du code (constants/plans.js) + surcharges enregistrées par
 * l'administrateur (table catalog_settings). Tout le reste du code lit le catalogue ICI, jamais directement le fichier.
 *
 * Règles : un changement de PRIX ne touche que les achats futurs (le montant payé est figé sur chaque paiement) ;
 * un changement de LIMITES ou de FONCTIONS s'applique tout de suite à toutes les entreprises de l'offre, sans effacer
 * l'existant (une limite abaissée ne supprime rien, elle empêche seulement d'en créer de nouveaux).
 * Cache de 10 s par processus : en cas de plusieurs processus, un changement peut mettre jusqu'à 10 s à apparaître.
 */
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { PLANS, FEATURES, FOUNDER_OFFER, REFUND_WINDOW_DAYS } = require('../constants/plans');

const EDITABLE = ['demarrage', 'pro', 'entreprise'];
const ALWAYS_ON = ['core', 'tenant_collect'];
const CACHE_MS = 10_000;
let cache = null;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function defaults() {
  const plans = {};
  for (const k of EDITABLE) {
    const p = PLANS[k];
    plans[k] = { key: k, label: p.label, featured: !!p.featured, limits: clone(p.limits), features: [...p.features], offers: clone(p.offers) };
  }
  return { plans, founder: { enabled: true, ...clone(FOUNDER_OFFER) }, refundWindowDays: REFUND_WINDOW_DAYS };
}

function merge(base, over) {
  const out = clone(base);
  if (!over || typeof over !== 'object') return out;
  for (const k of EDITABLE) {
    const o = over.plans?.[k];
    if (!o) continue;
    for (const f of ['label', 'featured', 'limits', 'features', 'offers']) if (o[f] !== undefined) out.plans[k][f] = clone(o[f]);
  }
  if (over.founder) out.founder = { ...out.founder, ...over.founder };
  if (over.refundWindowDays !== undefined) out.refundWindowDays = over.refundWindowDays;
  return out;
}

async function loadStored(conn = pool) {
  const [[row]] = await conn.query('SELECT data FROM catalog_settings WHERE id = 1');
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

async function getCatalog() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = merge(defaults(), await loadStored());
  cache = { at: Date.now(), value };
  return value;
}
function invalidate() { cache = null; }

/** Une offre du catalogue effectif ; « interne » vient toujours du code (accès complet, non modifiable). */
async function getPlanAsync(key) {
  if (key === 'interne') return PLANS.interne;
  const c = await getCatalog();
  return c.plans[key] ?? null;
}

function intIn(v, min, max, label) {
  if (!Number.isInteger(v) || v < min || v > max) throw new ApiError(400, `${label} invalide`);
  return v;
}

/** Valide un catalogue COMPLET (le back-office envoie toujours l'ensemble). */
function validate(input) {
  if (!input || typeof input !== 'object') throw new ApiError(400, 'Catalogue invalide');
  const out = { plans: {}, founder: null, refundWindowDays: 0 };
  for (const k of EDITABLE) {
    const p = input.plans?.[k];
    if (!p) throw new ApiError(400, `Offre « ${k} » manquante`);
    const label = String(p.label ?? '').trim();
    if (label.length < 2 || label.length > 40) throw new ApiError(400, `Nom de l'offre « ${k} » invalide`);
    const limits = {};
    for (const l of ['units', 'owners', 'users']) {
      const v = p.limits?.[l];
      limits[l] = v === null || v === undefined ? null : intIn(v, 1, 1_000_000, `Limite ${l} de ${label}`);
    }
    const features = [...new Set(p.features ?? [])];
    if (features.some((f) => !FEATURES.includes(f) || f === 'ai_assistant')) throw new ApiError(400, `Fonction inconnue dans ${label}`);
    for (const f of ALWAYS_ON) if (!features.includes(f)) throw new ApiError(400, `${label} doit inclure les fonctions de base`);
    if (!Array.isArray(p.offers) || p.offers.length < 1 || p.offers.length > 6) throw new ApiError(400, `${label} : 1 à 6 durées`);
    const seen = new Set();
    const offers = p.offers.map((o) => {
      const months = intIn(o.months, 1, 36, `Durée de ${label}`);
      if (seen.has(months)) throw new ApiError(400, `${label} : durée en double`);
      seen.add(months);
      return { months, price: intIn(o.price, 1000, 10_000_000, `Prix de ${label}`) };
    }).sort((a, b) => a.months - b.months);
    out.plans[k] = { key: k, label, featured: !!p.featured, limits, features, offers };
  }
  if (Object.values(out.plans).filter((p) => p.featured).length > 1) throw new ApiError(400, 'Une seule offre peut être recommandée');
  const f = input.founder ?? {};
  if (f.enabled) {
    const plan = out.plans[f.planKey];
    if (!plan) throw new ApiError(400, 'Offre du tarif fondateur invalide');
    const offer = plan.offers.find((o) => o.months === f.months);
    if (!offer) throw new ApiError(400, 'Le tarif fondateur doit porter sur une durée existante de cette offre');
    const price = intIn(f.price, 1000, 10_000_000, 'Prix fondateur');
    if (price >= offer.price) throw new ApiError(400, 'Le prix fondateur doit être inférieur au prix normal');
    out.founder = { enabled: true, planKey: f.planKey, months: f.months, price, maxCompanies: intIn(f.maxCompanies, 1, 100000, 'Nombre de places') };
  } else {
    out.founder = { ...defaults().founder, ...(f.planKey ? { planKey: f.planKey } : {}), enabled: false };
  }
  out.refundWindowDays = intIn(input.refundWindowDays, 0, 90, 'Délai de remboursement');
  return out;
}

async function saveCatalog(adminId, input) {
  const next = validate(input);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = await loadStored(conn);
    const json = JSON.stringify(next);
    await conn.query('INSERT INTO catalog_settings (id, data, updated_by) VALUES (1, :d, :a) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by)', { d: json, a: adminId });
    await conn.query('INSERT INTO catalog_changes (admin_id, before_data, after_data) VALUES (:a, :b, :n)', { a: adminId, b: before ? JSON.stringify(before) : null, n: json });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  invalidate();
  return getCatalog();
}

async function resetCatalog(adminId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = await loadStored(conn);
    await conn.query('DELETE FROM catalog_settings WHERE id = 1');
    await conn.query('INSERT INTO catalog_changes (admin_id, before_data, after_data) VALUES (:a, :b, :n)', { a: adminId, b: before ? JSON.stringify(before) : null, n: JSON.stringify({ reset: true }) });
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  invalidate();
  return getCatalog();
}

async function listChanges() {
  const [rows] = await pool.query('SELECT c.id, c.admin_id, a.name AS admin_name, c.created_at FROM catalog_changes c LEFT JOIN platform_admins a ON a.id = c.admin_id ORDER BY c.id DESC LIMIT 30');
  return rows.map((r) => ({ id: r.id, adminName: r.admin_name, createdAt: r.created_at }));
}

module.exports = { getCatalog, getPlanAsync, saveCatalog, resetCatalog, listChanges, invalidate, FEATURES };
