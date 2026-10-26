'use strict';

const multer = require('multer');
const { Router } = require('express');
const { ApiError } = require('../middleware/error');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const {
  createPaymentSchema,
  deletePaymentReasonSchema,
  endLeaseSchema,
  createLateFeeSchema,
  createLateFeePaymentSchema,
  createOpeningDebtPaymentSchema,
  updateContractSchema,
} = require('../validators/renters');
const {
  startInspectionReportSchema,
  updateInspectionDraftSchema,
  updateMoveOutDraftSchema,
  reopenInspectionReportSchema,
} = require('../validators/inspections');
const { streamReceiptPdf, streamEntryReceiptPdf, streamMoveOutPdf, streamMoveInPdf, streamLeaseContractPdf } = require('../services/pdf');
const { toPublicContract } = require('../services/leaseContract');
const leaseContractActions = require('../services/leaseContractActions');
const { resolvePropertyScope } = require('../services/scope');
const { toActor } = require('../utils/actor');
const { toPublicInspectionReport, toPublicMoveOutReport } = require('../services/inspection');
const logger = require('../utils/logger');
const leasePayments = require('../services/leasePayments');
const moveInReport = require('../services/moveInReport');
const moveOutReport = require('../services/moveOutReport');
const { saveInspectionFile } = require('../services/inspectionReports');

const router = Router();
router.use(requireAuth);

const canLocataires = requirePermission('locataires');
const canEtatsDesLieux = requirePermission('etats_des_lieux');
// Réouverture d'une fiche finalisée (étape 48, correction) : DG uniquement —
// même restriction que le catalogue de prix de dégradation.
const canReopenInspection = requireRole('dg');
// Marquer une régularisation comptable manuelle réglée : la comptabilité,
// jamais un agent restreint aux locataires (n'a rien à voir avec le journal).
const canRegularizeGl = requirePermission('comptabilite');
// Paiements et quittances : agent (locataires) ET comptable (paiements/factures, section 5).
// Enregistrer un versement de locataire : permission dédiée (la simple fiche locataire ne suffit plus).
const canPayments = requirePermission('loyers_encaisser');

// Photo par élément d'état des lieux : mêmes contraintes que les photos de
// Bien (étape 5/9). Signatures (finalisation) : PNG issu d'un canvas, léger.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});
const signaturesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});


// PATCH /api/leases/:leaseId — mettre fin à un bail (libère l'unité).
//
// Bug corrigé (audit comptable du 30/09/2026) : cette route terminait un
// bail sans jamais toucher à ses cautions (`deposit_status` restait `held`
// indéfiniment) — et une fois `status !== 'active'`, l'état des lieux de
// sortie (seule voie qui régularise réellement les cautions, voir
// `finalizeAdditionalDeposits` plus bas) devient DÉFINITIVEMENT
// inaccessible pour ce bail (il exige `status === 'active'`). Un raccourci
// pour un cas légitime (bail sans aucune caution en jeu) devenait donc un
// piège pour le cas courant. Corrigé : refuse ce raccourci dès qu'une
// caution — loyer ou SBEE/SONEB/peinture — est encore `held`, et renvoie
// vers le circuit de sortie normal (état des lieux) qui les régularise
// TOUTES dans la même transaction que la fin du bail.
router.patch('/:leaseId', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = endLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await leasePayments.endLease(req.user.tenantId, leaseId, scopeAgentId, parsed.data.endDate);

    logger.info('Bail terminé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/payments — registre des paiements du bail.
router.get('/:leaseId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const payments = await leasePayments.listLeasePayments(req.user.tenantId, leaseId, scopeAgentId);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leases/:leaseId/payments/:paymentId — annuler un paiement de
// loyer mal saisi (audit comptable, anomalie A3 : aucune voie de correction
// n'existait avant). Suppression LOGIQUE, jamais physique (justification
// obligatoire, comme les dépenses/charges depuis la migration 016) — le
// paiement reste consultable, mais disparaît des arriérés/recette/tableau
// de bord. Si une écriture GL existe déjà, génère son extourne dans LA
// MÊME transaction (jamais de simple suppression de l'écriture).
router.delete('/:leaseId/payments/:paymentId', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  const parsed = deletePaymentReasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Justification requise', parsed.error.flatten().fieldErrors));
  }
  const { reason } = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    await leasePayments.cancelPayment(req.user.tenantId, req.user.id, leaseId, paymentId, scopeAgentId, reason);
    logger.info('Paiement de loyer annulé', { tenantId: req.user.tenantId, leaseId, paymentId, by: req.user.id, reason });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payments — enregistrer un paiement (génère la quittance).
router.post('/:leaseId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { created, monthsCovered, fullMonths, partialAmount } = await leasePayments.createPayment(
      req.user.tenantId,
      req.user.id,
      leaseId,
      scopeAgentId,
      data,
    );

    logger.info('Paiement(s) de loyer enregistré(s)', {
      tenantId: req.user.tenantId,
      leaseId,
      count: created.length,
      totalAmount: data.amount,
      by: req.user.id,
    });

    const first = created[0];
    res.status(201).json({
      // Compat : premier paiement au niveau racine.
      paymentId: first.paymentId,
      receipt: first.receipt,
      // Répartition multi-mois.
      monthsCovered,
      fullMonths,
      partialAmount,
      payments: created,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/late-fees — pénalités déjà appliquées sur ce bail, avec leur solde de
// règlement (étape 44bis : une pénalité peut désormais être réglée, totalement ou partiellement).
router.get('/:leaseId/late-fees', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { rows, paidById } = await leasePayments.listLateFees(req.user.tenantId, leaseId, scopeAgentId);
    res.json({
      lateFees: rows.map((r) => {
        const amount = Number(r.amount);
        const paid = paidById.get(r.id) ?? 0;
        const remaining = amount - paid;
        return {
          id: r.id,
          amount,
          appliedAt: r.applied_at instanceof Date ? r.applied_at.toISOString().slice(0, 10) : String(r.applied_at).slice(0, 10),
          reason: r.reason,
          appliedBy: toActor(r.first_name, r.last_name, r.role),
          createdAt: r.created_at,
          paid,
          remaining,
          status: remaining <= 0 ? 'payee' : paid > 0 ? 'partielle' : 'impayee',
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/late-fees/:lateFeeId/payments — régler (totalement ou partiellement) une
// pénalité déjà appliquée (étape 44bis, demande directe de l'utilisateur : « revenons sur les
// pénalités » — jusqu'ici aucun suivi de règlement n'existait, une créance appliquée restait affichée
// indéfiniment sans qu'on puisse jamais dire si elle avait été payée). Si le module comptabilité avancée
// est actif, génère `penalite_retard_encaissee` (solde la créance 411 déjà comptabilisée à
// l'application, ne recrée JAMAIS le produit 707).
router.post('/:leaseId/late-fees/:lateFeeId/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const lateFeeId = Number(req.params.lateFeeId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(lateFeeId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLateFeePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { paymentId, remaining } = await leasePayments.payLateFee(req.user.tenantId, req.user.id, leaseId, lateFeeId, scopeAgentId, data);
    logger.info('Pénalité de retard réglée', { tenantId: req.user.tenantId, leaseId, lateFeeId, paymentId, amount: data.amount, by: req.user.id });
    res.status(201).json({ paymentId, remaining });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/late-fees — appliquer une pénalité de retard.
// Montant TOUJOURS saisi à la main (voir validators/renters.js) : jamais de
// barème automatique inventé. N'affecte jamais le montant du loyer dû
// (`computeArrears`, inchangé) — c'est une dette SÉPARÉE, réglée par le
// locataire quand il le souhaite (aucun suivi de règlement dédié en V1 :
// visible dans Comptabilité avancée, compte 411, comme toute créance).
router.post('/:leaseId/late-fees', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createLateFeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const lateFeeId = await leasePayments.createLateFee(req.user.tenantId, req.user.id, leaseId, scopeAgentId, data);
    logger.info('Pénalité de retard appliquée', { tenantId: req.user.tenantId, leaseId, lateFeeId, amount: data.amount, by: req.user.id });
    res.status(201).json({ lateFeeId });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/balance-snapshots — historique des soldes figés
// à chaque clôture de mois (audit, voir `lease_balance_snapshots`).
router.get('/:leaseId/balance-snapshots', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const rows = await leasePayments.listBalanceSnapshots(req.user.tenantId, leaseId, scopeAgentId);
    res.json({
      snapshots: rows.map((r) => ({ period: r.period, amountDue: Number(r.amount_due), createdAt: r.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/opening-debt/payments — régler (totalement ou
// partiellement) la dette initiale déclarée à la création du bail. Table
// dédiée plutôt qu'un ajout à `rent_payments` : cette dette n'est rattachée
// à aucun mois de loyer précis, jamais de quittance mensuelle à générer.
// Si le module comptabilité avancée est actif, génère la MÊME répartition
// qu'un encaissement de loyer normal (commission cabinet + reste au
// propriétaire, `dette_initiale_encaissee` dans le seed) — décision
// explicite de l'utilisateur : cette dette est traitée comme un loyer en
// retard finalement collecté, pas une opération à part.
router.post('/:leaseId/opening-debt/payments', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = createOpeningDebtPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { paymentId, remaining } = await leasePayments.payOpeningDebt(req.user.tenantId, req.user.id, leaseId, scopeAgentId, data);
    logger.info('Dette initiale réglée', { tenantId: req.user.tenantId, leaseId, paymentId, amount: data.amount, by: req.user.id });
    res.status(201).json({ paymentId, remaining });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/payments/:paymentId/receipt.pdf
router.get('/:leaseId/payments/:paymentId/receipt.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { lease, payment, receipt, renter, tenant, issuer } = await leasePayments.getRentReceiptData(
      req.user.tenantId,
      leaseId,
      paymentId,
      scopeAgentId,
    );

    streamReceiptPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      payment,
      receipt,
      issuer,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/entry-receipt.pdf — reçu d'entrée (caution, frais
// d'agence, cautions supplémentaires, prorata), créé une fois pour toutes à
// la signature du bail (voir routes/renters.js) — 404 si rien n'a été payé à
// la signature (aucun reçu n'a alors été créé).
router.get('/:leaseId/entry-receipt.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { lease, entryReceipt, renter, tenant, issuer, issuance } = await leasePayments.getEntryReceiptData(
      req.user.tenantId,
      leaseId,
      scopeAgentId,
    );

    streamEntryReceiptPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      entryReceipt,
      issuer,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payments/:paymentId/receipt-link — lien de
// partage direct de CETTE quittance (envoi automatique par WhatsApp juste
// après le paiement, voir frontend PaymentRegister). Idempotent : rappeler
// cette route pour la même quittance renvoie toujours le même lien.
router.post('/:leaseId/payments/:paymentId/receipt-link', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isInteger(leaseId) || !Number.isInteger(paymentId)) {
    return next(new ApiError(400, 'Identifiant invalide'));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const token = await leasePayments.getReceiptShareToken(req.user.tenantId, leaseId, paymentId, scopeAgentId);
    // Pas un chemin de page frontend (contrairement aux liens de portail/de
    // paiement) : ce token pointe directement sur le flux PDF du backend
    // (`GET /api/recu/:token`), sans page Next.js intermédiaire.
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-in-report — état des lieux d'entrée (le cas échéant).
router.get('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveInReport.getMoveInReport(req.user.tenantId, leaseId, scopeAgentId);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-in-report — démarre le BROUILLON de l'état des
// lieux d'entrée (une fois par bail), amorcé avec les zones/éléments standards.
router.post('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = startInspectionReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveInReport.startMoveInReport(req.user.tenantId, req.user.id, leaseId, scopeAgentId, parsed.data.conductedAt);

    logger.info('État des lieux d’entrée démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    res.status(201).json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/move-in-report — enregistre le brouillon (zones,
// éléments — y compris personnalisés —, notes). Refusé une fois finalisée.
router.patch('/:leaseId/move-in-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateInspectionDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveInReport.updateMoveInDraft(req.user.tenantId, leaseId, scopeAgentId, data);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST/DELETE .../move-in-report/items/:zoneKey/:itemKey/photo — photo d'un élément.
router.post(
  '/:leaseId/move-in-report/items/:zoneKey/:itemKey/photo',
  canEtatsDesLieux,
  photoUpload.single('photo'),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
    if (!req.file) return next(new ApiError(400, 'Photo requise'));

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const row = await moveInReport.addMoveInPhoto(req.user.tenantId, leaseId, scopeAgentId, req.params.zoneKey, req.params.itemKey, req.file);
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-in-report/items/:zoneKey/:itemKey/photo/:photoIndex', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const photoIndex = Number(req.params.photoIndex);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
  if (!Number.isInteger(photoIndex) || photoIndex < 0) return next(new ApiError(400, 'Index de photo invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveInReport.deleteMoveInPhoto(req.user.tenantId, leaseId, scopeAgentId, req.params.zoneKey, req.params.itemKey, photoIndex);
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-in-report/finalize — verrouille la fiche
// (exige tous les états renseignés + les deux signatures).
router.post(
  '/:leaseId/move-in-report/finalize',
  canEtatsDesLieux,
  signaturesUpload.fields([
    { name: 'tenantSignature', maxCount: 1 },
    { name: 'agentSignature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

    // Signatures numériques facultatives : l'état des lieux se signe à la main après impression.
    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const row = await moveInReport.finalizeMoveIn(req.user.tenantId, req.user.id, leaseId, scopeAgentId, {
        tenantSignatureFile,
        agentSignatureFile,
        tenantReservesInput: req.body?.tenantReserves,
      });


      logger.info('État des lieux d’entrée finalisé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
      res.json({ report: toPublicInspectionReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/leases/:leaseId/move-in-report/reopen — DG uniquement, motif
// obligatoire : rouvre une fiche finalisée pour corriger une erreur de
// saisie. Invalide les deux signatures existantes (il faudra resigner avant
// de refinaliser) — une signature engage sur un contenu précis, jamais sur
// un contenu qui pourrait changer sans qu'elle le sache.
router.post('/:leaseId/move-in-report/reopen', canReopenInspection, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = reopenInspectionReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const row = await moveInReport.reopenMoveIn(req.user.tenantId, req.user.id, leaseId, parsed.data.reason);

    logger.info('État des lieux d’entrée rouvert pour correction', {
      tenantId: req.user.tenantId,
      leaseId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    res.json({ report: toPublicInspectionReport(row) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-in-report.pdf — export PDF de l'état des
// lieux d'entrée finalisé (n'existait pas avant l'étape 48 — seule la sortie
// s'exportait, alors que le locataire signe les deux).
router.get('/:leaseId/move-in-report.pdf', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { lease, row, renter, tenant, issuance } = await moveInReport.getMoveInPdfData(req.user.tenantId, leaseId, scopeAgentId);

    streamMoveInPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      report: toPublicInspectionReport(row),
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-out-report — état des lieux de sortie (le cas
// échéant) + arriérés en cours (contexte pour aider à chiffrer les retenues).
router.get('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { row, arrears, additionalDeposits, statement } = await moveOutReport.getMoveOutReport(req.user.tenantId, leaseId, scopeAgentId);
    res.json({ report: toPublicMoveOutReport(row), arrears, additionalDeposits, statement });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-out-report — démarre le BROUILLON de l'état
// des lieux de sortie, amorcé avec les zones/éléments de la fiche d'entrée
// (mêmes `key`, pour que la comparaison automatique puisse faire correspondre
// les postes un par un) — ou, à défaut de fiche d'entrée, les zones standards.
router.post('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = startInspectionReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveOutReport.startMoveOutReport(req.user.tenantId, req.user.id, leaseId, scopeAgentId, parsed.data.conductedAt);

    logger.info('État des lieux de sortie démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    res.status(201).json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/move-out-report — enregistre le brouillon (zones,
// éléments, retenues par élément, autres retenues, notes).
router.patch('/:leaseId/move-out-report', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateMoveOutDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }
  const data = parsed.data;

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { row, additionalDeposits, statement } = await moveOutReport.updateMoveOutDraft(req.user.tenantId, leaseId, scopeAgentId, data);
    res.json({ report: toPublicMoveOutReport(row), additionalDeposits, statement });
  } catch (err) {
    next(err);
  }
});

// POST/DELETE .../move-out-report/items/:zoneKey/:itemKey/photo — photo d'un élément.
router.post(
  '/:leaseId/move-out-report/items/:zoneKey/:itemKey/photo',
  canEtatsDesLieux,
  photoUpload.single('photo'),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
    if (!req.file) return next(new ApiError(400, 'Photo requise'));

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const row = await moveOutReport.addMoveOutPhoto(req.user.tenantId, leaseId, scopeAgentId, req.params.zoneKey, req.params.itemKey, req.file);
      res.json({ report: toPublicMoveOutReport(row) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:leaseId/move-out-report/items/:zoneKey/:itemKey/photo/:photoIndex', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  const photoIndex = Number(req.params.photoIndex);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));
  if (!Number.isInteger(photoIndex) || photoIndex < 0) return next(new ApiError(400, 'Index de photo invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveOutReport.deleteMoveOutPhoto(req.user.tenantId, leaseId, scopeAgentId, req.params.zoneKey, req.params.itemKey, photoIndex);
    res.json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-out-report/finalize — verrouille la fiche
// (exige tous les états renseignés + les deux signatures), recalcule le
// décompte de caution à partir des données persistées, termine le bail et
// libère l'unité — tout dans la même transaction.
router.post(
  '/:leaseId/move-out-report/finalize',
  canEtatsDesLieux,
  signaturesUpload.fields([
    { name: 'tenantSignature', maxCount: 1 },
    { name: 'agentSignature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const { row, depositAccountingNote, additionalDeposits, totalDeductions, netRefund } = await moveOutReport.finalizeMoveOut(
        req.user.tenantId,
        req.user.id,
        leaseId,
        scopeAgentId,
        { tenantSignatureFile, agentSignatureFile, body: req.body },
      );

      logger.info('Sortie de locataire finalisée', {
        tenantId: req.user.tenantId,
        leaseId,
        totalDeductions,
        netRefund,
        by: req.user.id,
      });
      res.json({ report: toPublicMoveOutReport(row), depositAccountingNote, additionalDeposits });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/leases/:leaseId/move-out-report/reopen — DG uniquement, motif
// obligatoire. Contrairement à l'entrée, la sortie a des effets de bord
// déjà survenus (bail terminé, unité libérée, cautions supplémentaires
// réglées) : la réouverture NE LES DÉFAIT PAS (ce sont des faits, pas des
// erreurs de saisie) — seul le CONTENU de la fiche (grille, retenues,
// signatures) redevient modifiable. Si une écriture "caution restituée"
// avait été postée automatiquement, elle est extournée (jamais modifiée ni
// supprimée directement) : la refinalisation en postera une nouvelle si le
// nouveau calcul le justifie encore.
router.post('/:leaseId/move-out-report/reopen', canReopenInspection, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = reopenInspectionReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const { row, additionalDeposits } = await moveOutReport.reopenMoveOut(req.user.tenantId, req.user.id, leaseId, parsed.data.reason);

    logger.info('État des lieux de sortie rouvert pour correction', {
      tenantId: req.user.tenantId,
      leaseId,
      by: req.user.id,
      reason: parsed.data.reason,
    });
    res.json({ report: toPublicMoveOutReport(row), additionalDeposits });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/move-out-report/gl-regularized — marque comme
// réglée (à la main, dans Comptabilité → Journal → Écriture diverse) une
// restitution de caution avec retenue, jamais comptabilisée automatiquement
// (voir la finalisation ci-dessus). Fait disparaître le rappel de « Mes
// tâches » (routes/tasks.js) — sans quoi il resterait affiché indéfiniment.
router.post('/:leaseId/move-out-report/gl-regularized', canRegularizeGl, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const row = await moveOutReport.regularizeMoveOutGl(req.user.tenantId, req.user.id, leaseId, scopeAgentId);
    res.json({ report: toPublicMoveOutReport(row) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/move-out-report.pdf — PV de sortie & décompte de caution.
router.get('/:leaseId/move-out-report.pdf', canEtatsDesLieux, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { lease, row, renter, tenant, moveInZones, additionalDeposits, issuance } = await moveOutReport.getMoveOutPdfData(
      req.user.tenantId,
      leaseId,
      scopeAgentId,
    );

    streamMoveOutPdf(res, {
      tenant,
      renter,
      property: lease,
      lease,
      report: toPublicMoveOutReport(row),
      moveInZones,
      additionalDeposits,
      verificationCode: issuance.verification_code,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/leases/:leaseId/contract — contrat de bail (le cas échéant) + aperçu LIVE des données du
// bail (toujours à jour tant qu'il n'est pas finalisé — voir services/leaseContract.js).
router.get('/:leaseId/contract', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { row, preview } = await leaseContractActions.getContract(req.user.tenantId, leaseId, scopeAgentId);
    res.json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/contract — démarre le BROUILLON du contrat (une fois par bail) ; les
// articles n'ont rien à saisir (calculés depuis le bail), seules les conditions particulières le sont.
router.post('/:leaseId/contract', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { row, preview } = await leaseContractActions.startContract(req.user.tenantId, req.user.id, leaseId, scopeAgentId);
    logger.info('Contrat de bail démarré (brouillon)', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
    res.status(201).json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leases/:leaseId/contract — enregistre les conditions particulières (seul champ
// personnalisable). Refusé une fois finalisé.
router.patch('/:leaseId/contract', canLocataires, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  const parsed = updateContractSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ApiError(400, 'Formulaire invalide', parsed.error.flatten().fieldErrors));
  }

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { row, preview } = await leaseContractActions.updateContractConditions(
      req.user.tenantId,
      leaseId,
      scopeAgentId,
      parsed.data.particularConditions,
    );
    res.json({ contract: toPublicContract(row), preview });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/contract/finalize — verrouille le contrat (signatures des deux parties) ;
// fige les données du bail dans `snapshot` — un contrat déjà signé ne change plus jamais de contenu,
// même si le bail est modifié ensuite (voir migration 070).
router.post(
  '/:leaseId/contract/finalize',
  canLocataires,
  signaturesUpload.fields([
    { name: 'tenantSignature', maxCount: 1 },
    { name: 'agentSignature', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

    const tenantSignatureFile = req.files?.tenantSignature?.[0];
    const agentSignatureFile = req.files?.agentSignature?.[0];
    if (!tenantSignatureFile || !agentSignatureFile) {
      return next(new ApiError(400, 'Signature du locataire et de l’agent requises'));
    }

    try {
      const scopeAgentId = await resolvePropertyScope(req.user);
      const { row, snapshot } = await leaseContractActions.finalizeContract(
        req.user.tenantId,
        req.user.id,
        leaseId,
        scopeAgentId,
        (kind) =>
          kind === 'tenant'
            ? saveInspectionFile(req.user.tenantId, leaseId, tenantSignatureFile, 'signature-locataire', 'Signature')
            : saveInspectionFile(req.user.tenantId, leaseId, agentSignatureFile, 'signature-agent', 'Signature'),
      );

      logger.info('Contrat de bail finalisé', { tenantId: req.user.tenantId, leaseId, by: req.user.id });
      res.json({ contract: toPublicContract(row), preview: snapshot });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/leases/:leaseId/contract.pdf — brouillon (aperçu LIVE, jamais signé) ou contrat finalisé
// (données figées à la signature) — jamais de limite de téléchargement côté employé (par conception).
router.get('/:leaseId/contract.pdf', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { lease, contract, tenant, dg, data } = await leaseContractActions.getContractPdfData(req.user.tenantId, leaseId, scopeAgentId);

    streamLeaseContractPdf(res, {
      tenant,
      data,
      contract: toPublicContract(contract),
      issuer: dg || { first_name: tenant?.company_name ?? "L'entreprise", last_name: '' },
      leaseId: lease.id,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/leases/:leaseId/payment-links — génère un lien de paiement FedaPay
// à envoyer à la main (WhatsApp) à un locataire sans portail actif. Même
// schéma de révélation unique que POST /:id/portal-link (renters.js) : seule
// l'empreinte du token est conservée, le lien en clair n'est renvoyé qu'ici.
router.post('/:leaseId/payment-links', canPayments, async (req, res, next) => {
  const leaseId = Number(req.params.leaseId);
  if (!Number.isInteger(leaseId)) return next(new ApiError(400, 'Identifiant invalide'));

  try {
    const scopeAgentId = await resolvePropertyScope(req.user);
    const { token, amount, linkId } = await leasePayments.createRentPaymentLink(
      req.user.tenantId,
      req.user.id,
      leaseId,
      scopeAgentId,
      req.body?.amount,
    );

    logger.info('Lien de paiement (loyer) généré', {
      tenantId: req.user.tenantId,
      leaseId,
      linkId,
      amount,
      by: req.user.id,
    });
    res.status(201).json({ token, path: `/payer/${token}`, amount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
