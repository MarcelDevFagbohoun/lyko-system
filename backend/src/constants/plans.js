'use strict';

/**
 * Catalogue des offres SaaS (voir SAAS_PLAN.md). Source de vérité UNIQUE : prix, limites et fonctions vivent ici,
 * versionnés avec le code. Le serveur ne fait jamais confiance à un montant ou à une offre envoyé par le client.
 *
 * Prix en gras du plan = fixés par la direction (Démarrage 15 000 / 25 000, Pro 65 000) ; les autres prix et limites
 * sont des propositions à ajuster ICI, sans migration.
 */

// Fonctions pouvant être réservées à une offre. `core` et `tenant_collect` sont dans toutes les offres.
const FEATURES = [
  'core', // biens, propriétaires, locataires, baux, loyers, charges, comptabilité simple, états des lieux…
  'tenant_collect', // paiement des loyers par les locataires via FedaPay
  'payroll', // fiches de paie et salaires
  'payouts', // paiements sortants FedaPay (salaires, reversements, paiements libres)
  'owner_portal', // portail propriétaire + relevé propriétaire
  'sale_properties', // biens à vendre
  'advanced_accounting', // comptabilité avancée SYSCOHADA
  'audit_full', // journal d'audit complet, support prioritaire (non verrouillé techniquement)
  'ai_assistant', // assistant IA — reporté, voir ASSISTANT_FEATURE_ENABLED
];

// `null` = illimité.
const PLANS = {
  demarrage: {
    key: 'demarrage',
    label: 'Démarrage',
    limits: { units: 50, owners: 10, users: 2 },
    features: ['core', 'tenant_collect'],
    offers: [
      { months: 1, price: 15000 },
      { months: 2, price: 25000 },
    ],
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    featured: true, // offre principale mise en avant
    limits: { units: 200, owners: 60, users: 8 },
    features: ['core', 'tenant_collect', 'payroll', 'payouts', 'owner_portal', 'sale_properties'],
    offers: [
      { months: 4, price: 65000 },
      { months: 12, price: 180000 },
    ],
  },
  entreprise: {
    key: 'entreprise',
    label: 'Entreprise',
    limits: { units: null, owners: null, users: 20 },
    features: ['core', 'tenant_collect', 'payroll', 'payouts', 'owner_portal', 'sale_properties', 'advanced_accounting', 'audit_full'],
    offers: [
      { months: 4, price: 180000 },
      { months: 12, price: 520000 },
    ],
  },
  // Entreprises existantes avant le SaaS (dont Cabinet M Conseils) : tout, sans limite, sans expiration.
  interne: {
    key: 'interne',
    label: 'Interne',
    limits: { units: null, owners: null, users: null },
    features: [...FEATURES.filter((f) => f !== 'ai_assistant'), 'ai_assistant'],
    offers: [],
  },
  // Abonnement partenaire : offert, durée et fonctions choisies une entreprise à la fois (colonnes partner_* de
  // tenant_subscriptions). Ce gabarit ne sert qu'à l'intitulé et au repli : les droits réels viennent de la ligne d'abonnement.
  partenaire: {
    key: 'partenaire',
    label: 'Partenaire',
    limits: { units: null, owners: null, users: null },
    features: ['core'],
    offers: [],
  },
};

// Fonctions qu'un administrateur peut cocher pour un partenaire (`core` toujours incluse ; l'assistant IA est reporté).
const PARTNER_SELECTABLE_FEATURES = FEATURES.filter((f) => f !== 'core' && f !== 'ai_assistant');

// Tarif fondateur : remise sur le PREMIER achat de l'offre Pro (4 mois) pour les N premières entreprises ; le prix
// normal revient au renouvellement. Appliqué côté serveur à l'étape facturation.
const FOUNDER_OFFER = { planKey: 'pro', months: 4, price: 49000, maxCompanies: 30 };

// Garantie : remboursement possible dans les 15 jours après le premier paiement (première souscription uniquement).
const REFUND_WINDOW_DAYS = 15;

const PLAN_KEYS = Object.keys(PLANS);

function getPlan(key) {
  return PLANS[key] ?? null;
}

module.exports = { FEATURES, PARTNER_SELECTABLE_FEATURES, PLANS, PLAN_KEYS, FOUNDER_OFFER, REFUND_WINDOW_DAYS, getPlan };
