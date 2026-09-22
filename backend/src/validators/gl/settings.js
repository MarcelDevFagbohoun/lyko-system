'use strict';

const { z } = require('zod');

// Tous les champs optionnels : PATCH partiel, un réglage à la fois ou plusieurs
// ensemble. Voir routes/gl/glSettings.js pour la liste à jour.
const updateGlSettingsSchema = z.object({
  depreciationProrataTemporis: z.coerce.boolean().optional(),
  utilityPassThroughPercent: z.coerce.number().int().min(0).max(100).optional(),
  commissionTiming: z.enum(['encaissement', 'reversement'], { errorMap: () => ({ message: 'Moment de commission invalide' }) }).optional(),
  irfEnabled: z.coerce.boolean().optional(),
  irfRate: z.coerce.number().int().min(0).max(100).optional(),
});

module.exports = { updateGlSettingsSchema };
