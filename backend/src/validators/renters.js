'use strict';

const { z } = require('zod');
const { phoneSchema, nameSchema } = require('./auth');
const { INSPECTION_CONDITIONS } = require('../constants/inspection');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email invalide')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .nullable() // le front envoie `null` pour un champ optionnel vide (grilles d'état des lieux) — traité comme absent
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Mois invalide (AAAA-MM)');
// Borne haute (étape 12) : au-delà, `z.coerce.number()` laissait passer des
// valeurs qui débordaient la colonne SQL → 500. 1 Md FCFA = plafond large.
const amountSchema = z.coerce
  .number()
  .int('Montant entier requis')
  .nonnegative('Montant invalide')
  .max(1_000_000_000, 'Montant hors limite');

const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

// Création d'un locataire + son bail sur une Unité locative EXISTANTE (le
// Bien/l'Unité sont gérés depuis le module « Nos Biens » — voir routes/properties.js).
const createRenterSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  profession: optionalText(150),
  notes: optionalText(2000),

  unitId: z.coerce.number().int('Unité requise').positive('Unité requise'),
  // Loyer optionnel : reprend celui de l'unité si absent (mais ajustable au bail).
  monthlyRent: amountSchema.refine((v) => v > 0, 'Le loyer doit être supérieur à 0').optional(),
  depositAmount: amountSchema.default(0),
  rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
  startDate: dateSchema,
});

// Nouveau bail pour un locataire déjà existant (renouvellement / changement
// d'unité) — alimente l'historique des contrats.
const createLeaseSchema = z.object({
  unitId: z.coerce.number().int('Unité requise').positive('Unité requise'),
  monthlyRent: amountSchema.refine((v) => v > 0, 'Le loyer doit être supérieur à 0').optional(),
  depositAmount: amountSchema.default(0),
  rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
  startDate: dateSchema,
});

const updateRenterSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  email: emailSchema.optional(),
  profession: optionalText(150).optional(),
  notes: optionalText(2000).optional(),
});

const endLeaseSchema = z.object({
  endDate: dateSchema,
});

const createPaymentSchema = z.object({
  // Facultatif : par défaut le serveur part du prochain mois dû. Si fourni, sert
  // de mois de départ (utile pour régler un mois précis en avance).
  coversMonth: monthSchema.optional(),
  // Peut dépasser un mois de loyer : le serveur répartit sur des mois
  // consécutifs (mois entiers + reste en paiement partiel), une quittance par mois.
  amount: amountSchema.refine((v) => v > 0, 'Le montant doit être supérieur à 0'),
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de paiement invalide' }) }),
  paidAt: dateSchema,
  notes: optionalText(255),
});

const inspectionItemSchema = z.object({
  label: z.string().trim().min(1).max(150),
  condition: z.enum(INSPECTION_CONDITIONS, { errorMap: () => ({ message: 'État invalide' }) }),
  comment: optionalText(255),
});

const createMoveInReportSchema = z.object({
  conductedAt: dateSchema,
  items: z.array(inspectionItemSchema).min(1, 'Au moins un poste requis'),
  generalNotes: optionalText(2000),
});

// État des lieux de sortie : même grille que l'entrée, avec en plus une
// retenue chiffrée par poste (dégradation imputable au locataire, sur la
// caution) — section 6 (Sorties de locataires).
const moveOutItemSchema = z.object({
  label: z.string().trim().min(1).max(150),
  condition: z.enum(INSPECTION_CONDITIONS, { errorMap: () => ({ message: 'État invalide' }) }),
  comment: optionalText(255),
  deduction: amountSchema.default(0),
});

const createMoveOutReportSchema = z.object({
  conductedAt: dateSchema,
  items: z.array(moveOutItemSchema).min(1, 'Au moins un poste requis'),
  generalNotes: optionalText(2000),
  // Retenue libre optionnelle (arriérés de loyer, factures SONEB/SBEE...) —
  // distincte de la grille de dégradations, qui ne porte que sur l'état du bien.
  otherDeductionsAmount: amountSchema.default(0),
  otherDeductionsNote: optionalText(255),
});

module.exports = {
  createRenterSchema,
  updateRenterSchema,
  createLeaseSchema,
  endLeaseSchema,
  createPaymentSchema,
  createMoveInReportSchema,
  createMoveOutReportSchema,
  PAYMENT_METHODS,
};
