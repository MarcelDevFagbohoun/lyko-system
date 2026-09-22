'use strict';

const { z } = require('zod');

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Période invalide (AAAA-MM)');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');
// Le solde d'un relevé bancaire n'est jamais négatif dans ce contexte (pas de
// découvert géré ici) mais peut légitimement valoir 0 — jamais `.positive()`.
const amountSchema = z.coerce.number().int('Montant entier requis').min(0, 'Montant invalide').max(1_000_000_000_000, 'Montant hors limite');

const startReconciliationSchema = z.object({
  period: periodSchema,
  statementBalance: amountSchema,
});

const updateReconciliationSchema = z.object({
  statementBalance: amountSchema,
});

// Une ligne pointe soit une écriture DÉJÀ enregistrée (`entryLineId`), soit
// une opération vue seulement sur le relevé, absente des comptes
// (`bankReference`/`bankAmount`/`bankDate`) — jamais les deux à la fois.
const addLineSchema = z
  .object({
    entryLineId: z.coerce.number().int().positive().optional(),
    bankReference: z.string().trim().max(100).optional(),
    bankAmount: amountSchema.optional(),
    bankDate: dateSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.entryLineId) {
      if (data.bankAmount !== undefined || data.bankDate !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['entryLineId'],
          message: 'Un mouvement pointé ne prend pas de montant/date de relevé distinct',
        });
      }
      return;
    }
    if (data.bankAmount === undefined || data.bankAmount <= 0) {
      ctx.addIssue({ code: 'custom', path: ['bankAmount'], message: 'Montant requis' });
    }
    if (!data.bankDate) {
      ctx.addIssue({ code: 'custom', path: ['bankDate'], message: 'Date requise' });
    }
  });

// `force` : confirme la clôture malgré des mouvements non pointés ou un
// écart non nul — jamais bloqué de force par le système, un écart peut être
// légitime (frais bancaires pas encore saisis, chèque pas encore encaissé).
const finalizeReconciliationSchema = z.object({
  force: z.coerce.boolean().optional().default(false),
});

module.exports = {
  startReconciliationSchema,
  updateReconciliationSchema,
  addLineSchema,
  finalizeReconciliationSchema,
};
