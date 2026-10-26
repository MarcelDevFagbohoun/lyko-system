'use strict';

/**
 * Messages de validation par défaut en français (zod 4). Les messages explicites écrits dans les schémas
 * restent prioritaires ; ceci ne couvre que les cas sans message (champ manquant, mauvais type, valeur hors liste).
 */
const { z } = require('zod');

z.config({
  customError: (iss) => {
    if (iss.code === 'invalid_type' && iss.input === undefined) return 'Champ requis';
    if (iss.code === 'invalid_type') return 'Valeur invalide';
    if (iss.code === 'invalid_value') return 'Valeur non autorisée';
    return undefined; // les autres cas : message par défaut français de zod
  },
});
z.config(z.locales.fr());
