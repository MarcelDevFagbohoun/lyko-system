'use strict';

const { z } = require('zod');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const amountSchema = z.coerce
  .number()
  .int('Montant entier requis')
  .positive('Le montant doit être supérieur à 0')
  .max(1_000_000_000, 'Montant hors limite');

// Saisie manuelle d'une écriture diverse (espace Comptabilité avancée) : le
// comptable choisit directement les comptes/tiers, contrairement aux
// formulaires simples qui passent par `gl_posting_rules`. Au moins 2 lignes,
// l'équilibre débit/crédit est revérifié côté serveur (jamais fait confiance
// au total envoyé par le client).
const manualEntryLineSchema = z.object({
  accountId: z.coerce.number().int().positive('Compte requis'),
  thirdPartyId: z.coerce.number().int().positive().optional(),
  side: z.enum(['debit', 'credit'], { errorMap: () => ({ message: 'Sens invalide' }) }),
  amount: amountSchema,
});

const createManualEntrySchema = z.object({
  journalId: z.coerce.number().int().positive('Journal requis'),
  entryDate: dateSchema,
  narration: z.string().trim().min(3, 'Libellé requis').max(255, 'Trop long'),
  lines: z.array(manualEntryLineSchema).min(2, 'Une écriture nécessite au moins 2 lignes').max(50, 'Trop de lignes (50 maximum)'),
});

const extourneSchema = z.object({
  entryDate: dateSchema,
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

module.exports = { createManualEntrySchema, extourneSchema, dateSchema, amountSchema };
