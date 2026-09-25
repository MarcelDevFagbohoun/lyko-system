'use strict';

const { z } = require('zod');

/**
 * Clé d'idempotence d'un envoi (étape 36) : générée par le navigateur pour CET envoi de
 * formulaire ; deux envois de même clé n'enregistrent qu'une seule opération. Facultative
 * (ancien client, script) — les routes qui ont une garde héritée la conservent alors.
 */
const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Clé invalide')
  .optional();

module.exports = { idempotencyKeySchema };
