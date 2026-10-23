'use strict';

const { z } = require('zod');
const { ROLE_TITLE_PRESETS } = require('../constants/roles');
const { RENT_TIMING_KEYS } = require('../constants/rentTiming');

// Menu déroulant fermé (jamais de champ libre) : seules les propositions de
// `ROLE_TITLE_PRESETS` sont acceptées — ce nom est affiché partout, y
// compris au sélecteur de poste à la connexion employé.
const roleTitleField = (role) =>
  z
    .enum(ROLE_TITLE_PRESETS[role])
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null);

// Chaîne vide envoyée volontairement = réinitialiser au modèle par défaut (NULL en base).
const updateSettingsSchema = z.object({
  dgTitle: roleTitleField('dg'),
  comptableTitle: roleTitleField('comptable'),
  agentTitle: roleTitleField('agent'),

  // Envoi d'argent (FedaPay Payouts) — désactivé par défaut. Clé secrète : écriture seule (jamais renvoyée).
  // Plafonds : par paiement et par jour, en FCFA.
  fedapayEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  fedapaySandbox: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  fedapayCollectEnabled: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  fedapayWebhookSecret: z.string().trim().max(255).optional().or(z.literal('')),
  fedapaySecretKey: z.string().trim().max(255).optional().or(z.literal('')),
  paymentsPerOrderLimit: z.coerce.number().int().min(1000).max(100_000_000).optional(),
  paymentsDailyLimit: z.coerce.number().int().min(1000).max(1_000_000_000).optional(),

  // Convention de paiement du loyer par défaut (avance/terme échu) — pré-
  // remplit chaque nouveau bail (demande directe de l'utilisateur, 2026-09-24).
  defaultRentTiming: z.enum(RENT_TIMING_KEYS, { errorMap: () => ({ message: 'Convention de paiement invalide' }) }).optional(),

  // Prorata d'entrée par défaut (étape 42, demande directe de l'utilisateur, 2026-09-28) — pré-rempli
  // à la création d'un bail, ajustable bail par bail. Défaut 'aucun' (comportement historique inchangé).
  defaultEntryProration: z.enum(['aucun', 'prorata'], { errorMap: () => ({ message: "Choix du prorata d'entrée par défaut invalide" }) }).optional(),

  // Charges SONEB/SBEE : part répercutée au locataire (le reste est gardé par l'entreprise comme frais de gestion).
  utilityPassThroughPercent: z.coerce.number().int().min(0).max(100).optional(),
  // Moment où la commission de l'entreprise est constatée : à l'encaissement du loyer ou au reversement au propriétaire.
  commissionTiming: z.enum(['encaissement', 'reversement'], { errorMap: () => ({ message: 'Moment de commission invalide' }) }).optional(),
  // Seuil d'alerte sur les grosses dépenses (FCFA). Chaîne vide = pas d'alerte.
  expenseAlertThreshold: z.preprocess((v) => (v === '' || v === 'null' ? null : v), z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional()),

  // Cautions supplémentaires (étape 43, demande directe de l'utilisateur, 2026-09-28) — SBEE/SONEB/
  // peinture, chacune optionnelle et désactivée par défaut (voir constants/leaseDeposits.js).
  depositSbeeEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  depositSonebEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  depositPeintureEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
});

module.exports = { updateSettingsSchema };
