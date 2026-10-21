'use strict';

// Page publique de paiement (lien généré par le personnel pour un locataire
// sans portail actif) — sans compte, sans mot de passe, comme le portail
// locataire : l'accès se fait par le token secret dans l'URL. Jamais de
// `requireAuth` employé ici.

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const { hashToken } = require('../utils/tokens');
const { startCheckout } = require('../services/onlinePayments');

const router = Router();

// Même principe que le portail (`portalLimiter`) — le token (256 bits) rend
// déjà le brute-force impraticable, ce quota est une protection en profondeur.
const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard.' },
});
router.use(payLimiter);

/** Résout un lien de paiement par son token, ou lève un 404 générique (lien
 * inconnu, expiré ou déjà payé ne se distinguent jamais — pas d'énumération). */
async function loadPaymentLink(token) {
  const [rows] = await pool.query(
    `SELECT pl.*, t.company_name, t.logo_path, t.fedapay_collect_enabled
     FROM payment_links pl
     JOIN tenants t ON t.id = pl.tenant_id
     WHERE pl.token_hash = :hash LIMIT 1`,
    { hash: hashToken(token) },
  );
  const link = rows[0];
  if (!link) throw new ApiError(404, 'Lien de paiement invalide ou expiré');
  if (link.status !== 'pending' || new Date(link.expires_at) < new Date()) {
    throw new ApiError(404, 'Lien de paiement invalide ou expiré');
  }
  return link;
}

// GET /api/pay/:token — informations minimales pour afficher la page de paiement.
router.get('/:token', async (req, res, next) => {
  try {
    const link = await loadPaymentLink(req.params.token);
    res.json({
      // Sert à construire côté client la référence posée dans le widget
      // (`t<tenantId>:link:<token>`), recoupée par le serveur à la
      // vérification — voir POST /:token/verify ci-dessous.
      tenantId: link.tenant_id,
      companyName: link.company_name,
      logoUrl: link.logo_path ? `/uploads/${link.logo_path}` : null,
      kind: link.kind,
      amount: Number(link.amount),
      onlinePaymentEnabled: !!link.fedapay_collect_enabled,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/pay/:token/checkout — ouvre la page de paiement FedaPay pour CE lien (montant fixé par le lien).
router.post('/:token/checkout', async (req, res, next) => {
  try {
    const link = await loadPaymentLink(req.params.token);
    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = :id LIMIT 1', { id: link.tenant_id });
    res.json(await startCheckout({
      tenant,
      kind: link.kind === 'loyer' ? 'rent' : 'charge',
      leaseId: link.lease_id,
      chargeId: link.charge_id,
      linkId: link.id,
      amount: Number(link.amount),
      customer: { name: 'Locataire' },
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
