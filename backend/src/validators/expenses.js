'use strict';

const { z } = require('zod');
const { EXPENSE_CATEGORY_KEYS, EXPENSE_PAYMENT_METHODS } = require('../constants/expenses');

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'Trop long')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const amountSchema = z.coerce
  .number()
  .int('Montant entier requis')
  .positive('Le montant doit être supérieur à 0')
  .max(1_000_000_000, 'Montant hors limite'); // borne haute (étape 12) : évite le débordement SQL → 500

// `propertyId`/`unitId` sont facultatifs : une dépense de fonctionnement du
// cabinet (loyer bureau, salaires...) n'en a pas, comme avant. Une dépense
// rattachée à un Bien (réparation, facture) réduit sa recette nette pour le
// calcul de commission — `unitId` en plus si elle vise une Unité précise.
//
// `paymentStatus` ("payée" par défaut, comportement historique inchangé) :
// "à crédit" exige un fournisseur (nom, créé à la volée si nouveau) et
// REFUSE un mode de règlement (rien n'est encore payé) ; "payée" exige
// l'inverse. Jamais les deux définis en même temps — cf. `superRefine`.
const createExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }),
    label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long'),
    amount: amountSchema,
    expenseDate: dateSchema,
    paymentStatus: z.enum(['paid', 'unpaid']).default('paid'),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }).optional(),
    supplierName: z.string().trim().min(2, 'Nom du fournisseur requis').max(150, 'Trop long').optional(),
    notes: optionalText(255),
    propertyId: z.coerce.number().int().positive().optional(),
    unitId: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentStatus === 'paid' && !data.paymentMethod) {
      ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Mode de règlement requis' });
    }
    if (data.paymentStatus === 'unpaid' && !data.supplierName) {
      ctx.addIssue({ code: 'custom', path: ['supplierName'], message: 'Fournisseur requis pour une dépense à crédit' });
    }
    // Un salaire dû relève d'un compte de personnel (422), pas d'un compte
    // fournisseur (401) — traitement distinct, hors périmètre de "à crédit".
    if (data.paymentStatus === 'unpaid' && data.category === 'salaires') {
      ctx.addIssue({ code: 'custom', path: ['category'], message: "Un salaire ne peut pas être enregistré à crédit" });
    }
  });

const paySupplierExpenseSchema = z.object({
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }),
  paidAt: dateSchema,
});

const updateExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }).optional(),
  label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long').optional(),
  amount: amountSchema.optional(),
  expenseDate: dateSchema.optional(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }).optional(),
  notes: optionalText(255).optional(),
});

const dashboardQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
});

// `force` : le DG confirme vouloir clôturer avant que le mois ne soit
// automatiquement « clôturable » (échéance la plus tardive des baux actifs +
// marge de sécurité pas encore passée) — sans ce drapeau, la clôture
// anticipée est refusée explicitement (409) pour que le frontend affiche
// l'avertissement avant toute confirmation.
const closePeriodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Période invalide (AAAA-MM)'),
  force: z.coerce.boolean().optional().default(false),
});

// Date de démarrage de la comptabilité : `null` explicite retire la
// restriction (comptabilité ouverte "depuis toujours").
const startDateSchema = z.object({
  startDate: dateSchema.nullable(),
});

// Suppression = suppression logique (traçabilité) : une justification est
// systématiquement exigée, quel que soit le rôle de qui supprime.
const deleteReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Justification requise (5 caractères minimum)').max(255, 'Trop long'),
});

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
  paySupplierExpenseSchema,
  dashboardQuerySchema,
  closePeriodSchema,
  deleteReasonSchema,
  startDateSchema,
};
