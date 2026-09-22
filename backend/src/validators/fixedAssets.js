'use strict';

const { z } = require('zod');
const { FIXED_ASSET_CATEGORY_KEYS } = require('../constants/fixedAssets');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
const amountSchema = z.coerce.number().int('Montant entier requis').positive('Le montant doit être supérieur à 0').max(1_000_000_000, 'Montant hors limite');
const PAYMENT_METHODS = ['especes', 'mobile_money', 'virement', 'cheque'];

// Même principe "à crédit" que les dépenses (validators/expenses.js) :
// `paymentStatus` "paid" par défaut, exige `paymentMethod` ; "unpaid" exige
// `supplierName` et interdit `paymentMethod`.
const createFixedAssetSchema = z
  .object({
    label: z.string().trim().min(2, 'Libellé requis').max(150, 'Trop long'),
    category: z.enum(FIXED_ASSET_CATEGORY_KEYS, { errorMap: () => ({ message: 'Catégorie invalide' }) }),
    acquisitionDate: dateSchema,
    acquisitionCost: amountSchema,
    // Durée d'amortissement linéaire — bornes larges mais raisonnables pour
    // du matériel (jamais 0, jamais un siècle).
    usefulLifeYears: z.coerce.number().int().min(1).max(30),
    paymentStatus: z.enum(['paid', 'unpaid']).default('paid'),
    paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }).optional(),
    supplierName: z.string().trim().min(2, 'Nom du fournisseur requis').max(150, 'Trop long').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentStatus === 'paid' && !data.paymentMethod) {
      ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Mode de règlement requis' });
    }
    if (data.paymentStatus === 'unpaid' && !data.supplierName) {
      ctx.addIssue({ code: 'custom', path: ['supplierName'], message: 'Fournisseur requis pour un achat à crédit' });
    }
  });

const payFixedAssetSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Mode de règlement invalide' }) }),
  paidAt: dateSchema,
});

// Un mois précis (AAAA-MM), jamais une date — l'amortissement se comptabilise
// par MOIS ENTIER (voir migration 049 : une ligne par mois par immobilisation).
const depreciateFixedAssetSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Mois invalide (AAAA-MM)'),
});

module.exports = {
  createFixedAssetSchema,
  payFixedAssetSchema,
  depreciateFixedAssetSchema,
};
