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

  // Paiement en ligne (KKiaPay) — désactivé par défaut, chaque entreprise
  // choisit. Clé publique : texte visible (embarquée côté client), envoyée
  // même vide (transformée en NULL) pour permettre de l'effacer. Clé
  // privée/secrète : écriture seule, un champ vide/absent NE modifie PAS la
  // valeur déjà stockée (voir routes/settings.js — sinon rouvrir la page
  // Réglages sans rien taper effacerait les clés à chaque sauvegarde).
  kkiapayEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  kkiapaySandbox: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  kkiapayPublicKey: z
    .string()
    .trim()
    .max(255)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === undefined ? undefined : v || null)),
  kkiapayPrivateKey: z.string().trim().max(255).optional().or(z.literal('')),
  kkiapaySecretKey: z.string().trim().max(255).optional().or(z.literal('')),

  // Convention de paiement du loyer par défaut (avance/terme échu) — pré-
  // remplit chaque nouveau bail (demande directe de l'utilisateur, 2026-09-24).
  defaultRentTiming: z.enum(RENT_TIMING_KEYS, { errorMap: () => ({ message: 'Convention de paiement invalide' }) }).optional(),

  // Prorata d'entrée par défaut (étape 42, demande directe de l'utilisateur, 2026-09-28) — pré-rempli
  // à la création d'un bail, ajustable bail par bail. Défaut 'aucun' (comportement historique inchangé).
  defaultEntryProration: z.enum(['aucun', 'prorata'], { errorMap: () => ({ message: "Choix du prorata d'entrée par défaut invalide" }) }).optional(),

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
