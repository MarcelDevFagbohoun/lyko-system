'use strict';

const { z } = require('zod');
const { amountSchema } = require('./renters');

const createCatalogItemSchema = z.object({
  label: z.string().trim().min(1, 'Libellé requis').max(150),
  price: amountSchema.refine((v) => v > 0, 'Le prix doit être supérieur à 0'),
});

const updateCatalogItemSchema = createCatalogItemSchema.partial();

module.exports = { createCatalogItemSchema, updateCatalogItemSchema };
