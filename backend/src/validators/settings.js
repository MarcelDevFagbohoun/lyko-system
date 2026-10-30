'use strict';

const { z } = require('zod');
const { ROLE_TITLE_PRESETS } = require('../constants/roles');
const { MAX_ACTIVITIES, MAX_ACTIVITY_LENGTH, normalizeActivities } = require('../utils/activities');
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
// Activités affichées dans l'en-tête des documents : tableau (ou JSON en multipart) de courtes phrases.
// Liste vide = aucune activité (NULL en base).
const activitiesField = z
  .preprocess((v) => {
    if (typeof v === 'string') {
      if (v.trim() === '') return [];
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }, z.array(z.string().trim().min(2, 'Activité trop courte').max(MAX_ACTIVITY_LENGTH, `Activité trop longue (${MAX_ACTIVITY_LENGTH} caractères max)`)).max(MAX_ACTIVITIES, `${MAX_ACTIVITIES} activités au maximum`))
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeActivities(v)));

const updateSettingsSchema = z.object({
  activities: activitiesField,
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

  // Module Charges (SONEB/SBEE) activé ou non pour l'entreprise.
  chargesEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),

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

  // Suppression du cachet/de la signature de l'entreprise, sans en retéléverser un autre (demande
  // utilisateur, 2026-10-30) : jusqu'ici, seul un remplacement était possible, aucun retrait. Ignoré si
  // un nouveau fichier est fourni pour le même champ dans la même requête (voir routes/settings.js).
  removeStamp: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  removeSignature: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
});

module.exports = { updateSettingsSchema };
