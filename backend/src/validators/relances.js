'use strict';

const { z } = require('zod');

const createRelanceSchema = z.object({
  entityType: z.enum(['bail', 'charge'], { errorMap: () => ({ message: 'Type invalide' }) }),
  entityId: z.coerce.number().int().positive('Identifiant invalide'),
});

const outcomeSchema = z.object({
  note: z.string().trim().min(1, 'Écrivez un retour').max(1000, 'Trop long (1000 caractères max.)'),
});

module.exports = { createRelanceSchema, outcomeSchema };
