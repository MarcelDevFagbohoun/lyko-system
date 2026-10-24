'use strict';

const { z } = require('zod');

const itsBracket = z.object({
  upTo: z.number().min(0).nullable(),
  rate: z.number().min(0).max(100),
});

// Tous les champs optionnels : PATCH partiel. Voir routes/gl/glSettings.js.
const updateGlSettingsSchema = z.object({
  depreciationProrataTemporis: z.coerce.boolean().optional(),
  irfEnabled: z.coerce.boolean().optional(),
  irfRate: z.coerce.number().int().min(0).max(100).optional(),
  irfBase: z.enum(['versement', 'loyer_brut']).optional(),
  profile: z.enum(['simple', 'standard', 'complet']).optional(),
  vatEnabled: z.coerce.boolean().optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  closingMode: z.enum(['simple', 'complet']).optional(),
  utilityAccountMode: z.enum(['clients', 'proprietaire']).optional(),
  payrollLevel: z.enum(['net', 'cnss', 'complet']).optional(),
  cnssEmployeeRate: z.coerce.number().min(0).max(100).optional(),
  cnssEmployerRate: z.coerce.number().min(0).max(100).optional(),
  itsBrackets: z.array(itsBracket).max(12).nullable().optional(),
  assetSaleProceeds: z.coerce.boolean().optional(),
});

module.exports = { updateGlSettingsSchema, itsBracket };
