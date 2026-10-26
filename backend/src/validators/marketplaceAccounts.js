'use strict';

const { z } = require('zod');
const { phoneSchema, passwordSchema, nameSchema } = require('./auth');
const { optionalText } = require('./renters');

const registerAccountSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  role: z.enum(['chercheur', 'proprietaire'], { error: 'Type de compte invalide' }),
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

const loginAccountSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  phone: phoneSchema,
  password: z.string().min(1, 'Mot de passe requis'),
});

const createRequestSchema = z.object({
  requestType: z.enum(['louer', 'vendre'], { error: 'Type de demande invalide' }),
  address: z.string().trim().min(3, 'Adresse requise').max(255),
  description: optionalText(2000),
});

const updateRequestStatusSchema = z.object({
  status: z.enum(['contactee', 'acceptee', 'refusee'], { error: 'Statut invalide' }),
});

module.exports = {
  registerAccountSchema,
  loginAccountSchema,
  createRequestSchema,
  updateRequestStatusSchema,
};
