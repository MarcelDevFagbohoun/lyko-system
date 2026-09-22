'use strict';

const { z } = require('zod');
const { dateSchema, optionalText } = require('./renters');

const createTaskSchema = z.object({
  title: z.string().trim().min(2, 'Trop court').max(200, 'Trop long (200 caractères max)'),
  description: optionalText(2000),
  assignedTo: z.coerce.number().int('Employé requis').positive('Employé requis'),
  dueDate: dateSchema,
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(2, 'Trop court').max(200, 'Trop long (200 caractères max)').optional(),
  description: optionalText(2000),
  assignedTo: z.coerce.number().int('Employé requis').positive('Employé requis').optional(),
  dueDate: dateSchema.optional(),
});

module.exports = { createTaskSchema, updateTaskSchema };
