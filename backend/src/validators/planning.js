'use strict';

const { z } = require('zod');
const { dateSchema, optionalText } = require('./renters');

const title = z.string().trim().min(2, 'Trop court').max(200, 'Trop long (200 caractères max)');
const id = z.coerce.number().int().positive();
const optDate = dateSchema.nullable().optional();

const taskBase = {
  title,
  description: optionalText(2000),
  priority: z.enum(['basse', 'normale', 'haute']),
  status: z.enum(['a_faire', 'en_cours', 'termine']),
  startDate: optDate,
  dueDate: optDate,
  objectiveId: id.nullable().optional(),
  ownerId: id,
};
const withRange = (d, ctx) => {
  if (d.startDate && d.dueDate && d.startDate > d.dueDate) {
    ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'L\'échéance doit suivre la date de début' });
  }
};

const createTaskSchema = z.object({ ...taskBase, priority: taskBase.priority.default('normale'), status: taskBase.status.default('a_faire'), ownerId: id.optional() }).superRefine(withRange);
const updateTaskSchema = z.object(taskBase).partial().superRefine(withRange);

const objBase = {
  title,
  description: optionalText(2000),
  startDate: dateSchema,
  endDate: dateSchema,
  ownerId: id,
};
const objRange = (d, ctx) => {
  if (d.startDate && d.endDate && d.startDate > d.endDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La fin doit suivre le début' });
  }
};
const createObjectiveSchema = z.object({ ...objBase, ownerId: id.optional() }).superRefine(objRange);
const updateObjectiveSchema = z.object(objBase).partial().superRefine(objRange);

const num = z.coerce.number().min(0, 'Valeur positive').max(999999999999, 'Trop grand');
const createKeyResultSchema = z.object({
  title,
  unit: z.string().trim().max(20).nullable().optional(),
  targetValue: num.refine((v) => v > 0, 'La cible doit être supérieure à 0'),
  currentValue: num.optional(),
});
const updateKeyResultSchema = z.object({
  title: title.optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  targetValue: num.refine((v) => v > 0, 'La cible doit être supérieure à 0').optional(),
  currentValue: num.optional(),
});

module.exports = { createTaskSchema, updateTaskSchema, createObjectiveSchema, updateObjectiveSchema, createKeyResultSchema, updateKeyResultSchema };
