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
const LOGO_URL = `${config.frontendUrl}/brand/logo-mark.png`;

/** Échappe tout texte inséré dans un gabarit HTML : un nom saisi par un utilisateur ne doit jamais injecter de balises. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Retire retours à la ligne et caractères de contrôle d'une valeur destinée à un en-tête (sujet) : anti-injection d'en-têtes. */
function safeHeader(value) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, 150);
}

/**
 * Gabarit commun de tous les e-mails : mise en page à tableaux (compatible Gmail/Outlook/Apple Mail), 600 px de large,
 * en-tête de marque, texte d'aperçu masqué (`preheader`) et pied de page légal. Le logo est servi depuis l'URL publique du site.
 */
function wrapHtml(bodyHtml, { preheader = '' } = {}) {
  const LEGAL = config.legal;
  const legalLine = [LEGAL.name, LEGAL.address, LEGAL.rccm && `RCCM ${LEGAL.rccm}`, LEGAL.ifu && `IFU ${LEGAL.ifu}`].filter(Boolean).map(escapeHtml).join(' · ');
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Africa Immo Management</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F5F7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;">
      <tr><td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">
          <tr><td style="padding:24px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:15px;font-weight:700;color:${INK};">Africa Immo Management</td>
              <td align="right"><img src="${LOGO_URL}" alt="Africa Immo Management" width="44" height="44" style="display:block;border:0;"></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:32px 32px 28px;font-size:15px;line-height:1.6;color:${INK};">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.6;color:${MUTED};">
            Ceci est un message automatique, merci de ne pas y répondre.<br>
            ${legalLine}<br>
            <a href="${config.frontendUrl}" style="color:${MUTED};">${escapeHtml(config.frontendUrl.replace(/^https?:\/\//, ''))}</a>
            · <a href="${config.frontendUrl}/verifier" style="color:${MUTED};">Vérifier un document</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Version texte brut (meilleure délivrabilité, lecteurs d'écran, clients sans HTML). */
function htmlToText(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|tr|li|h1|h2|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&zwnj;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function sendViaResend({ to, subject, html, attachments }) {
  if (!isConfigured()) {
    logger.warn("Resend non configuré, email non envoyé (dev/test)", { to, subject });
    return { sent: false };
  }
  const client = getClient();
  try {
    const result = await client.emails.send({ from: `Africa Immo Management <${config.email.fromAddress}>`, to, subject, html, text: htmlToText(html), ...(attachments?.length ? { attachments } : {}) });
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
      Bonjour ${escapeHtml(dgName)}, saisissez ce code pour activer le compte de « ${escapeHtml(companyName)} ».
    </p>
    <div style="margin:0 0 20px;padding:16px;background:#F1F5F9;border-radius:8px;text-align:center;">
      <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:0.15em;color:${PRIMARY};">${code}</span>
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">
      Il est valable 15 minutes. Si vous n'avez pas créé de compte, vous pouvez ignorer ce message.
    </p>
  `);
  return sendViaResend({ to, subject: `${code} est votre code de vérification`, html });
}

async function sendPasswordResetCodeEmail({ to, dgName, code }) {
  const html = wrapHtml(`
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;">Réinitialisation de votre mot de passe</h1>
    <p style="margin:0 0 24px;color:${MUTED};">Bonjour ${escapeHtml(dgName)}, saisissez ce code pour choisir un nouveau mot de passe.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#F1F5F9;border-radius:8px;padding:18px;text-align:center;">
      <span style="font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:0.15em;color:${PRIMARY};">${code}</span>
    </td></tr></table>
    <p style="margin:0;font-size:13px;color:${MUTED};">Il est valable 15 minutes. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel ne change pas.</p>
  `, { preheader: `Votre code de réinitialisation : ${code}` });
  return sendViaResend({ to, subject: `${code} est votre code de réinitialisation`, html });
}

function platformExplanationHtml() {
  return `
    <ul style="margin:0 0 20px;padding-left:18px;font-size:14px;color:${INK};line-height:1.7;">
      <li><strong>Propriétaires &amp; locataires</strong> : fiches, baux, cautions, états des lieux.</li>
      <li><strong>Comptabilité</strong> : loyers encaissés, dépenses, charges SONEB/SBEE, et une comptabilité avancée (SYSCOHADA) si vous l'activez.</li>
      <li><strong>Salaires</strong> : fiches de paie de votre personnel, signées par vous.</li>
      <li><strong>Biens à vendre</strong> : catalogue interne de vos biens en vente.</li>
      <li><strong>Employés</strong> : créez des comptes comptable/agent avec des accès précis.</li>
    </ul>
  `;
}

async function sendWelcomeEmail({ to, dgName, companyName }) {
  const html = wrapHtml(`
    <h1 style="margin:0 0 12px;font-size:20px;">Bienvenue, ${escapeHtml(dgName)}</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">
      Le compte de « ${escapeHtml(companyName)} » est prêt. Voici ce que vous pouvez faire dès maintenant :
    </p>
    ${platformExplanationHtml()}
    <a href="${config.frontendUrl}/espace" style="display:inline-block;padding:10px 20px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;">
      Ouvrir Africa Immo Management
    </a>
  `);
  return sendViaResend({ to, subject: 'Bienvenue sur Africa Immo Management', html });
}

const FEATURE_LABELS = {
  core: 'Biens, propriétaires, locataires, baux, loyers, quittances, charges, comptabilité simple',
  tenant_collect: 'Paiement des loyers par les locataires (FedaPay)',
  payroll: 'Fiches de paie et salaires',
  payouts: 'Paiements sortants (salaires, reversements)',
  owner_portal: 'Portail et relevés propriétaires',
  sale_properties: 'Biens à vendre',
  advanced_accounting: 'Comptabilité avancée SYSCOHADA',
  audit_full: "Journal d'audit complet et support prioritaire",
  // Label ajouté (demande utilisateur, 2026-10-23) pour que ce reçu puisse un jour lister cette
  // fonction — `ai_assistant` reste absent de `features` sur demarrage/pro/entreprise
  // (constants/plans.js) : aucune offre ne la coche pour l'instant, décision à part.
  ai_assistant: 'Assistance IA',
};

/**
 * Reçu d'abonnement (premier achat ou renouvellement), présenté comme une facture : titre, bloc clé/valeur, émetteur et
 * client, montant, tableau des lignes et totaux. Le PDF est joint et le code de vérification publique rappelé.
 * `plan` vient du catalogue serveur ; tout texte variable est échappé.
 */
async function sendSubscriptionActivatedEmail({ to, dgName, companyName, plan, months, amount, endDate, renewal, upgrade, credit = 0, creditDays, fromPlanLabel, receiptNumber, verificationCode, pdf, paidOn, reference, founder, client }) {
  const limit = (v) => (v == null ? 'illimité' : String(v));
  const features = Object.keys(FEATURE_LABELS).filter((k) => plan.features.includes(k));
  const LEGAL = config.legal;
  const kv = (label, value) =>
    `<tr><td style="padding:3px 0;width:150px;font-size:14px;font-weight:700;color:${INK};vertical-align:top;">${label}</td><td style="padding:3px 0;font-size:14px;color:${INK};">${value}</td></tr>`;
  const th = (t, align = 'left') => `<td align="${align}" style="padding:8px 0;border-bottom:1px solid #E2E8F0;font-size:13px;color:${MUTED};">${t}</td>`;
  const total = (label, value, strong) =>
    `<tr><td></td><td colspan="2" style="padding:7px 0;border-top:1px solid #E2E8F0;font-size:14px;${strong ? 'font-weight:700;' : `color:${MUTED};`}">${label}</td><td align="right" style="padding:7px 0;border-top:1px solid #E2E8F0;font-size:14px;${strong ? 'font-weight:700;' : ''}">${value}</td></tr>`;
  const issuerLines = [LEGAL.name, LEGAL.address, LEGAL.rccm && `RCCM ${LEGAL.rccm}`, LEGAL.ifu && `IFU ${LEGAL.ifu}`].filter(Boolean);
  const clientLines = [companyName, client?.rccm && `RCCM ${client.rccm}`, client?.ifu && `IFU ${client.ifu}`, to].filter(Boolean);
  const label = `Abonnement ${plan.label}${founder ? ' (tarif fondateur)' : ''}`;
  const fullPrice = Number(amount) + Number(credit);
  const html = wrapHtml(`
    <h1 style="margin:8px 0 20px;font-size:28px;line-height:1.2;color:${INK};">${upgrade ? 'Reçu de changement d’offre' : renewal ? 'Reçu de renouvellement' : 'Reçu de paiement'}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${receiptNumber ? kv('N° de reçu', `<span style="font-family:'Courier New',monospace;">${escapeHtml(receiptNumber)}</span>`) : ''}
      ${paidOn ? kv('Date de paiement', escapeHtml(paidOn)) : ''}
      ${reference ? kv('Référence', `<span style="font-family:'Courier New',monospace;">${escapeHtml(reference)}</span>`) : ''}
      ${kv("Valable jusqu'au", escapeHtml(endDate))}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr>
      <td valign="top" width="50%" style="font-size:13px;line-height:1.6;color:${INK};padding-right:12px;"><strong>${escapeHtml(LEGAL.name)}</strong><br>${issuerLines.slice(1).map(escapeHtml).join('<br>')}</td>
      <td valign="top" width="50%" style="font-size:13px;line-height:1.6;color:${INK};"><strong>Facturé à</strong><br>${clientLines.map(escapeHtml).join('<br>')}</td>
    </tr></table>
    <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:${INK};">${escapeHtml(formatAmount(amount))} payés${paidOn ? ` le ${escapeHtml(paidOn)}` : ''}</p>
    <p style="margin:0 0 24px;font-size:14px;color:${MUTED};">Bonjour ${escapeHtml(dgName)}, merci pour votre paiement. Le reçu est en pièce jointe.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>${th('Description')}${th('Qté', 'right')}${th('Prix unitaire', 'right')}${th('Montant', 'right')}</tr>
      <tr>
        <td style="padding:12px 0;font-size:14px;color:${INK};">${escapeHtml(label)}<br><span style="font-size:12px;color:${MUTED};">${Number(months)} mois</span></td>
        <td align="right" style="padding:12px 0;font-size:14px;">1</td>
        <td align="right" style="padding:12px 0;font-size:14px;">${escapeHtml(formatAmount(fullPrice))}</td>
        <td align="right" style="padding:12px 0;font-size:14px;">${escapeHtml(formatAmount(fullPrice))}</td>
      </tr>
      ${credit > 0 ? `<tr>
        <td style="padding:0 0 12px;font-size:14px;color:${INK};">Crédit${fromPlanLabel ? ` offre ${escapeHtml(fromPlanLabel)}` : ''}<br><span style="font-size:12px;color:${MUTED};">${creditDays ? `${Number(creditDays)} jours restants de votre abonnement précédent` : 'Jours restants de votre abonnement précédent'}</span></td>
        <td align="right" style="padding:0 0 12px;font-size:14px;">1</td>
        <td align="right" style="padding:0 0 12px;font-size:14px;">-${escapeHtml(formatAmount(credit))}</td>
        <td align="right" style="padding:0 0 12px;font-size:14px;">-${escapeHtml(formatAmount(credit))}</td>
      </tr>` : ''}
      ${total('Sous-total', escapeHtml(formatAmount(fullPrice)))}
      ${credit > 0 ? total('Crédit déduit', `-${escapeHtml(formatAmount(credit))}`) : ''}
      ${total('Total', escapeHtml(formatAmount(amount)))}
      ${total('Montant payé', escapeHtml(formatAmount(amount)), true)}
    </table>
    ${verificationCode ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#F1F5F9;border-radius:8px;padding:16px 20px;">
      <span style="display:block;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">Code de vérification</span>
      <span style="display:block;margin:4px 0 6px;font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:${PRIMARY};">${escapeHtml(verificationCode)}</span>
      <span style="font-size:13px;color:${MUTED};">Pour confirmer que ce reçu est authentique, saisissez ce code sur <a href="${config.frontendUrl}/verifier" style="color:${PRIMARY};">${escapeHtml(config.frontendUrl.replace(/^https?:\/\//, ''))}/verifier</a>.</span>
    </td></tr></table>` : ''}
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;">Votre offre</p>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:${INK};line-height:1.8;">
      <li>${escapeHtml(limit(plan.limits.units))} unités, ${escapeHtml(limit(plan.limits.owners))} propriétaires, ${escapeHtml(limit(plan.limits.users))} utilisateurs</li>
      ${features.map((k) => `<li>${escapeHtml(FEATURE_LABELS[k])}</li>`).join('')}
    </ul>
    <p style="margin:0 0 24px;font-size:13px;color:${MUTED};">Rien n'est prélevé automatiquement : vous renouvelez quand vous voulez. Tous vos reçus restent disponibles dans la page Abonnement.</p>
    <a href="${config.frontendUrl}/espace" style="display:inline-block;padding:12px 26px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">Ouvrir mon espace</a>
  `, { preheader: `${formatAmount(amount)} payés. Abonnement ${plan.label} valable jusqu'au ${endDate}.` });
  return sendViaResend({
    to,
    subject: upgrade ? `Vous êtes passé à l'offre ${plan.label}, voici votre reçu` : renewal ? 'Votre abonnement est renouvelé, voici votre reçu' : 'Votre abonnement est actif, voici votre reçu',
    html,
    attachments: pdf ? [{ filename: `${receiptNumber || 'recu-abonnement'}.pdf`, content: pdf }] : undefined,
  });
}

const PURPOSE_LABELS = {
  salaire: 'Salaire',
  reversement_proprietaire: 'Reversement de loyers',
  autre: 'Paiement',
  loyer: 'Loyer',
  charge: 'Charges (eau/électricité)',
};

function formatAmount(amount) {
  return `${Math.round(Number(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

/**
 * Confirmation de paiement. `direction` : 'out' (l'entreprise a payé le destinataire) ou 'in' (le destinataire a
 * payé l'entreprise). Contient uniquement montant, objet, référence et date — jamais de numéro de téléphone ni
 * de donnée bancaire. Tout texte variable est échappé.
 */
async function sendPaymentConfirmationEmail({ to, recipientName, companyName, direction, purpose, amount, reference, dateLabel, label, downloadHint }) {
  const intro =
    direction === 'out'
      ? `${escapeHtml(companyName)} vous a envoyé un paiement.`
      : `${escapeHtml(companyName)} a bien reçu votre paiement.`;
  const html = wrapHtml(`
    <h1 style="margin:0 0 12px;font-size:20px;">${direction === 'out' ? 'Paiement envoyé' : 'Paiement reçu'}</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">Bonjour ${escapeHtml(recipientName)}, ${intro}</p>
    <table role="presentation" width="100%" style="margin:0 0 16px;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:${MUTED};">Objet</td><td style="padding:6px 0;text-align:right;">${escapeHtml(PURPOSE_LABELS[purpose] ?? 'Paiement')}${label ? ` (${escapeHtml(label)})` : ''}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Montant</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${escapeHtml(formatAmount(amount))}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Date</td><td style="padding:6px 0;text-align:right;">${escapeHtml(dateLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Référence</td><td style="padding:6px 0;text-align:right;font-family:'Courier New',monospace;">${escapeHtml(reference)}</td></tr>
    </table>
    ${downloadHint ? `<p style="margin:0 0 8px;font-size:13px;color:${MUTED};">${escapeHtml(downloadHint)}</p>` : ''}
    <p style="margin:0;font-size:12px;color:${MUTED};">Gardez cet e-mail comme preuve de paiement. Si cette opération ne vous dit rien, contactez ${escapeHtml(companyName)}.</p>
  `);
  const subject = safeHeader(`${direction === 'out' ? 'Paiement envoyé' : 'Paiement reçu'} : ${formatAmount(amount)} (${reference})`);
  return sendViaResend({ to, subject, html });
}

/** Rappel : l'abonnement arrive à échéance (ou vient de s'arrêter, daysLeft <= 0). */
async function sendSubscriptionReminderEmail({ to, dgName, companyName, planLabel, daysLeft, renewUrl }) {
  const expired = daysLeft <= 0;
  const html = wrapHtml(`
    <h1 style="margin:0 0 12px;font-size:20px;">${expired ? 'Votre abonnement a pris fin' : `Votre abonnement se termine dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`}</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">Bonjour ${escapeHtml(dgName)}, l'abonnement ${escapeHtml(planLabel)} de ${escapeHtml(companyName)} ${expired ? "n'est plus actif. Votre espace est suspendu, mais vos locataires peuvent toujours payer leur loyer." : 'arrive bientôt à échéance. Renouvelez-le pour garder l’accès à votre espace sans interruption.'}</p>
    <a href="${escapeHtml(renewUrl)}" style="display:inline-block;padding:12px 26px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">Renouveler mon abonnement</a>
  `);
  return sendViaResend({ to, subject: safeHeader(expired ? 'Votre abonnement Africa Immo Management a pris fin' : `Votre abonnement Africa Immo Management se termine dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`), html });
}

/** Courriel d'information du back-office / remboursement : titre, paragraphes (échappés), lien optionnel. */
async function sendBillingEmail({ to, subject, heading, paragraphs, linkUrl = null, linkLabel = null }) {
  const html = wrapHtml(`
    <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.25;">${escapeHtml(heading)}</h1>
    ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;color:${INK};">${escapeHtml(p)}</p>`).join('')}
    ${linkUrl ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(linkUrl)}" style="display:inline-block;padding:12px 26px;background:${PRIMARY};color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">${escapeHtml(linkLabel || 'Ouvrir')}</a></p>` : ''}
  `);
  return sendViaResend({ to, subject: safeHeader(subject), html });
}

module.exports = { sendBillingEmail, sendSubscriptionReminderEmail, sendVerificationCodeEmail, sendWelcomeEmail, sendPasswordResetCodeEmail, sendSubscriptionActivatedEmail, sendPaymentConfirmationEmail, escapeHtml, safeHeader };
