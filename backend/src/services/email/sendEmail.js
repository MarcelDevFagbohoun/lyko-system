'use strict';

/**
 * Emails transactionnels de l'inscription (demande utilisateur, 2026-10-18) : code de
 * vérification à 8 chiffres, puis email de bienvenue ~2 minutes après la confirmation
 * (`jobs/welcomeEmailJob.js`). Aucune route n'appelle Resend directement — tout passe par ici,
 * et un échec d'envoi ne fait JAMAIS échouer l'inscription elle-même (voir chaque appelant) :
 * le code est déjà généré et haché en base, un « renvoyer le code » reste toujours possible.
 */

const config = require('../../config/env');
const logger = require('../../utils/logger');
const { getClient, isConfigured } = require('./resendClient');

const PRIMARY = '#1E3A8A';
const INK = '#0F172A';
const MUTED = '#64748B';

function wrapHtml(bodyHtml) {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:32px 16px;background:#F1F5F9;font-family:Helvetica,Arial,sans-serif;color:${INK};">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${PRIMARY};height:6px;"></td></tr>
      <tr><td style="padding:28px 28px 8px;">
        <p style="margin:0;font-size:13px;letter-spacing:0.08em;color:${MUTED};text-transform:uppercase;">Lyko System</p>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        ${bodyHtml}
      </td></tr>
    </table>
  </body>
</html>`;
}

async function sendViaResend({ to, subject, html }) {
  if (!isConfigured()) {
    logger.warn("Resend non configuré — email non envoyé (dev/test)", { to, subject });
    return { sent: false };
  }
  const client = getClient();
  try {
    const result = await client.emails.send({ from: config.email.fromAddress, to, subject, html });
    if (result?.error) {
      logger.error("Échec de l'envoi d'email (Resend)", { to, subject, error: result.error });
      return { sent: false, error: result.error };
    }
    return { sent: true };
  } catch (err) {
    logger.error("Échec de l'envoi d'email (exception)", { to, subject, error: err.message });
    return { sent: false, error: err.message };
  }
}

async function sendVerificationCodeEmail({ to, dgName, companyName, code }) {
  const html = wrapHtml(`
    <h1 style="margin:0 0 12px;font-size:20px;">Confirmez votre email</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};">
      Bonjour ${dgName}, voici le code à saisir pour activer le compte de « ${companyName} » sur Lyko System.
    </p>
    <div style="margin:0 0 20px;padding:16px;background:#F1F5F9;border-radius:8px;text-align:center;">
      <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:0.15em;color:${PRIMARY};">${code}</span>
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">
      Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.
    </p>
  `);
  return sendViaResend({ to, subject: `${code} — Code de vérification Lyko System`, html });
}

function platformExplanationHtml() {
  return `
    <ul style="margin:0 0 20px;padding-left:18px;font-size:14px;color:${INK};line-height:1.7;">
      <li><strong>Propriétaires &amp; locataires</strong> — fiches, baux, cautions, états des lieux.</li>
      <li><strong>Comptabilité</strong> — loyers encaissés, dépenses, charges SONEB/SBEE, et une comptabilité avancée (SYSCOHADA) si vous l'activez.</li>
      <li><strong>Salaires</strong> — fiches de paie de votre personnel, signées par vous.</li>
      <li><strong>Biens à vendre</strong> — catalogue interne de vos biens en vente.</li>
      <li><strong>Employés</strong> — créez des comptes comptable/agent avec des accès précis.</li>
    </ul>
  `;
}

async function sendWelcomeEmail({ to, dgName, companyName }) {
  const html = wrapHtml(`
    <h1 style="margin:0 0 12px;font-size:20px;">Bienvenue, ${dgName}</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">
      Le compte de « ${companyName} » est actif. Voici un aperçu de ce que vous pouvez faire sur Lyko System :
    </p>
    ${platformExplanationHtml()}
    <a href="${config.frontendUrl}/espace" style="display:inline-block;padding:10px 20px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;">
      Ouvrir Lyko System
    </a>
  `);
  return sendViaResend({ to, subject: 'Bienvenue sur Lyko System', html });
}

module.exports = { sendVerificationCodeEmail, sendWelcomeEmail };
