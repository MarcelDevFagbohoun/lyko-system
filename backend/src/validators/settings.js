'use strict';

const { z } = require('zod');
const { ROLE_TITLE_PRESETS } = require('../constants/roles');

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
  // 50000 caractères : très large marge pour un contrat de bail complet
  // rédigé par N'IMPORTE QUELLE entreprise cliente, pas seulement le court
  // paragraphe d'attestation par défaut. La colonne est `MEDIUMTEXT`
  // (jusqu'à 16 Mo, migration 024) : cette limite est purement une garde-
  // fou raisonnable côté formulaire, jamais une contrainte technique de la
  // base qui pourrait resurgir plus tard.
  contractTemplate: z
    .string()
    .trim()
    .max(50000, 'Trop long (50 000 caractères max)')
    .optional()
    .or(z.literal(''))
    // Un texte collé depuis Word/Google Docs porte souvent des fins de ligne
    // "\r\n" : PDFKit les dessine comme un caractère visible (glyphe « Ð »)
    // au lieu d'un simple retour à la ligne. Normalisé dès l'enregistrement
    // pour que la valeur stockée soit déjà propre (en plus du filet de
    // sécurité côté génération PDF, `services/pdf.js`).
    .transform((v) => (v ? v.replace(/\r\n?/g, '\n') : null)),

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
});

module.exports = { updateSettingsSchema };
