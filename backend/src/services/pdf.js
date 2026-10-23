'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');
const { UTILITY_TYPES } = require('../constants/charges');
const { resolveRoleLabels } = require('../constants/roles');
const { compareCondition } = require('./inspection');
const { paymentPeriodKey, periodEndOf } = require('./rentTracking');
const config = require('../config/env');
const D = require('./pdfDesign');

const EXPENSE_CATEGORY_LABELS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
const UTILITY_TYPE_LABELS = Object.fromEntries(UTILITY_TYPES.map((t) => [t.key, t.label]));

// Charte graphique alignée sur celle de l'application (frontend/tailwind.config.ts)
// — mêmes tokens sémantiques, pour qu'un PDF généré ressemble à un écran de
// Africa Immo Management plutôt qu'à un document généré à part avec ses propres couleurs.
const PRIMARY = '#0B2A5B';
const PRIMARY_BG = '#EAF0FB';
const PRIMARY_BORDER = '#C5D3EE';
const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#5B6B82';
const FAINT = '#94A3B8';
const BORDER = '#E2E8F0';
const BORDER_STRONG = '#CBD5E1';
const SURFACE_MUTED = '#F1F5F9';
const SUCCESS_FG = '#047857';
const DANGER_FG = '#B91C1C';
const WARNING_FG = '#B45309';

// Refonte demandée par l'utilisateur (« pas professionnel du tout ») : texte
// courant/titres en Helvetica (moderne, sobre), mais tout ce qui est un
// CHIFFRE — montants, dates, numéros de référence, RCCM/IFU, téléphones — en
// Courier (l'équivalent Courier New des 14 polices standard PDF, aucune
// police à embarquer) pour l'alignement tabulaire propre des factures/relevés,
// à la manière des factures Stripe/Apple plutôt qu'un simple document Word.
const FONT_SANS = 'Helvetica';
const FONT_SANS_BOLD = 'Helvetica-Bold';
const FONT_MONO = 'Helvetica';
const FONT_MONO_BOLD = 'Helvetica-Bold';

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Marge basse volontairement plus grande que les autres côtés : le pied de
// page (bande de séparation + texte, dessinée à des coordonnées absolues
// autour de y=772-790) doit toujours rester SOUS la zone où PDFKit
// enchaîne automatiquement les pages pour un texte trop long — sans cette
// marge, un texte libre long (ex. contrat personnalisé du DG) peut se
// terminer juste au-dessus du pied de page et le chevaucher visuellement
// avant que PDFKit ne bascule à la page suivante (bug constaté en testant
// sur le vrai contrat de KIko Store).
const PAGE_MARGINS = { top: 50, bottom: 75, left: 50, right: 50 };

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatMonthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${MONTHS_FR[m - 1]} ${y}`;
}

/**
 * Un texte collé depuis Word/Google Docs (ou saisi sur Windows) porte souvent
 * des fins de ligne "\r\n" ; PDFKit ne les traite pas comme un simple retour
 * à la ligne et dessine le "\r" comme un glyphe visible (rendu « Ð » avec les
 * polices standard) — un caractère parasite après chaque ligne. À appliquer à
 * tout texte libre saisi par l'utilisateur avant de le passer à `doc.text()`.
 */
function normalizeLineBreaks(text) {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : text;
}

// Les requêtes appelantes aliasent parfois les colonnes du bien joint en
// `property_label`/`property_address`, parfois en `label`/`address` : on
// accepte les deux pour ne pas dépendre d'une convention SQL précise.
function propertyLabel(property) {
  return property.property_label ?? property.label ?? property.designation_custom ?? property.designation ?? 'Bien';
}
function propertyAddress(property) {
  return property.property_address ?? property.address;
}

function formatDateFr(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS_FR[m - 1]} ${y}`;
}

/** Bail non-calendaire : « le premier jour de » (0) ou « N jours après le début de ». */
function rentDueOffsetPhrase(offsetDays) {
  const n = Number(offsetDays) || 0;
  if (n === 0) return 'le premier jour de';
  return `${n} jour${n > 1 ? 's' : ''} après le début de`;
}

/**
 * Libellé d'une période de loyer (étape 2c) : « octobre 2026 » pour une clé calendaire 'AAAA-MM',
 * « du 05 octobre au 04 novembre 2026 » pour une clé non-calendaire 'AAAA-MM-JJ' (début de période,
 * voir `rentTracking.js`) — l'année n'est répétée que si la période chevauche deux années.
 */
function formatPeriodLabel(periodKey) {
  if (/^\d{4}-\d{2}$/.test(periodKey)) return formatMonthLabel(periodKey);
  const end = periodEndOf(periodKey);
  const start = formatDateFr(periodKey);
  return `du ${periodKey.slice(0, 4) === end.slice(0, 4) ? start.slice(0, -5) : start} au ${formatDateFr(end)}`;
}

// Format jour/mois/année (JJ/MM/AAAA) — spécifiquement pour la date de
// téléchargement dans le pied de page (demande directe de l'utilisateur :
// « il faut toujours mettre le jour/mois/année de téléchargement des
// documents »), à ne pas confondre avec `formatDateFr` (mois en lettres),
// utilisé partout ailleurs pour des dates métier (paiement, échéance...).
function formatDateSlash(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/**
 * Heure d'un horodatage serveur (`DATETIME`, ex. `receipts.issued_at`) au
 * format « HH:MM » — MÊME piège que `frontend/lib/utils.ts` `formatTimeOfDay` :
 * le pool MySQL (`timezone: 'Z'`) étiquette ces horodatages en UTC alors
 * qu'ils sont déjà en heure locale (WAT) ; on relit donc les heures/minutes
 * en UTC (`getUTCHours`/`getUTCMinutes`) plutôt que la conversion locale du
 * process Node, sous peine d'un décalage à l'affichage.
 */
function formatTimeHm(date) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// `toLocaleString('fr-FR')` insère une espace fine insécable (U+202F) comme
// séparateur de milliers ; les polices standards PDF (Helvetica/WinAnsi) ne
// savent pas la représenter et affichent un artefact. On formate donc à la
// main avec une espace ASCII normale, sûre dans un PDF.
function formatFcfa(amount) {
  const n = Math.round(Number(amount));
  const grouped = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped} FCFA`;
}

/**
 * En-tête commun : fine barre d'accent en tête de page (touche « letterhead »
 * qui manquait totalement), logo (si présent), nom du cabinet, puis la ligne
 * d'identité légale (RCCM/IFU/téléphone) en Courier — ce sont des CODES, pas
 * du texte, ils bénéficient de l'alignement en chiffres fixes.
 */
function drawHeader(doc, tenant, opts = {}) {
  return D.drawBanner(doc, tenant, { title: opts.title ?? '', subtitle: opts.subtitle ?? null, meta: opts.meta ?? [] });
}

/**
 * Pied de page, sur TOUTES les pages (pas seulement la dernière comme avant
 * la refonte — un document de plusieurs pages n'avait aucun repère sur les
 * pages intermédiaires). Nécessite `bufferPages: true` à la création du
 * document ; à appeler une seule fois, juste avant `doc.end()`. Affiche
 * TOUJOURS la date de téléchargement (JJ/MM/AAAA, demande directe de
 * l'utilisateur) — les PDF de ce module n'étant jamais stockés mais générés
 * à la demande, cette date est simplement celle du jour, la même sur
 * chaque page d'un même document.
 */
/**
 * `verificationCode` (étape 29) : uniquement pour les documents remis à un
 * locataire/propriétaire via son portail (quittance, attestation, relevé
 * propriétaire) — jamais pour le PV de sortie ou le rapport comptable
 * (aucune remise à un tiers, aucune raison de vérification publique).
 * Ajoute une seconde ligne sous le pied de page existant plutôt que d'y
 * insérer le code : la marge basse (75pt) a été dimensionnée avec de la
 * marge, largement assez pour une ligne de plus sans chevaucher le contenu.
 */
function drawFooter(doc, { verificationCode } = {}) {
  D.finishDocument(doc, {
    verificationCode,
    frontendHost: config.frontendUrl.replace(/^https?:\/\//, ''),
    downloadDate: formatDateSlash(new Date().toISOString().slice(0, 10)),
  });
}

// Retourne la hauteur réellement occupée (la valeur peut passer sur plusieurs
// lignes, ex. bien loué + adresse) afin que l'appelant avance correctement.
// `mono` : la valeur est un CHIFFRE (date, montant, référence, téléphone) —
// rendue en Courier plutôt qu'en Helvetica, comme le reste de la refonte.
function drawRow(doc, label, value, y, { mono = false } = {}) {
  const valueFont = mono ? FONT_MONO_BOLD : FONT_SANS_BOLD;
  const valueHeight = doc.font(valueFont).fontSize(10).heightOfString(value, { width: 315 });
  doc.font(FONT_SANS).fontSize(10).fillColor(MUTED).text(label, 50, y, { width: 180 });
  doc.font(valueFont).fontSize(10).fillColor(INK).text(value, 230, y, { width: 315 });
  return Math.max(valueHeight, 14) + 8;
}

/**
 * Ligne de méta-données sous un titre (« N° QT-2026-0042 · émise le … ») :
 * alterne libellés discrets (Helvetica, gris) et valeurs-chiffres (Courier,
 * plus soutenues) sur une même ligne, via l'API « continued » de PDFKit.
 */
function drawMetaLine(doc, parts) {
  doc.fontSize(9);
  parts.forEach((part, i) => {
    doc
      .font(part.mono ? FONT_MONO_BOLD : FONT_SANS)
      .fillColor(part.mono ? INK_SOFT : MUTED)
      .text(part.text, { continued: i < parts.length - 1 });
  });
}

/** Carte à coins arrondis (fond doux, bordure fine) pour les blocs de
 * synthèse — remplace les anciens rectangles à angles vifs, plus « logiciel
 * pro » que « document Word ». */
function drawPanel(doc, x, y, width, height, { fill = SURFACE_MUTED, stroke = BORDER } = {}) {
  doc.roundedRect(x, y, width, height, 8).fillAndStroke(fill, stroke);
}

/** Une ligne libellé:valeur à l'intérieur d'un panneau de synthèse — libellé
 * discret à gauche, valeur en chiffres (Courier) à droite. */
function drawPanelRow(doc, label, value, x, y, { labelWidth = 280, valueWidth = 180, valueColor = INK, fontSize = 10 } = {}) {
  doc.font(FONT_SANS).fontSize(fontSize).fillColor(MUTED).text(label, x, y, { width: labelWidth });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(fontSize)
    .fillColor(valueColor)
    .text(value, x + labelWidth, y, { width: valueWidth, align: 'right' });
}

/** Carte de signature de l'émetteur (employé qui a encaissé, sinon cachet/signature de l'entreprise). */
function issuerCard(tenant, issuer, title) {
  return {
    title,
    name: issuer ? `${issuer.first_name} ${issuer.last_name}` : tenant.company_name,
    role: issuer ? resolveRoleLabels(tenant)[issuer.role] ?? issuer.role : null,
    signatureFile: D.imageIfExists(issuer?.signature_path || tenant.signature_path),
    stampFile: D.imageIfExists(issuer?.stamp_path || tenant.stamp_path),
  };
}

/**
 * Gabarit commun des reçus (quittance, reçu d'entrée, fiche de paie, avis de paiement, reçu de charges) —
 * même mise en page partout : bandeau, mention, parties, détail en tableau, montant principal, montant en
 * lettres, note, signature. `lines` : { columns, rows } ; `total` : { label, amount } ; `wordsPrefix` : début de
 * la phrase « Arrêté … à la somme de ».
 */
function renderReceiptDocument(res, { tenant, filename, title, subtitle, meta, intro, partiesLabel = 'Parties', parties, detailLabel = 'Détail', lines, total, wordsPrefix, note, signatureTitle, issuer, verificationCode, extraRows = null }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);

  let y = D.drawBanner(doc, tenant, { title, subtitle, meta });
  if (intro) {
    doc.font(D.F.SANS).fontSize(9.5).fillColor(D.C.INK_SOFT).text(intro.prefix, D.LEFT, y, { continued: true });
    doc.font(D.F.BOLD).fillColor(D.C.INK).text(intro.bold);
    y = doc.y + 16;
  }
  y = D.drawSection(doc, y, partiesLabel);
  y = D.drawInfoGrid(doc, y, parties);
  y = D.drawSection(doc, y, detailLabel);
  y = D.drawTable(doc, y, lines.columns, lines.rows);
  if (extraRows) y = D.drawTable(doc, y, extraRows.columns, extraRows.rows);
  y = D.drawTotalBar(doc, y, total.label, total.amount);
  y = D.drawWordsLine(doc, y, total.raw, wordsPrefix);
  if (note) y = D.drawNote(doc, y + 2, null, note);
  y = D.drawSignatureCards(doc, y, [issuerCard(tenant, issuer, signatureTitle)], { section: false });

  drawFooter(doc, { verificationCode });
  doc.end();
}

/**
 * Quittance de loyer (un paiement = une quittance). Deuxième refonte demandée
 * par l'utilisateur, référence cette fois un modèle de facture professionnel
 * (logo+société / gros titre+date sur la même ligne, bloc identité/bloc
 * destinataire, tableau à en-tête colorée, total mis en évidence dans une
 * barre pleine couleur, note, ligne de remerciement). Adapté au fait qu'une
 * quittance certifie un paiement DÉJÀ reçu (pas une facture à régler) :
 * aucun sous-total/TVA/remise (n'existe pas pour un loyer au Bénin), et
 * aucun bloc « comment payer » (sans objet ici) — remplacé par le
 * cachet/signature déjà existant. Décisions explicites de l'utilisateur :
 * le bloc « adresse du cabinet » du modèle reste RCCM/IFU/téléphone (aucune
 * adresse en base), le bloc « informations de paiement » devient le
 * cachet/signature (aucune coordonnée bancaire en base, et sans objet sur
 * une preuve de paiement déjà réglé).
 *
 * `issuer` : l'employé qui a réellement encaissé ce paiement précis
 * (`rent_payments.recorded_by`) — son cachet/sa signature/son nom sont
 * apposés s'il les a téléversés (`/api/auth/my-profile`), sinon on retombe
 * sur ceux de l'entreprise (`tenant.stamp_path`/`signature_path`), comme
 * avant cette fonctionnalité.
 */
function streamReceiptPdf(res, { tenant, renter, property, lease, payment, receipt, issuer, verificationCode }) {
  // Bail calendaire : nom du mois ; bail non-calendaire : plage de dates réelle de la période
  // (étape 2c — `covers_month` y est NULL, voir migration 085).
  const periodKey = paymentPeriodKey(payment);
  const monthLabel = periodKey ? formatPeriodLabel(periodKey) : '—';
  // Date ET heure de DÉLIVRANCE de cette quittance (`receipts.issued_at`) — jamais la date du paiement.
  const issuedOn = formatDateFr(receipt.issued_at.toISOString().slice(0, 10));
  const issuedAt = `${issuedOn} à ${formatTimeHm(receipt.issued_at)}`;
  const method = PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method;
  renderReceiptDocument(res, {
    tenant,
    filename: `${receipt.receipt_number}.pdf`,
    title: 'QUITTANCE DE LOYER',
    subtitle: `Période : ${monthLabel}`,
    meta: [['N° de reçu', receipt.receipt_number], verificationCode ? ['Code de vérification', verificationCode] : ['Délivrée le', issuedOn]],
    intro: { prefix: 'Quittance délivrée le ', bold: issuedAt },
    parties: [
      ['Locataire', `${renter.first_name} ${renter.last_name}`],
      ['Bien loué', `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`],
      ['Unité', property.unit_code ?? '—'],
      ['Bailleur / mandataire', tenant.company_name],
      ['Réglé par', method],
      ['Téléphone du locataire', renter.phone ?? '—'],
    ],
    detailLabel: 'Détail du règlement',
    lines: {
      columns: [
        { label: 'Désignation', width: 235 },
        { label: 'Période', width: 160 },
        { label: 'Montant', width: 100, align: 'right', bold: true },
      ],
      rows: [['Loyer', monthLabel, D.fcfa(payment.amount)]],
    },
    total: { label: 'Montant reçu', amount: D.fcfa(payment.amount), raw: payment.amount },
    wordsPrefix: 'Arrêtée la présente quittance à la somme de',
    note:
      `L'entreprise ${tenant.company_name} certifie avoir reçu de ${renter.first_name} ${renter.last_name} ` +
      `la somme ci-dessus au titre du loyer de ${propertyLabel(property)}, pour la période mentionnée. Merci pour votre confiance.`,
    signatureTitle: 'Le bailleur / mandataire',
    issuer,
    verificationCode,
  });
}

/**
 * Reçu d'entrée (demande utilisateur, 2026-10-17) : à la signature d'un bail, caution, frais
 * d'agence, cautions supplémentaires (SBEE/SONEB/peinture) et prorata de loyer sont chacun de vrais
 * mouvements de trésorerie, mais aucun ne produisait de reçu jusqu'ici (seul un paiement de loyer
 * ultérieur, via `streamReceiptPdf`, en génère un). Un seul document regroupe désormais tout ce qui a
 * été réellement payé ce jour-là. Même gabarit visuel que `streamReceiptPdf` (bande couleur, logo/
 * société, cabinet/destinataire, tableau, total, signature, pied de page) — adapté à plusieurs lignes
 * au lieu d'une seule, et sans les colonnes P.U./Mois (sans objet hors loyer).
 *
 * `entryReceipt` : la ligne `lease_entry_receipts` (son `snapshot` fige `{lines, total}` au moment de
 * la création du bail — jamais recalculé, même principe que `lease_contracts.snapshot`).
 */
function streamEntryReceiptPdf(res, { tenant, renter, property, lease, entryReceipt, issuer, verificationCode }) {
  const snapshot = entryReceipt.snapshot;
  const issuedOn = formatDateFr(entryReceipt.issued_at.toISOString().slice(0, 10));
  renderReceiptDocument(res, {
    tenant,
    filename: `${entryReceipt.receipt_number}.pdf`,
    title: "REÇU D'ENTRÉE",
    subtitle: 'Signature du bail — sommes réglées à l\'entrée',
    meta: [['N° de reçu', entryReceipt.receipt_number], verificationCode ? ['Code de vérification', verificationCode] : ['Délivré le', issuedOn]],
    intro: { prefix: 'Reçu délivré le ', bold: `${issuedOn} à ${formatTimeHm(entryReceipt.issued_at)}` },
    parties: [
      ['Locataire', `${renter.first_name} ${renter.last_name}`],
      ['Bien loué', `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`],
      ['Unité', property.unit_code ?? '—'],
      ['Bailleur / mandataire', tenant.company_name],
      ['Début du bail', lease?.start_date ? formatDateFr(isoDay(lease.start_date)) : '—'],
      ['Téléphone du locataire', renter.phone ?? '—'],
    ],
    detailLabel: 'Sommes réglées à l\'entrée',
    lines: {
      columns: [
        { label: 'Désignation', width: 395 },
        { label: 'Montant', width: 100, align: 'right', bold: true },
      ],
      rows: snapshot.lines.map((line) => [line.label, D.fcfa(line.amount)]),
    },
    total: { label: 'Total payé', amount: D.fcfa(snapshot.total), raw: snapshot.total },
    wordsPrefix: 'Arrêté le présent reçu à la somme de',
    note:
      `L'entreprise ${tenant.company_name} certifie avoir reçu de ${renter.first_name} ${renter.last_name} ` +
      `la somme ci-dessus à la signature du bail de ${propertyLabel(property)}. Les frais d'agence sont ` +
      `non remboursables ; les cautions sont restituables selon les conditions du bail.`,
    signatureTitle: 'Le bailleur / mandataire',
    issuer,
    verificationCode,
  });
}

/**
 * Fiche de paie (demande utilisateur, 2026-10-18) : document interne remis à l'employé, jamais à un
 * tiers (propriétaire/locataire) — donc PAS de code de vérification publique (même principe que le
 * PV de sortie/le rapport comptable ci-dessus, voir le commentaire de `drawFooter`). Signée par le
 * DG (`issuer`, toujours le compte qui a enregistré le paiement, donc toujours le DG ici — voir
 * `requireRole('dg')` sur `routes/payslips.js`), avec repli sur la signature/cachet de l'entreprise
 * si le DG n'a pas encore téléversé la sienne (« Mon compte »), même logique que `streamEntryReceiptPdf`.
 */
function streamPayslipPdf(res, { tenant, employee, payslip, issuer }) {
  const roleLabels = resolveRoleLabels(tenant);
  const paidAtIso = payslip.paid_at instanceof Date ? payslip.paid_at.toISOString().slice(0, 10) : String(payslip.paid_at).slice(0, 10);
  const rows = [['Salaire de base', D.fcfa(payslip.base_amount)]];
  if (Number(payslip.bonus_amount) > 0) rows.push([payslip.bonus_label || 'Prime', D.fcfa(payslip.bonus_amount)]);
  rows.push(['Salaire brut', D.fcfa(payslip.gross_amount)]);
  if (Number(payslip.deduction_amount) > 0) rows.push([payslip.deduction_label || 'Retenue', `- ${D.fcfa(payslip.deduction_amount)}`]);
  renderReceiptDocument(res, {
    tenant,
    filename: `fiche-de-paie-${payslip.period}-${employee.id}.pdf`,
    title: 'FICHE DE PAIE',
    subtitle: formatMonthLabel(payslip.period),
    meta: [['Période', formatMonthLabel(payslip.period)], ['Date de règlement', formatDateFr(paidAtIso)]],
    intro: { prefix: 'Salaire de ', bold: formatMonthLabel(payslip.period) },
    partiesLabel: 'Employeur et employé',
    parties: [
      ['Employé', `${employee.first_name} ${employee.last_name}`],
      ['Fonction', roleLabels[employee.role] ?? employee.role],
      ['Identifiant', employee.identifier ?? '—'],
      ['Employeur', tenant.company_name],
      ['Mode de règlement', PAYMENT_METHOD_LABELS[payslip.payment_method] ?? payslip.payment_method],
      ['Date de règlement', formatDateFr(paidAtIso)],
    ],
    detailLabel: 'Détail de la rémunération',
    lines: {
      columns: [
        { label: 'Désignation', width: 395 },
        { label: 'Montant', width: 100, align: 'right', bold: true },
      ],
      rows,
    },
    total: { label: 'Net à payer', amount: D.fcfa(payslip.net_amount), raw: payslip.net_amount },
    wordsPrefix: 'Arrêtée la présente fiche à la somme de',
    note:
      `${tenant.company_name} certifie avoir versé à ${employee.first_name} ${employee.last_name} la somme ` +
      `ci-dessus au titre de son salaire de ${formatMonthLabel(payslip.period)}, réglée par ` +
      `${PAYMENT_METHOD_LABELS[payslip.payment_method] ?? payslip.payment_method}.`,
    signatureTitle: "L'employeur",
    issuer,
  });
}

function isoDay(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Avis de paiement (ordre sortant FedaPay confirmé `sent`). Le numéro Mobile Money est TOUJOURS masqué ;
 * aucune clé ni identifiant technique n'y figure.
 */
function streamPaymentAdvicePdf(res, { tenant, order }) {
  const purposeLabels = { salaire: 'Salaire', reversement_proprietaire: 'Reversement propriétaire', reversement_charges: 'Reversement de charges', autre: 'Paiement' };
  const sentOn = formatDateFr(isoDay(order.sent_at));
  renderReceiptDocument(res, {
    tenant,
    filename: `avis-paiement-${order.reference}.pdf`,
    title: 'AVIS DE PAIEMENT',
    subtitle: purposeLabels[order.purpose] ?? 'Paiement',
    meta: [['Référence', order.reference], ['Envoyé le', sentOn]],
    intro: { prefix: "Envoi confirmé par le prestataire de paiement le ", bold: sentOn },
    partiesLabel: 'Bénéficiaire',
    parties: [
      ['Bénéficiaire', order.beneficiary_name],
      ['Compte Mobile Money', `${String(order.operator).toUpperCase()} ${order.beneficiary_phone_masked}`],
      ['Émetteur', tenant.company_name],
    ],
    detailLabel: 'Détail du paiement',
    lines: {
      columns: [
        { label: 'Motif', width: 335 },
        { label: 'Montant', width: 160, align: 'right', bold: true },
      ],
      rows: [[order.label, D.fcfa(order.amount)]],
    },
    total: { label: 'Montant versé', amount: D.fcfa(order.amount), raw: order.amount },
    wordsPrefix: 'Arrêté le présent avis à la somme de',
    note: "Document généré automatiquement. Il atteste de l'envoi des fonds par le prestataire de paiement à la date indiquée.",
    signatureTitle: tenant.company_name,
    issuer: null,
  });
}

/**
 * Reçu de sortie d'argent saisie manuellement (reversement, dépense, restitution de caution) : atteste du montant,
 * du bénéficiaire, du mode de règlement et de la date. Pas de numéro de compte.
 */
function streamOperationReceiptPdf(res, { tenant, op }) {
  const methodLabels = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };
  const dateFr = formatDateFr(op.date);
  renderReceiptDocument(res, {
    tenant,
    filename: `recu-${op.kind}-${op.id}.pdf`,
    title: 'REÇU DE PAIEMENT',
    subtitle: op.kindLabel,
    meta: [['N°', `${op.kind.toUpperCase().slice(0, 3)}-${String(op.id).padStart(6, '0')}`], ['Date', dateFr]],
    intro: { prefix: 'Règlement effectué le ', bold: dateFr },
    partiesLabel: 'Parties',
    parties: [
      ['Bénéficiaire', op.beneficiary || '—'],
      ['Mode de règlement', methodLabels[op.method] ?? op.method ?? '—'],
      ['Émetteur', tenant.company_name],
    ],
    detailLabel: 'Détail',
    lines: {
      columns: [{ label: 'Motif', width: 335 }, { label: 'Montant', width: 160, align: 'right', bold: true }],
      rows: [[op.label, D.fcfa(op.amount)]],
    },
    total: { label: 'Montant réglé', amount: D.fcfa(op.amount), raw: op.amount },
    wordsPrefix: 'Arrêté le présent reçu à la somme de',
    note: op.note ?? 'Document généré automatiquement.',
    signatureTitle: tenant.company_name,
    issuer: null,
  });
}

/** Facture d'abonnement Africa Immo Management, remise à l'entreprise cliente. */
function streamSubscriptionInvoicePdf(res, { client, payment, planLabel }) {
  const paidOn = formatDateFr(isoDay(payment.paid_at));
  const LEGAL = require('../config/env').legal;
  const platform = { company_name: LEGAL.name };
  renderReceiptDocument(res, {
    tenant: platform,
    filename: `${payment.invoice_number}.pdf`,
    title: 'FACTURE',
    subtitle: 'Abonnement Africa Immo Management',
    meta: [['N° de facture', payment.invoice_number], ['Payée le', paidOn]],
    intro: { prefix: 'Facture acquittée le ', bold: paidOn },
    partiesLabel: 'Client',
    parties: [
      ['Entreprise', client.company_name],
      ['RCCM / IFU', [client.rccm, client.ifu].filter(Boolean).join(' / ') || '—'],
      ['Référence de paiement', payment.reference],
      // Identité fiscale de l'émetteur (renseignée via PLATFORM_LEGAL_* ; absente tant qu'elle n'est pas configurée).
      ...[['Émetteur', LEGAL.name], ['RCCM / IFU émetteur', [LEGAL.rccm, LEGAL.ifu].filter(Boolean).join(' / ')], ['Adresse émetteur', LEGAL.address]]
        .filter(([, v]) => v),
    ],
    detailLabel: 'Détail',
    lines: {
      columns: [
        { label: 'Désignation', width: 235 },
        { label: 'Durée', width: 120 },
        { label: 'Montant', width: 140, align: 'right', bold: true },
      ],
      rows: [[`Abonnement ${planLabel}${payment.founder_price ? ' (tarif fondateur)' : ''}`, `${payment.months} mois`, D.fcfa(payment.amount)]],
    },
    total: { label: 'Total payé', amount: D.fcfa(payment.amount), raw: payment.amount },
    wordsPrefix: 'Arrêtée la présente facture à la somme de',
    note: 'Facture acquittée : le paiement a été confirmé par le prestataire de paiement. Document généré automatiquement.',
    signatureTitle: 'Africa Immo Management',
    issuer: null,
  });
}

/** Reçu du règlement d'une facture SONEB/SBEE, remis au locataire (portail). */
function streamChargeReceiptPdf(res, { tenant, renter, charge, payment }) {
  const fluide = charge.utility_type === 'soneb' ? 'SONEB (eau)' : 'SBEE (électricité)';
  const paidOn = formatDateFr(isoDay(payment.paid_at));
  renderReceiptDocument(res, {
    tenant,
    filename: `recu-charges-${payment.id}.pdf`,
    title: 'REÇU DE CHARGES',
    subtitle: fluide,
    meta: [['N° de reçu', `CHG-${payment.id}`], ['Réglé le', paidOn]],
    intro: { prefix: 'Règlement reçu le ', bold: paidOn },
    parties: [
      ['Locataire', `${renter.first_name} ${renter.last_name}`],
      ['Facture', fluide],
      ['Bailleur / mandataire', tenant.company_name],
    ],
    detailLabel: 'Détail du règlement',
    lines: {
      columns: [
        { label: 'Désignation', width: 235 },
        { label: 'Période', width: 160 },
        { label: 'Montant', width: 100, align: 'right', bold: true },
      ],
      rows: [[`Facture ${fluide}`, `${formatDateFr(isoDay(charge.period_start))} au ${formatDateFr(isoDay(charge.period_end))}`, D.fcfa(payment.amount)]],
    },
    total: { label: 'Montant réglé', amount: D.fcfa(payment.amount), raw: payment.amount },
    wordsPrefix: 'Arrêté le présent reçu à la somme de',
    note: 'Reçu généré automatiquement pour le règlement de cette facture. Conservez-le comme preuve de paiement.',
    signatureTitle: 'Le bailleur / mandataire',
    issuer: null,
  });
}

/** « Article N — Titre », puis le corps — page neuve avant le titre s'il ne reste pas assez de place
 * pour au moins amorcer le paragraphe (jamais un titre orphelin en bas de page). */
function drawContractArticle(doc, number, title, body) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
  doc.font(FONT_SANS_BOLD).fontSize(11.5).fillColor(PRIMARY).text(`Article ${number} — ${title}`, 50, doc.y, { width: 495 });
  doc.moveDown(0.35);
  doc.font(FONT_SANS).fontSize(10).fillColor(INK).text(body, 50, doc.y, { width: 495, align: 'justify', lineGap: 2 });
  doc.moveDown(1);
}

/**
 * Contrat de bail (étape 46) — remplace l'ancienne attestation de loyer (lettre unilatérale à texte
 * libre). Document structuré par articles, calculés depuis `data` (voir `services/leaseContract.js`
 * `buildContractData` — LIVE en brouillon, figé dans `snapshot` une fois finalisé, mais EXACTEMENT la
 * même forme dans les deux cas, donc le même rendu ici). Signé par les deux parties.
 */
function streamLeaseContractPdf(res, { tenant, data, contract, issuer, leaseId, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="contrat-bail-${data.renter.lastName}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant, {
    title: 'CONTRAT DE BAIL',
    subtitle: contract.status === 'finalized' ? "Bail d'habitation — signé" : "Bail d'habitation — projet",
    meta: [
      ['Référence', `BAIL-${String(leaseId).padStart(5, '0')}`],
      [
        contract.status === 'finalized' ? 'Signé le' : 'Rédigé le',
        formatDateFr((contract.status === 'finalized' ? contract.finalizedAt : contract.createdAt).toISOString().slice(0, 10)),
      ],
      ...(verificationCode ? [['Code de vérification', verificationCode]] : []),
    ],
  });

  if (contract.status !== 'finalized') {
    doc
      .font(FONT_SANS_BOLD)
      .fontSize(9)
      .fillColor(WARNING_FG)
      .text('PROJET — NON SIGNÉ, à relire avant signature des deux parties.', 50, doc.y);
    doc.moveDown(0.8);
  }

  // --- Récapitulatif : les faits essentiels en un coup d'œil. ---
  let y = doc.y;
  y += drawRow(doc, 'Bailleur', data.owner.name, y);
  y += drawRow(doc, 'Locataire', `${data.renter.firstName} ${data.renter.lastName}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${data.property.code}${data.property.address ? ', ' + data.property.address : ''} — ${data.unit.designationLabel} (${data.unit.code})`,
    y,
  );
  y += drawRow(doc, 'Loyer mensuel', formatFcfa(data.lease.monthlyRent), y, { mono: true });
  doc.y = y + 12;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  doc.moveDown(1);

  const ownerAddressPart = data.owner.address ? `, domicilié à ${data.owner.address}` : '';
  drawContractArticle(
    doc,
    1,
    'Les parties',
    `Entre les soussignés : d'une part, ${data.owner.name}${ownerAddressPart}, propriétaire du bien désigné ` +
      `à l'article 2, représenté aux fins des présentes par l'entreprise ${tenant.company_name} ` +
      `(RCCM ${tenant.rccm}, IFU ${tenant.ifu}), ci-après dénommé « le Bailleur » ; et d'autre part, ` +
      `${data.renter.firstName} ${data.renter.lastName}, joignable au ${data.renter.phone}, ci-après ` +
      `dénommé « le Locataire ». Il a été convenu ce qui suit.`,
  );

  const meterParts = [];
  if (data.unit.sonebMeterNumber) meterParts.push(`compteur SONEB n° ${data.unit.sonebMeterNumber}`);
  if (data.unit.sbeeMeterNumber) meterParts.push(`compteur SBEE n° ${data.unit.sbeeMeterNumber}`);
  drawContractArticle(
    doc,
    2,
    'Objet du contrat',
    `Le Bailleur donne à bail au Locataire, qui accepte, le bien désigné « ${data.unit.designationLabel} » ` +
      `(${data.unit.code}) au sein de l'immeuble ${data.property.code} (${data.property.typeLabel})` +
      `${data.property.address ? `, sis ${data.property.address}` : ''}, livré ${data.unit.furnished ? 'meublé' : 'non meublé'}` +
      `${meterParts.length > 0 ? `, équipé des compteurs suivants : ${meterParts.join(', ')}` : ''}. Le Locataire déclare avoir ` +
      `visité les lieux et les accepter en l'état constaté par l'état des lieux d'entrée établi séparément.`,
  );

  drawContractArticle(
    doc,
    3,
    'Durée et prise d’effet',
    `Le présent bail prend effet le ${formatDateFr(data.lease.startDate)}, pour une durée indéterminée. ` +
      `Chaque partie peut y mettre fin dans les conditions prévues à l'article 8 ci-après.`,
  );

  drawContractArticle(
    doc,
    4,
    'Loyer et modalités de paiement',
    `Le loyer mensuel est fixé à ${formatFcfa(data.lease.monthlyRent)}, payable ${data.lease.rentTimingLabel.toLowerCase()}, ` +
      (data.lease.rentDueDay != null
        ? `au plus tard le ${data.lease.rentDueDay} de chaque mois concerné.`
        : `au plus tard ${rentDueOffsetPhrase(data.lease.rentDueOffsetDays)} chaque période concernée.`) +
      (data.lease.entryFeeAmount > 0
        ? ` Des frais d'agence de ${formatFcfa(data.lease.entryFeeAmount)}, dus une seule fois à la signature, ` +
          `restent intégralement acquis à l'entreprise et ne sont pas restituables.`
        : ''),
  );

  const depositLines = [];
  if (data.lease.depositAmount > 0) depositLines.push(`une caution de loyer de ${formatFcfa(data.lease.depositAmount)}`);
  for (const d of data.additionalDeposits) depositLines.push(`une caution ${d.typeLabel} de ${formatFcfa(d.amount)}`);
  drawContractArticle(
    doc,
    5,
    'Caution(s)',
    depositLines.length > 0
      ? `Le Locataire verse, à la signature, ${depositLines.join(', ')}. Chaque caution est intégralement restituable ` +
        `en fin de bail, déduction faite des dégradations et/ou impayés constatés à la sortie (état des lieux ` +
        `contradictoire), dans les conditions détaillées sur le décompte remis au Locataire à cette occasion.`
      : `Aucune caution n'est exigée à la signature du présent bail.`,
  );

  drawContractArticle(
    doc,
    6,
    'Obligations du Locataire',
    `Le Locataire s'engage à : payer le loyer et les charges aux échéances convenues ; occuper les lieux ` +
      `personnellement et paisiblement, sans les sous-louer ni les céder sans l'accord écrit préalable du ` +
      `Bailleur ; entretenir le logement et le rendre, à son départ, dans l'état constaté à son entrée, sauf ` +
      `vétusté normale ; signaler sans délai toute dégradation ou panne constatée ; permettre l'accès au ` +
      `logement pour toute visite ou réparation justifiée, sur préavis raisonnable.`,
  );

  drawContractArticle(
    doc,
    7,
    'Obligations du Bailleur',
    `Le Bailleur s'engage à : délivrer un logement décent et en bon état d'usage ; assurer la jouissance ` +
      `paisible des lieux au Locataire ; prendre en charge les grosses réparations qui ne résultent pas d'un ` +
      `défaut d'entretien du Locataire ; restituer la ou les cautions dans les conditions de l'article 5.`,
  );

  drawContractArticle(
    doc,
    8,
    'Résiliation',
    `Chaque partie peut résilier le présent bail moyennant un préavis raisonnable notifié par écrit à l'autre ` +
      `partie. À la sortie du Locataire, un état des lieux contradictoire est établi ; le décompte de la ou des ` +
      `cautions en découle, selon les conditions de l'article 5.`,
  );

  if (data.particularConditions && data.particularConditions.trim()) {
    drawContractArticle(doc, 9, 'Conditions particulières', normalizeLineBreaks(data.particularConditions));
  }

  // --- Signatures des deux parties, jamais coupées entre deux pages. ---
  const SIGNATURE_BLOCK_HEIGHT = 150;
  if (doc.y + SIGNATURE_BLOCK_HEIGHT > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(0.5);
  doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('Fait en deux exemplaires originaux, chacune des parties reconnaissant en avoir reçu un.', 50, doc.y, { width: 495 });
  doc.moveDown(1.2);

  const sigTop = doc.y;
  doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(MUTED).text('LE LOCATAIRE', 50, sigTop, { characterSpacing: 0.5 });
  doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(MUTED).text('POUR LE BAILLEUR (LE CABINET)', 315, sigTop, { characterSpacing: 0.5 });

  const tenantSigUrl = contract.tenantSignatureUrl;
  const agentSigUrl = contract.agentSignatureUrl;
  const sigImgY = sigTop + 16;
  if (tenantSigUrl) {
    const f = uploadedFile(tenantSigUrl);
    if (fs.existsSync(f)) {
      try {
        doc.image(f, 50, sigImgY, { fit: [200, 55] });
      } catch {
        // Signature illisible : on continue sans (page déjà valide sans elle).
      }
    }
  } else {
    doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('_________________________', 50, sigImgY + 30);
  }

  const signatureFile = issuer?.signature_path
    ? path.join(UPLOADS_ROOT, issuer.signature_path)
    : tenant.signature_path
      ? path.join(UPLOADS_ROOT, tenant.signature_path)
      : null;
  const stampFile = issuer?.stamp_path
    ? path.join(UPLOADS_ROOT, issuer.stamp_path)
    : tenant.stamp_path
      ? path.join(UPLOADS_ROOT, tenant.stamp_path)
      : null;
  if (agentSigUrl) {
    const f = uploadedFile(agentSigUrl);
    if (fs.existsSync(f)) {
      try {
        doc.image(f, 315, sigImgY, { fit: [130, 45] });
      } catch {
        // Signature illisible : repli sur celle de l'entreprise ci-dessous.
      }
    }
  } else if (signatureFile && fs.existsSync(signatureFile)) {
    try {
      doc.image(signatureFile, 315, sigImgY, { fit: [130, 45] });
    } catch {
      // Signature illisible : ligne à signer par défaut.
    }
  } else {
    doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('_________________________', 315, sigImgY + 30);
  }
  if (stampFile && fs.existsSync(stampFile)) {
    try {
      doc.opacity(0.9).image(stampFile, 400, sigImgY - 10, { fit: [100, 100] }).opacity(1);
    } catch {
      // Cachet illisible : on continue sans (pas bloquant).
    }
  }
  if (issuer?.role) {
    doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(INK).text(`${issuer.first_name} ${issuer.last_name}`, 315, sigImgY + 55);
    doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text(resolveRoleLabels(tenant)[issuer.role] ?? issuer.role, 315, sigImgY + 68);
  }

  drawFooter(doc, { verificationCode });
  doc.end();
}

// Étape 13 (idée n°9, refonte par zones) : BE/ME/SR, échelle ordonnée
// BE > SR > ME (voir constants/inspection.js) — reprise ici uniquement pour
// l'affichage, cette échelle n'a pas besoin d'être importée pour ça.
const CONDITION_LABELS = { BE: 'Bon état', ME: 'Mauvais état', SR: 'Sous réserve' };
const CONDITION_COLORS = { BE: SUCCESS_FG, ME: DANGER_FG, SR: WARNING_FG };

/**
 * Chemin disque d'un fichier téléversé référencé par son URL `/uploads/...`
 * (fichiers restés publics : logo, photos marketplace) ou `/api/files/...`
 * (fichiers désormais authentifiés — audit sécurité, étape 49) — accepte les
 * deux préfixes, cette fonction lit toujours directement sur disque, jamais
 * via HTTP, donc le contrôle d'accès de la route ne la concerne pas.
 */
function uploadedFile(publicUrl) {
  return publicUrl ? path.join(UPLOADS_ROOT, publicUrl.replace(/^\/(uploads|api\/files)\//, '')) : null;
}

/**
 * PV de sortie & décompte de caution (section 6, Sorties de locataires ;
 * refondu étape 13 idée n°9 avec la grille par zones + signatures). `report`
 * est la forme publique (`toPublicMoveOutReport`) : `zones`, `conductedAt`
 * (chaîne AAAA-MM-JJ), `tenantSignatureUrl`/`agentSignatureUrl`, etc. —
 * jamais la ligne SQL brute. Le rapport est figé à la finalisation (montants
 * stockés, jamais recalculés ici).
 */
const ADDITIONAL_DEPOSIT_PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
};

const CONDITION_BG = { BE: '#ECFDF5', ME: '#FEF2F2', SR: '#FFFBEB' };
const CONTENT_LEFT = 50;
const CONTENT_WIDTH = 495;

/** Passe à une nouvelle page si `needed` points ne tiennent plus sous `y` ; renvoie le `y` utilisable. */
function ensureSpace(doc, y, needed) {
  if (y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

/** Pastille d'état (pastille de couleur + libellé sur fond teinté). Renvoie sa largeur. */
function drawConditionPill(doc, condition, x, y) {
  const label = condition ? CONDITION_LABELS[condition] : 'Non renseigné';
  const color = condition ? CONDITION_COLORS[condition] : MUTED;
  const bg = condition ? CONDITION_BG[condition] : SURFACE_MUTED;
  doc.font(FONT_SANS_BOLD).fontSize(7.5);
  const w = doc.widthOfString(label) + 19;
  doc.roundedRect(x, y, w, 15, 7.5).fill(bg);
  doc.circle(x + 7.5, y + 7.5, 2.4).fill(color);
  doc.fillColor(color).text(label, x + 13, y + 4.2, { lineBreak: false });
  return w;
}

/**
 * Cadre d'identification d'une fiche (étape 56) : grille deux colonnes libellé/valeur, plus lisible
 * qu'une suite de lignes. `rows` : paires [libellé, valeur] lues de gauche à droite.
 */
function drawInfoPanel(doc, rows, y) {
  y = ensureSpace(doc, y, 60);
  y = D.drawSection(doc, y, 'Informations générales');
  return D.drawInfoGrid(doc, y, rows);
}

/** Résumé chiffré d'une fiche : pièces, puis éléments par état — l'essentiel lisible en un coup d'œil. */
function drawInspectionSummary(doc, zones, y) {
  const counts = { BE: 0, SR: 0, ME: 0 };
  for (const zone of zones) for (const item of zone.items) if (item.condition) counts[item.condition] += 1;
  y = ensureSpace(doc, y, 90);
  y = D.drawSection(doc, y, "Synthèse de l'état des lieux");
  return D.drawStatTiles(doc, y, [
    { label: zones.length > 1 ? 'Pièces' : 'Pièce', value: zones.length, color: D.C.ACCENT, bg: D.C.TINT },
    { label: 'Bon état', value: counts.BE, color: D.C.SUCCESS, bg: D.C.SUCCESS_BG },
    { label: 'Sous réserve', value: counts.SR, color: D.C.WARNING, bg: D.C.WARNING_BG },
    { label: 'Mauvais état', value: counts.ME, color: D.C.DANGER, bg: D.C.DANGER_BG },
  ]);
}

/**
 * Grille zones/éléments partagée entre le PV d'entrée et celui de sortie (étape 48, refaite en tableau
 * à l'étape 56 : « les PDF générés doivent être bien propres, bien designés »). Chaque pièce : un
 * bandeau-titre, puis un tableau Élément / État / Observations (+ Retenue à la sortie), lignes zébrées,
 * état en pastille de couleur, photos sous l'observation. Une pièce coupée par un saut de page reprend
 * son bandeau « (suite) » et ses en-têtes de colonnes. `moveInConditionByKey` (sortie) affiche l'état
 * d'entrée sous celui de sortie quand il a changé. Retourne le `y` après la dernière pièce.
 */
function drawInspectionZones(doc, zones, y, { moveInConditionByKey = null, showBilling = false } = {}) {
  const cols = showBilling
    ? [
        { key: 'label', title: 'Élément', x: CONTENT_LEFT, w: 135 },
        { key: 'state', title: 'État', x: CONTENT_LEFT + 135, w: 115 },
        { key: 'obs', title: 'Observations', x: CONTENT_LEFT + 250, w: 165 },
        { key: 'amount', title: 'Retenue (FCFA)', x: CONTENT_LEFT + 415, w: 80 },
      ]
    : [
        { key: 'label', title: 'Élément', x: CONTENT_LEFT, w: 165 },
        { key: 'state', title: 'État', x: CONTENT_LEFT + 165, w: 105 },
        { key: 'obs', title: 'Observations', x: CONTENT_LEFT + 270, w: 225 },
      ];
  const col = Object.fromEntries(cols.map((c) => [c.key, c]));
  const PAD = 7;

  function drawZoneHeader(zone, yy, continued) {
    doc.roundedRect(CONTENT_LEFT, yy, CONTENT_WIDTH, 24, 4).fill(PRIMARY_BG);
    doc.rect(CONTENT_LEFT, yy, 3, 24).fill(PRIMARY);
    doc.font(FONT_SANS_BOLD).fontSize(10.5).fillColor(PRIMARY).text(`${zone.label}${continued ? ' (suite)' : ''}`, CONTENT_LEFT + 12, yy + 7, { width: 330, lineBreak: false });
    const good = zone.items.filter((it) => it.condition === 'BE').length;
    doc
      .font(FONT_SANS)
      .fontSize(8)
      .fillColor(INK_SOFT)
      .text(`${zone.items.length} élément${zone.items.length > 1 ? 's' : ''} · ${good} en bon état`, CONTENT_LEFT + 300, yy + 8.5, { width: 185, align: 'right', lineBreak: false });
    yy += 24;
    // En-tête de colonnes : bandeau bleu plein, texte blanc (même design que le tableau des impayés).
    doc.rect(CONTENT_LEFT, yy, CONTENT_WIDTH, 20).fill(PRIMARY);
    for (const c of cols) {
      doc
        .font(FONT_SANS_BOLD)
        .fontSize(8.5)
        .fillColor('#FFFFFF')
        .text(c.title, c.x + PAD, yy + 6, { width: c.w - PAD * 2, align: c.key === 'amount' ? 'right' : 'left', lineBreak: false });
    }
    yy += 20;
    return yy;
  }

  for (const zone of zones) {
    y = ensureSpace(doc, y, 90);
    y = drawZoneHeader(zone, y, false);

    zone.items.forEach((item, idx) => {
      const moveInCondition = moveInConditionByKey ? moveInConditionByKey.get(`${zone.key}::${item.key}`) ?? null : null;
      const showTransition = !!moveInCondition && moveInCondition !== item.condition;
      const comment = item.comment ? normalizeLineBreaks(item.comment) : '';
      const billingLines = showBilling && item.billing?.lines?.length > 0 ? item.billing.lines : [];
      const photos = item.photoUrls ?? [];

      const labelH = doc.font(FONT_SANS_BOLD).fontSize(9).heightOfString(item.label, { width: col.label.w - PAD * 2 });
      const stateH = showTransition ? 32 : 15;
      const commentH = comment ? doc.font(FONT_SANS).fontSize(8.5).heightOfString(comment, { width: col.obs.w - PAD * 2 }) : 10;
      const billingTexts = billingLines.map((l) => `• ${l.label}${l.quantity > 1 ? ` × ${l.quantity}` : ''} : ${formatAmountPlain(l.unitPrice * l.quantity)}`);
      const billingH = billingTexts.reduce(
        (h, t) => h + doc.font(FONT_SANS).fontSize(7.5).heightOfString(t, { width: col.obs.w - PAD * 2 }) + 2,
        billingTexts.length > 0 ? 3 : 0,
      );
      const photosH = photos.length > 0 ? 50 : 0;
      const rowH = Math.max(labelH, stateH, commentH + billingH + (photosH ? photosH + 4 : 0)) + PAD * 2;

      if (y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = drawZoneHeader(zone, doc.page.margins.top, true);
      }

      const top = y + PAD;
      doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(INK).text(item.label, col.label.x + PAD, top, { width: col.label.w - PAD * 2 });

      drawConditionPill(doc, item.condition, col.state.x + PAD, top - 1);
      if (showTransition) {
        doc
          .font(FONT_SANS)
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(`Entrée : ${CONDITION_LABELS[moveInCondition]}`, col.state.x + PAD, top + 18, { width: col.state.w - PAD * 2, lineBreak: false });
      }

      let oy = top;
      if (comment) {
        doc.font(FONT_SANS).fontSize(8.5).fillColor(INK_SOFT).text(comment, col.obs.x + PAD, oy, { width: col.obs.w - PAD * 2 });
        oy += commentH;
      } else {
        doc.font(FONT_SANS).fontSize(8.5).fillColor(FAINT).text('—', col.obs.x + PAD, oy, { lineBreak: false });
        oy += 10;
      }
      if (billingTexts.length > 0) oy += 3;
      for (const t of billingTexts) {
        doc.font(FONT_SANS).fontSize(7.5).fillColor(MUTED).text(t, col.obs.x + PAD, oy, { width: col.obs.w - PAD * 2 });
        oy += doc.font(FONT_SANS).fontSize(7.5).heightOfString(t, { width: col.obs.w - PAD * 2 }) + 2;
      }
      if (photos.length > 0) {
        let px = col.obs.x + PAD;
        for (const url of photos) {
          const file = uploadedFile(url);
          doc.roundedRect(px, oy + 4, 46, 46, 3).strokeColor(BORDER_STRONG).lineWidth(0.75).stroke();
          try {
            if (file && fs.existsSync(file)) doc.image(file, px + 1, oy + 5, { fit: [44, 44], align: 'center', valign: 'center' });
          } catch {
            // Photo illisible : on continue sans (pas bloquant pour le PV, même principe que les signatures).
          }
          px += 52;
        }
      }

      if (showBilling) {
        doc
          .font(FONT_MONO_BOLD)
          .fontSize(9)
          .fillColor(item.deduction > 0 ? DANGER_FG : FAINT)
          .text(item.deduction > 0 ? `-${formatAmountPlain(item.deduction)}` : '—', col.amount.x, top, { width: col.amount.w - PAD, align: 'right', lineBreak: false });
      }

      // Lignes blanches encadrées de fins filets, séparateurs verticaux entre colonnes.
      doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, rowH).lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      for (const c of cols.slice(1)) doc.moveTo(c.x, y).lineTo(c.x, y + rowH).lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
      y += rowH;
    });
    y += 16;
  }
  return y;
}

/** Encadré « Observations générales » de la fiche. */
function drawGeneralNotes(doc, notes, y) {
  if (!notes) return y;
  const text = normalizeLineBreaks(notes);
  const h = doc.font(FONT_SANS).fontSize(9).heightOfString(text, { width: CONTENT_WIDTH - 30 });
  const boxHeight = h + 34;
  y = ensureSpace(doc, y, boxHeight);
  drawPanel(doc, CONTENT_LEFT, y, CONTENT_WIDTH, boxHeight);
  doc.font(FONT_SANS_BOLD).fontSize(7.5).fillColor(MUTED).text('OBSERVATIONS GÉNÉRALES', CONTENT_LEFT + 15, y + 12, { characterSpacing: 0.4 });
  doc.font(FONT_SANS).fontSize(9).fillColor(INK).text(text, CONTENT_LEFT + 15, y + 26, { width: CONTENT_WIDTH - 30 });
  return y + boxHeight + 15;
}

/** Encadré "Réserves du locataire" (étape 48) — mis en avant, jamais mêlé aux notes générales. */
function drawTenantReserves(doc, reserves, y) {
  if (!reserves) return y;
  if (y > doc.page.height - doc.page.margins.bottom - 60) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const text = normalizeLineBreaks(reserves);
  const h = doc.font(FONT_SANS).fontSize(9).heightOfString(text, { width: 465 });
  const boxHeight = h + 34;
  drawPanel(doc, 50, y, 495, boxHeight, { fill: '#FEF3C7', stroke: '#FDE68A' });
  doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(WARNING_FG).text('RÉSERVES DU LOCATAIRE', 65, y + 12);
  doc.font(FONT_SANS).fontSize(9).fillColor(INK).text(text, 65, y + 26, { width: 465 });
  return y + boxHeight + 15;
}

/**
 * Tableau « façon relevé » : en-tête plein bleu à texte blanc, lignes blanches séparées par de fins
 * filets, montants alignés à droite. `columns` : [{ title, w, align }], `rows` : tableaux de textes ;
 * `row.style` ('danger' | 'success' | 'muted') colore le montant. Une ligne n'est jamais coupée.
 */
function drawStyledTable(doc, y, columns, rows, { totalRow = null } = {}) {
  const PADX = 7;
  const xs = [];
  columns.reduce((x, c) => { xs.push(x); return x + c.w; }, CONTENT_LEFT);
  const drawHead = (yy) => {
    doc.rect(CONTENT_LEFT, yy, CONTENT_WIDTH, 20).fill(PRIMARY);
    columns.forEach((c, i) => {
      doc.font(FONT_SANS_BOLD).fontSize(8.5).fillColor('#FFFFFF').text(c.title, xs[i] + PADX, yy + 6, { width: c.w - PADX * 2, align: c.align ?? 'left', lineBreak: false });
    });
    return yy + 20;
  };
  y = ensureSpace(doc, y, 60);
  y = drawHead(y);
  const drawRow = (cells, style, bold) => {
    doc.font(bold ? FONT_SANS_BOLD : FONT_SANS).fontSize(9);
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: columns[i].w - PADX * 2 }))) + 12;
    if (y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = drawHead(doc.page.margins.top); }
    columns.forEach((c, i) => {
      const last = c.align === 'right';
      const color = last && style === 'danger' ? DANGER_FG : last && style === 'success' ? SUCCESS_FG : last && style === 'muted' ? MUTED : INK;
      doc.font(bold || last ? FONT_SANS_BOLD : FONT_SANS).fontSize(9).fillColor(color).text(String(cells[i] ?? ''), xs[i] + PADX, y + 6, { width: c.w - PADX * 2, align: c.align ?? 'left' });
    });
    doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, h).lineWidth(0.5).strokeColor(BORDER_STRONG).stroke();
    columns.slice(1).forEach((c, i) => doc.moveTo(xs[i + 1], y).lineTo(xs[i + 1], y + h).lineWidth(0.5).strokeColor(BORDER_STRONG).stroke());
    y += h;
  };
  for (const r of rows) drawRow(r.cells, r.style, false);
  if (totalRow) drawRow(totalRow.cells, totalRow.style, true);
  return y + 14;
}

/** « Point de sortie » : décompte complet de la caution, de la caution versée au solde final. */
function drawExitStatement(doc, report, y) {
  const num = (v) => Number(v) || 0;
  const itemsTotal = report.zones.reduce((s, z) => s + z.items.reduce((t, it) => t + (it.deduction || 0), 0), 0);
  const extra = (report.extraLines ?? []).filter((l) => l.kind !== 'realisee_locataire');
  const doneByTenant = (report.extraLines ?? []).filter((l) => l.kind === 'realisee_locataire');
  const KIND = { main_oeuvre: "Main-d'œuvre", penalite: 'Pénalité', autre: 'Autre retenue' };
  const rentOwed = num(report.rentOwedAmount) || num(report.rentArrearsAmount);
  const knownExtra = extra.reduce((s, l) => s + l.amount, 0);
  const peintureOverflow = Math.max(0, num(report.totalDeductions) - itemsTotal - num(report.otherDeductionsAmount) - num(report.rentArrearsAmount));
  const legacyOther = extra.length === 0 ? num(report.otherDeductionsAmount) : 0;
  const gross = itemsTotal + knownExtra + legacyOther + peintureOverflow + rentOwed;
  const solde = num(report.depositAmount) - gross;

  y = ensureSpace(doc, y, 120);
  y = D.drawSection(doc, y, 'Point de sortie — décompte de la caution');
  const rows = [{ cells: ['Caution de loyer versée à l’entrée', 'Montant détenu', formatFcfa(report.depositAmount)], style: 'success' }];
  if (itemsTotal > 0) rows.push({ cells: ['Dégradations constatées', 'Voir le détail pièce par pièce ci-dessus', `- ${formatFcfa(itemsTotal)}`], style: 'danger' });
  for (const l of extra) rows.push({ cells: [KIND[l.kind] ?? 'Retenue', l.label, `- ${formatFcfa(l.amount)}`], style: 'danger' });
  if (legacyOther > 0) rows.push({ cells: ['Autres retenues', report.otherDeductionsNote ?? '', `- ${formatFcfa(legacyOther)}`], style: 'danger' });
  if (rentOwed > 0) rows.push({ cells: ['Loyers impayés', 'Déduits automatiquement de la caution', `- ${formatFcfa(rentOwed)}`], style: 'danger' });
  if (peintureOverflow > 0) rows.push({ cells: ['Dépassement caution peinture', 'Reporté sur la caution de loyer', `- ${formatFcfa(peintureOverflow)}`], style: 'danger' });
  for (const l of doneByTenant) rows.push({ cells: ['Réparation effectuée par le locataire', l.label, '0'], style: 'muted' });
  rows.push({ cells: ['Total des retenues', '', `- ${formatFcfa(gross)}`], style: 'danger' });
  y = drawStyledTable(doc, y, [
    { title: 'Désignation', w: 170 },
    { title: 'Détail', w: 225 },
    { title: 'Montant (FCFA)', w: 100, align: 'right' },
  ], rows, {
    totalRow: solde >= 0
      ? { cells: ['Solde à restituer au locataire', report.refundPaymentMethod ? `Réglé par ${ADDITIONAL_DEPOSIT_PAYMENT_METHOD_LABELS[report.refundPaymentMethod] ?? report.refundPaymentMethod}` : '', formatFcfa(solde)], style: 'success' }
      : { cells: ['Reste dû par le locataire', 'Les retenues dépassent la caution', formatFcfa(-solde)], style: 'danger' },
  });
  if (solde < 0) {
    const res = report.balanceResolution === 'paid'
      ? `Le locataire règle la différence de ${formatFcfa(-solde)}${report.balancePaymentMethod ? ` (${ADDITIONAL_DEPOSIT_PAYMENT_METHOD_LABELS[report.balancePaymentMethod] ?? report.balancePaymentMethod})` : ''}.`
      : report.balanceResolution === 'repairs_by_tenant'
        ? `Le locataire s’engage à effectuer lui-même les réparations correspondantes (équivalent de ${formatFcfa(-solde)}).`
        : `Le locataire doit compléter ${formatFcfa(-solde)} ou effectuer les réparations avant la remise des clés.`;
    doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(DANGER_FG).text(res + (report.balanceNote ? ` ${report.balanceNote}` : ''), CONTENT_LEFT, y - 6, { width: CONTENT_WIDTH });
    y = doc.y + 12;
  }
  return y;
}

function streamMoveOutPdf(res, { tenant, renter, property, lease, report, moveInZones = [], additionalDeposits = [], verificationCode }) {
  // zoneKey::itemKey -> condition à l'entrée, pour expliquer la transition
  // d'état ("Bon état → Mauvais état") à côté de chaque élément facturé.
  const moveInConditionByKey = new Map();
  for (const zone of moveInZones) {
    for (const item of zone.items) {
      moveInConditionByKey.set(`${zone.key}::${item.key}`, item.condition);
    }
  }
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="pv-sortie-${renter.last_name}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant, {
    title: 'PROCÈS-VERBAL DE SORTIE',
    subtitle: '& décompte de caution',
    meta: [['Référence unité', property.unit_code ?? '—'], ...(verificationCode ? [['Code de vérification', verificationCode]] : [])],
  });
  doc.font(FONT_SANS).fontSize(9.5).fillColor(INK_SOFT).text("État des lieux de sortie réalisé le ", 50, doc.y, { continued: true });
  doc.font(FONT_SANS_BOLD).fillColor(INK).text(formatDateFr(report.conductedAt));

  const tenantName = `${renter.first_name} ${renter.last_name}`;
  const agentName = report.finalizedBy?.name ?? report.conductedBy?.name ?? null;
  let y = doc.y + 18;
  y = drawInfoPanel(
    doc,
    [
      ['Locataire', tenantName],
      ['Bien loué', `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`],
      ['Unité', property.unit_code ?? '—'],
      ['Durée du bail', `${formatDateFr(isoDateOnly(lease.start_date))} au ${formatDateFr(report.conductedAt)}`],
      ['État des lieux réalisé le', formatDateFr(report.conductedAt)],
      ['Réalisé par', report.conductedBy?.name ?? '—'],
    ],
    y,
  );
  y = drawInspectionSummary(doc, report.zones, y);
  y = drawInspectionZones(doc, report.zones, y, { moveInConditionByKey, showBilling: true });

  y = drawExitStatement(doc, report, y);

  // Cautions supplémentaires (étape 43, SBEE/SONEB/peinture) — chacune distincte de la caution de
  // loyer ci-dessus (compte 165 unique, mais des lignes SÉPARÉES sur ce PV pour rester claires, comme
  // demandé par l'utilisateur), une ligne par caution encore concernée par cette sortie (restituée).
  const returnedAdditionalDeposits = additionalDeposits.filter((d) => d.status === 'returned');
  if (returnedAdditionalDeposits.length > 0) {
    if (y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(PRIMARY).text('CAUTIONS SUPPLÉMENTAIRES', 50, y);
    y = doc.y + 8;
    for (const d of returnedAdditionalDeposits) {
      if (y > doc.page.height - doc.page.margins.bottom - 55) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const boxH = d.deductionAmount > 0 ? 66 : 46;
      drawPanel(doc, 50, y, 495, boxH);
      const by = y + 12;
      drawPanelRow(doc, d.typeLabel, formatFcfa(d.amount), 65, by, { labelWidth: 335, valueWidth: 130 });
      let ly = by + 20;
      if (d.deductionAmount > 0) {
        drawPanelRow(
          doc,
          d.deductionNote || 'Retenue',
          `- ${formatFcfa(d.deductionAmount)}`,
          65,
          ly,
          { labelWidth: 335, valueWidth: 130, valueColor: DANGER_FG },
        );
        ly += 20;
      }
      const methodLabel = d.returnedMethod ? ADDITIONAL_DEPOSIT_PAYMENT_METHOD_LABELS[d.returnedMethod] ?? d.returnedMethod : null;
      const returnedLabel = methodLabel ? `Restitué au locataire (${methodLabel})` : 'Retenue intégrale — rien à restituer';
      drawPanelRow(doc, returnedLabel, formatFcfa(d.returnedAmount ?? 0), 65, ly, {
        labelWidth: 335,
        valueWidth: 130,
        valueColor: d.returnedAmount > 0 ? SUCCESS_FG : MUTED,
      });
      y += boxH + 10;
    }
    y += 10;
  }

  y = drawGeneralNotes(doc, report.generalNotes, y);
  y = drawTenantReserves(doc, report.tenantReserves, y);
  y = drawReopenedNotice(doc, report, y);
  drawSignatureBlock(doc, report, y, { tenantName, agentName, companyName: tenant.company_name });

  drawFooter(doc, { verificationCode });
  doc.end();
}

/**
 * Note de traçabilité (étape 48, étendue le 2026-10-17 pour la crédibilité du
 * document) — si cette fiche a été rouverte puis corrigée, le document final
 * dit quand, par qui, pourquoi (motif saisi par le DG à la réouverture) et
 * CE QUI a changé (`correctionChanges`, calculé à la refinalisation — voir
 * services/inspection.js `diffInspectionReport`). Affiché au locataire/
 * propriétaire : plus crédible qu'un simple « ceci a été corrigé ».
 */
function drawReopenedNotice(doc, report, y) {
  if (!report.reopenedAt) return y;
  const changes = Array.isArray(report.correctionChanges) ? report.correctionChanges : [];
  const lines = [
    `Document corrigé le ${formatDateFr(report.reopenedAt.slice(0, 10))}${report.reopenedBy ? ` par ${report.reopenedBy.name}` : ''}${report.reopenReason ? ` — motif : ${report.reopenReason}` : ''}.`,
  ];
  if (changes.length > 0) {
    lines.push(`Changements apportés : ${changes.join(' ; ')}.`);
  } else {
    lines.push('Aucun changement de contenu détecté par rapport à la version précédente.');
  }
  const text = lines.join(' ');
  const height = doc.font(FONT_SANS).fontSize(8).heightOfString(text, { width: 495 });
  y = ensureSpace(doc, y, height + 6);
  doc.font(FONT_SANS).fontSize(8).fillColor(FAINT).text(text, 50, y, { width: 495 });
  return y + height + 6;
}

/**
 * Bloc de signatures (locataire + agent), partagé entre les PV d'entrée et de sortie — refait à
 * l'étape 56 : deux cartes côte à côte, mention « Lu et approuvé », signature centrée sur une ligne
 * d'appui, nom du signataire et date de signature. Jamais coupé par un saut de page.
 */
/** Deux cadres vides (locataire / cabinet) à signer à la main après impression, jamais coupés entre deux pages. */
function drawPrintSignatureBoxes(doc, y, { tenantName, agentName, companyName }) {
  const H = 130;
  y = ensureSpace(doc, y + 6, H + 40);
  y = D.drawSection(doc, y, 'Signatures des parties');
  doc.font(FONT_SANS).fontSize(8.5).fillColor(MUTED).text('Document à imprimer, puis à dater et signer à la main par chacune des parties, précédé de « Lu et approuvé ».', CONTENT_LEFT, y, { width: CONTENT_WIDTH });
  y = doc.y + 8;
  const W = (CONTENT_WIDTH - 16) / 2;
  const boxes = [
    { title: 'Le locataire', name: tenantName },
    { title: 'Le bailleur / mandataire', name: agentName ? `${agentName}${companyName ? ` — ${companyName}` : ''}` : companyName },
  ];
  boxes.forEach((b, i) => {
    const x = CONTENT_LEFT + i * (W + 16);
    doc.roundedRect(x, y, W, H, 6).lineWidth(0.9).strokeColor(BORDER_STRONG).stroke();
    doc.rect(x, y, W, 22).fill(PRIMARY);
    doc.font(FONT_SANS_BOLD).fontSize(9).fillColor('#FFFFFF').text(b.title.toUpperCase(), x + 10, y + 7, { width: W - 20, lineBreak: false, characterSpacing: 0.4 });
    doc.font(FONT_SANS).fontSize(8.5).fillColor(INK).text(`Nom : ${b.name ?? '………………………………'}`, x + 10, y + 30, { width: W - 20, lineBreak: false });
    doc.fillColor(INK).text('Date : ____ / ____ / ________', x + 10, y + 46, { width: W - 20, lineBreak: false });
    doc.text('Lieu : ……………………………………', x + 10, y + 62, { width: W - 20, lineBreak: false });
    doc.font(FONT_SANS).fontSize(7.5).fillColor(FAINT).text('Signature', x + 10, y + H - 16, { width: W - 20, lineBreak: false });
  });
  return y + H + 12;
}

function drawSignatureBlock(doc, report, y, { tenantName = null, agentName = null, companyName = null } = {}) {
  // Rapports déjà signés électroniquement avant ce changement : on garde leurs signatures. Sinon, cadres vides.
  if (!report.tenantSignatureUrl && !report.agentSignatureUrl) {
    return drawPrintSignatureBoxes(doc, y, { tenantName, agentName, companyName });
  }
  const signedOn = report.finalizedAt ? formatDateFr(report.finalizedAt.slice(0, 10)) : null;
  const end = D.drawSignatureCards(doc, y, [
    { title: 'Le locataire', name: tenantName, date: signedOn, signatureFile: uploadedFile(report.tenantSignatureUrl), hint: 'Signature précédée de « Lu et approuvé »' },
    { title: 'Le bailleur / mandataire', name: agentName, date: signedOn, signatureFile: uploadedFile(report.agentSignatureUrl), hint: 'Signature précédée de « Lu et approuvé »' },
  ]);
  return end;
}

/**
 * État des lieux d'ENTRÉE, en PDF (étape 48 — n'existait pas avant : seule la
 * sortie s'exportait, alors que le locataire signe les deux). Même grille
 * zones/éléments que le PV de sortie, sans les colonnes de retenue/caution
 * (`showBilling: false`) : à l'entrée, on CONSTATE un état, on ne facture
 * rien.
 */
function streamMoveInPdf(res, { tenant, renter, property, lease, report, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="etat-des-lieux-entree-${renter.last_name}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant, {
    title: "ÉTAT DES LIEUX D'ENTRÉE",
    subtitle: 'Procès-verbal contradictoire',
    meta: [['Référence unité', property.unit_code ?? '—'], ...(verificationCode ? [['Code de vérification', verificationCode]] : [])],
  });
  doc.font(FONT_SANS).fontSize(9.5).fillColor(INK_SOFT).text("État des lieux d'entrée réalisé le ", 50, doc.y, { continued: true });
  doc.font(FONT_SANS_BOLD).fillColor(INK).text(formatDateFr(report.conductedAt));

  const tenantName = `${renter.first_name} ${renter.last_name}`;
  const agentName = report.finalizedBy?.name ?? report.conductedBy?.name ?? null;
  let y = doc.y + 18;
  y = drawInfoPanel(
    doc,
    [
      ['Locataire', tenantName],
      ['Bien loué', `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`],
      ['Unité', property.unit_code ?? '—'],
      ['Date d’entrée', formatDateFr(isoDateOnly(lease.start_date))],
      ['État des lieux réalisé le', formatDateFr(report.conductedAt)],
      ['Réalisé par', report.conductedBy?.name ?? '—'],
    ],
    y,
  );
  y = drawInspectionSummary(doc, report.zones, y);
  y = drawInspectionZones(doc, report.zones, y, { showBilling: false });
  y = drawGeneralNotes(doc, report.generalNotes, y);
  y = drawTenantReserves(doc, report.tenantReserves, y);
  y = drawReopenedNotice(doc, report, y);
  drawSignatureBlock(doc, report, y, { tenantName, agentName, companyName: tenant.company_name });

  drawFooter(doc, { verificationCode });
  doc.end();
}

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  kkiapay: 'Paiement en ligne',
  // Réglé par prélèvement sur la caution à la sortie (demande utilisateur, 2026-10-18) — jamais
  // sélectionnable manuellement, uniquement généré par `POST /:leaseId/move-out-report/finalize`.
  caution: 'Prélevé sur la caution',
};

const UNIT_STATUS_LABELS = { libre: 'Libre', loue: 'Loué', reserve: 'Réservé' };

// ────────────────────────────────────────────────────────────────────────
// Carnet des charges SONEB/SBEE (étape 31)
// ────────────────────────────────────────────────────────────────────────

const POINT_STATUS_LABELS = {
  paiement_non_renseigne: 'Paiement à déclarer',
  a_recouvrer: 'À recouvrer',
  a_charge_proprietaire: 'À charge du propriétaire',
  solde: 'Soldé',
};
const POINT_STATUS_COLORS = {
  paiement_non_renseigne: MUTED,
  a_recouvrer: WARNING_FG,
  a_charge_proprietaire: DANGER_FG,
  solde: SUCCESS_FG,
};
const UTILITY_SHORT = { soneb: 'SONEB', sbee: 'SBEE' };
const PAYMENT_METHOD_SHORT = { especes: 'Espèces', mobile_money: 'Mobile M.', virement: 'Virement', cheque: 'Chèque', kkiapay: 'En ligne' };
// Limite basse du contenu avant de basculer sur une nouvelle page (le pied de page occupe y ≥ 772).
const CONTENT_BOTTOM = 715;

/** Montant sans suffixe, pour les colonnes de tableau (l'unité FCFA est rappelée en en-tête). */
function formatAmountPlain(amount) {
  return formatFcfa(amount).replace(' FCFA', '');
}

/** Texte sur UNE ligne, tronqué avec « … » s'il dépasse la colonne (jamais de retour à la ligne : la hauteur d'une ligne de tableau reste fixe). */
function cellText(doc, text, x, y, width, { font = FONT_SANS, size = 9, color = INK, align = 'left' } = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  let t = String(text ?? '');
  if (doc.widthOfString(t) > width) {
    while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
    t = `${t.trimEnd()}…`;
  }
  doc.text(t, x, y, { width, align, lineBreak: false });
}

function drawTableHeader(doc, columns, y) {
  doc.font(FONT_SANS_BOLD).fontSize(7.5).fillColor(MUTED);
  for (const c of columns) {
    doc.text(c.label, c.x, y, { width: c.width, align: c.align ?? 'left', characterSpacing: 0.3, lineBreak: false });
  }
  const lineY = y + 13;
  doc.moveTo(50, lineY).lineTo(545, lineY).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  return lineY + 8;
}

/** Passe à une nouvelle page si la place manque, en redessinant l'en-tête de tableau. */
function ensureRoom(doc, y, needed, columns) {
  if (y + needed <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return columns ? drawTableHeader(doc, columns, 50) : 50;
}

const POINT_COLUMNS = [
  { label: 'RELEVÉ', x: 50, width: 150 },
  { label: 'FACTURE MÈRE', x: 205, width: 70, align: 'right' },
  { label: 'FACTURÉ', x: 280, width: 65, align: 'right' },
  { label: 'ENCAISSÉ', x: 350, width: 65, align: 'right' },
  { label: 'RESTE', x: 420, width: 55, align: 'right' },
  { label: 'STATUT', x: 482, width: 63 },
];

/** Tableau « point par relevé » : facture mère payée, facturé, encaissé, reste au propriétaire. */
function drawPointTable(doc, batches, totals, y) {
  y = drawTableHeader(doc, POINT_COLUMNS, y);
  for (const b of batches) {
    y = ensureRoom(doc, y, 30, POINT_COLUMNS);
    const [c0, c1, c2, c3, c4, c5] = POINT_COLUMNS;
    cellText(doc, `${b.propertyCode} · ${UTILITY_SHORT[b.utilityType] ?? b.utilityType}`, c0.x, y, c0.width, { font: FONT_SANS_BOLD });
    cellText(doc, formatMonthLabel(b.periodStart.slice(0, 7)), c0.x, y + 11, c0.width, { size: 7.5, color: MUTED });
    const invoice = b.mainPaid != null ? b.mainPaid : b.mainInvoice;
    cellText(doc, invoice != null ? formatAmountPlain(invoice) : '—', c1.x, y, c1.width, {
      font: FONT_MONO_BOLD, size: 8.5, align: 'right', color: b.mainPaid != null ? INK : MUTED,
    });
    cellText(doc, b.mainPaid != null ? `payée le ${formatDateSlash(b.mainPaidAt)}` : 'non déclarée', c1.x - 10, y + 11, c1.width + 10, {
      size: 6.5, color: MUTED, align: 'right',
    });
    cellText(doc, formatAmountPlain(b.billed), c2.x, y, c2.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
    cellText(doc, formatAmountPlain(b.collected), c3.x, y, c3.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
    cellText(doc, b.gap != null ? formatAmountPlain(b.gap) : '—', c4.x, y, c4.width, {
      font: FONT_MONO_BOLD, size: 8.5, align: 'right', color: b.gap != null && b.gap > 0 ? DANGER_FG : INK,
    });
    cellText(doc, POINT_STATUS_LABELS[b.status] ?? b.status, c5.x, y, c5.width, {
      size: 7, color: POINT_STATUS_COLORS[b.status] ?? MUTED,
    });
    y += 30;
  }
  // Ligne de total (uniquement sur les relevés dont la facture mère est déclarée payée pour « reste »).
  y = ensureRoom(doc, y, 26, POINT_COLUMNS);
  doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  const [c0, c1, c2, c3, c4] = POINT_COLUMNS;
  cellText(doc, 'Total', c0.x, y + 2, c0.width, { font: FONT_SANS_BOLD });
  cellText(doc, formatAmountPlain(totals.mainPaidTotal), c1.x, y + 2, c1.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
  cellText(doc, formatAmountPlain(totals.billedTotal), c2.x, y + 2, c2.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
  cellText(doc, formatAmountPlain(totals.collectedTotal), c3.x, y + 2, c3.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
  cellText(doc, formatAmountPlain(totals.gapTotal), c4.x, y + 2, c4.width, {
    font: FONT_MONO_BOLD, size: 8.5, align: 'right', color: totals.gapTotal > 0 ? DANGER_FG : SUCCESS_FG,
  });
  return y + 26;
}

/** Panneau de synthèse : le point (facture mère payée vs encaissé) puis, si connu, le compte à reverser. */
function drawCarnetSummary(doc, carnet, y) {
  const t = carnet.totals;
  const rows = [
    ['Facture mère payée par le propriétaire', formatFcfa(t.mainPaidTotal), INK],
    ['Encaissé chez les locataires (relevés)', formatFcfa(t.collectedTotal), INK],
    ['Impayés des locataires (encore récupérables)', formatFcfa(t.tenantUnpaidTotal), t.tenantUnpaidTotal > 0 ? WARNING_FG : INK],
    ['Consommation non refacturée', formatFcfa(t.nonRebilledTotal), INK],
    ['Reste à la charge du propriétaire', formatFcfa(t.gapTotal), t.gapTotal > 0 ? DANGER_FG : SUCCESS_FG],
  ];
  const height = rows.length * 17 + 16;
  drawPanel(doc, 50, y, 495, height);
  rows.forEach(([label, value, color], i) => {
    const last = i === rows.length - 1;
    drawPanelRow(doc, label, value, 66, y + 10 + i * 17, { labelWidth: 290, valueWidth: 155, valueColor: color, fontSize: last ? 10.5 : 9.5 });
  });
  y += height + 8;

  if (t.pendingPaymentCount > 0) {
    doc.font(FONT_SANS).fontSize(8).fillColor(WARNING_FG).text(
      `${t.pendingPaymentCount} facture(s) mère(s) (${formatFcfa(t.pendingInvoiceAmount)}) pas encore déclarée(s) payée(s) : non comptée(s) dans le reste ci-dessus.`,
      50, y, { width: 495 },
    );
    y = doc.y + 8;
  }

  if (carnet.account) {
    const a = carnet.account;
    const accRows = [
      ['Charges encaissées à ce jour (toutes factures)', formatFcfa(a.collected), INK],
      ['Déjà reversées au propriétaire', formatFcfa(a.remitted), INK],
      ['Reste à reverser au propriétaire', formatFcfa(a.balance), PRIMARY],
    ];
    const accHeight = accRows.length * 17 + 16;
    drawPanel(doc, 50, y, 495, accHeight, { fill: PRIMARY_BG, stroke: PRIMARY_BORDER });
    accRows.forEach(([label, value, color], i) => {
      const last = i === accRows.length - 1;
      drawPanelRow(doc, label, value, 66, y + 10 + i * 17, { labelWidth: 290, valueWidth: 155, valueColor: color, fontSize: last ? 10.5 : 9.5 });
    });
    y += accHeight + 8;
  }
  return y;
}

const ENTRY_COLUMNS = [
  { label: 'DATE', x: 50, width: 55 },
  { label: 'LOCATAIRE', x: 108, width: 130 },
  { label: 'BIEN · UNITÉ', x: 241, width: 90 },
  { label: 'FLUIDE · PÉRIODE', x: 334, width: 90 },
  { label: 'MODE', x: 427, width: 45 },
  { label: 'MONTANT', x: 475, width: 70, align: 'right' },
];

/** Carnet des entrées : chaque règlement de charge reçu d'un locataire. */
function drawEntriesTable(doc, entries, y) {
  if (entries.items.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucune charge encaissée sur cette période.', 50, y);
    return doc.y + 10;
  }
  y = drawTableHeader(doc, ENTRY_COLUMNS, y);
  for (const e of entries.items) {
    y = ensureRoom(doc, y, 18, ENTRY_COLUMNS);
    const [c0, c1, c2, c3, c4, c5] = ENTRY_COLUMNS;
    cellText(doc, formatDateSlash(e.paidAt), c0.x, y, c0.width, { font: FONT_MONO, size: 8.5 });
    cellText(doc, e.renterName, c1.x, y, c1.width);
    // Les codes d'unité reprennent déjà celui du Bien (« AUD-002-U03 ») : ne pas le répéter.
    const unitLabel = e.unitCode.startsWith(e.propertyCode) ? e.unitCode : `${e.propertyCode} · ${e.unitCode}`;
    cellText(doc, unitLabel, c2.x, y, c2.width, { color: INK_SOFT, size: 8.5 });
    cellText(doc, `${UTILITY_SHORT[e.utilityType] ?? e.utilityType} ${formatMonthLabel(e.periodStart.slice(0, 7))}${e.batchId == null ? ' (indiv.)' : ''}`, c3.x, y, c3.width, { color: INK_SOFT, size: 8 });
    cellText(doc, PAYMENT_METHOD_SHORT[e.paymentMethod] ?? e.paymentMethod, c4.x, y, c4.width, { color: MUTED, size: 7.5 });
    cellText(doc, formatAmountPlain(e.amount), c5.x, y, c5.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
    y += 18;
  }
  y = ensureRoom(doc, y, 22, ENTRY_COLUMNS);
  doc.moveTo(50, y - 3).lineTo(545, y - 3).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  cellText(doc, `Total encaissé (${entries.items.length} règlement${entries.items.length > 1 ? 's' : ''})`, 50, y + 2, 300, { font: FONT_SANS_BOLD });
  cellText(doc, formatAmountPlain(entries.total), 475, y + 2, 70, { font: FONT_MONO_BOLD, size: 9, align: 'right' });
  y += 22;
  if (entries.outsideBatchesTotal > 0) {
    doc.font(FONT_SANS).fontSize(7.5).fillColor(MUTED).text(
      `dont ${formatFcfa(entries.outsideBatchesTotal)} de factures individuelles saisies hors relevé de compteurs (« indiv. »), absentes du tableau « point par relevé ».`,
      50, y, { width: 495 },
    );
    y = doc.y + 6;
  }
  return y;
}

const REMITTANCE_COLUMNS = [
  { label: 'DATE', x: 50, width: 70 },
  { label: 'LIBELLÉ', x: 125, width: 230 },
  { label: 'MODE', x: 360, width: 100 },
  { label: 'MONTANT', x: 465, width: 80, align: 'right' },
];

function drawRemittancesTable(doc, remittances, y, { emptyText = 'Aucun reversement sur cette période.' } = {}) {
  if (remittances.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text(emptyText, 50, y);
    return doc.y + 10;
  }
  y = drawTableHeader(doc, REMITTANCE_COLUMNS, y);
  for (const r of remittances) {
    y = ensureRoom(doc, y, 18, REMITTANCE_COLUMNS);
    const [c0, c1, c2, c3] = REMITTANCE_COLUMNS;
    cellText(doc, formatDateSlash(r.paidAt), c0.x, y, c0.width, { font: FONT_MONO, size: 8.5 });
    cellText(doc, r.periodLabel || r.notes || '—', c1.x, y, c1.width, { size: 8.5 });
    cellText(doc, PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod, c2.x, y, c2.width, { color: MUTED, size: 8.5 });
    cellText(doc, formatAmountPlain(r.amount), c3.x, y, c3.width, { font: FONT_MONO_BOLD, size: 8.5, align: 'right' });
    y += 18;
  }
  return y + 4;
}

function periodLabelFr(from, to) {
  // Pas de flèche « → » : absente de l'alphabet WinAnsi des polices PDF standard (rendue en caractères parasites).
  const deMonth = (ym) => (/^[aeiou]/i.test(formatMonthLabel(ym)) ? `d'${formatMonthLabel(ym)}` : `de ${formatMonthLabel(ym)}`);
  return from === to ? formatMonthLabel(from) : `${deMonth(from)} à ${formatMonthLabel(to)}`;
}

function safeFilenamePart(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proprietaire';
}

/**
 * Carnet des charges SONEB/SBEE d'un propriétaire (étape 31) : le point par
 * relevé (facture mère payée vs encaissé), le carnet des entrées (chaque
 * règlement reçu d'un locataire) et les reversements au propriétaire.
 * `verificationCode` : seulement pour la copie remise via le portail (cap de
 * 5 téléchargements + code de vérification, comme le relevé propriétaire).
 */
function streamUtilityCarnetPdf(res, { tenant, owner, carnet, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="carnet-charges-${safeFilenamePart(owner.name)}.pdf"`);
  doc.pipe(res);

  const topY = drawHeader(doc, tenant, {
    title: 'CARNET DES CHARGES',
    subtitle: periodLabelFr(carnet.from, carnet.to),
    meta: [['Généré le', formatDateFr(new Date().toISOString().slice(0, 10))], ...(verificationCode ? [['Code de vérification', verificationCode]] : [])],
  });

  let y = topY;

  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('PROPRIÉTAIRE', 50, y, { characterSpacing: 0.6 });
  y += 13;
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text(owner.name, 50, y);
  y += 15;
  if (owner.phone) {
    doc.font(FONT_MONO).fontSize(9).fillColor(MUTED).text(owner.phone, 50, y);
    y += 13;
  }
  y += 10;

  y = drawCarnetSummary(doc, carnet, y) + 8;

  y = ensureRoom(doc, y, 90, null);
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Point par relevé', 50, y);
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('Montants en FCFA', 50, y + 3, { width: 495, align: 'right' });
  y = doc.y + 8;
  if (carnet.batches.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun relevé validé sur cette période.', 50, y);
    y = doc.y + 14;
  } else {
    y = drawPointTable(doc, carnet.batches, carnet.totals, y) + 6;
  }

  y = ensureRoom(doc, y, 90, null);
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Entrées : charges payées par les locataires', 50, y);
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('Montants en FCFA', 50, y + 3, { width: 495, align: 'right' });
  y = doc.y + 8;
  y = drawEntriesTable(doc, carnet.entries, y) + 10;

  y = ensureRoom(doc, y, 80, null);
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Reversements au propriétaire (sur la période)', 50, y);
  y = doc.y + 8;
  y = drawRemittancesTable(doc, carnet.remittances, y);
  if (carnet.remittances.length > 0) {
    y = ensureRoom(doc, y, 20, null);
    cellText(doc, `Total reversé sur la période`, 50, y, 300, { font: FONT_SANS_BOLD });
    cellText(doc, formatAmountPlain(carnet.remittedInWindow), 465, y, 80, { font: FONT_MONO_BOLD, size: 9, align: 'right' });
  }

  drawFooter(doc, { verificationCode });
  doc.end();
}

/** Section « Charges SONEB / SBEE » du relevé propriétaire : version compacte du carnet. */
function drawChargesStatementSection(doc, charges, y) {
  y = ensureRoom(doc, y, 150, null);
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Charges SONEB / SBEE', 50, y);
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text(periodLabelFr(charges.from, charges.to), 50, y + 3, { width: 495, align: 'right' });
  y = doc.y + 8;

  if (charges.batches.length === 0 && !charges.account) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun relevé de charges validé sur cette période.', 50, y);
    return doc.y + 10;
  }
  y = drawCarnetSummary(doc, charges, y);
  if (charges.batches.length > 0) {
    y = ensureRoom(doc, y, 80, null);
    y = drawPointTable(doc, charges.batches.slice(0, 18), charges.totals, y);
    if (charges.batches.length > 18) {
      doc.font(FONT_SANS).fontSize(7.5).fillColor(MUTED).text(`… et ${charges.batches.length - 18} autre(s) relevé(s) — voir le carnet des charges complet.`, 50, y - 6);
      y = doc.y + 8;
    }
  }
  if (charges.remittances.length > 0) {
    y = ensureRoom(doc, y, 70, null);
    doc.font(FONT_SANS_BOLD).fontSize(10).fillColor(INK).text('Derniers reversements de charges', 50, y);
    y = doc.y + 8;
    y = drawRemittancesTable(doc, charges.remittances.slice(0, 8), y);
  }
  return y;
}

/**
 * Relevé propriétaire : patrimoine géré (biens/unités, statut, loyer, locataire
 * en place) et historique des versements déjà effectués. Généré à la demande,
 * jamais stocké — comme l'attestation de loyer, la date est celle du jour.
 */
/**
 * Relevé propriétaire — refonte demandée par l'utilisateur : même langage
 * visuel que la quittance (`streamReceiptPdf`) : titre + bloc de méta-
 * données en libellés à droite, bloc d'identité, tableaux avec ligne
 * totale mise en évidence, plutôt que des paragraphes/listes libres.
 */
function streamOwnerStatementPdf(res, { tenant, owner, units, payouts, charges = null, depositTransfers = null, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="releve-${owner.name.replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  const topY = drawHeader(doc, tenant, {
    title: 'RELEVÉ PROPRIÉTAIRE',
    subtitle: owner.name,
    meta: [['Généré le', formatDateFr(new Date().toISOString().slice(0, 10))], ...(verificationCode ? [['Code de vérification', verificationCode]] : [])],
  });

  let y = topY;

  // --- Propriétaire ---
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('PROPRIÉTAIRE', 50, y, { characterSpacing: 0.6 });
  y += 13;
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text(owner.name, 50, y);
  y += 15;
  if (owner.phone) {
    doc.font(FONT_MONO).fontSize(9).fillColor(MUTED).text(owner.phone, 50, y);
    y += 13;
  }
  if (owner.address) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text(owner.address, 50, y, { width: 350 });
    y = doc.y;
  }
  y += 13;

  // --- Tableau : patrimoine géré ---
  const colUnit = { x: 50, width: 210 };
  const colStatus = { x: 265, width: 55 };
  const colRenter = { x: 325, width: 130 };
  const colRent = { x: 460, width: 85 };

  doc.font(FONT_SANS_BOLD).fontSize(8).fillColor(MUTED);
  doc.text('BIEN / UNITÉ', colUnit.x, y, { width: colUnit.width, characterSpacing: 0.3 });
  doc.text('STATUT', colStatus.x, y, { width: colStatus.width, characterSpacing: 0.3 });
  doc.text('LOCATAIRE', colRenter.x, y, { width: colRenter.width, characterSpacing: 0.3 });
  doc.text('LOYER MENSUEL', colRent.x, y, { width: colRent.width, align: 'right', characterSpacing: 0.3 });
  y += 14;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  y += 10;

  if (units.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun bien enregistré.', 50, y);
    y = doc.y + 10;
  } else {
    for (const u of units) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      const unitLine = `${u.propertyCode} · ${u.unitCode} — ${u.designationLabel}${u.address ? `, ${u.address}` : ''}`;
      const rowHeight = Math.max(
        doc.font(FONT_SANS_BOLD).fontSize(9).heightOfString(unitLine, { width: colUnit.width }),
        14,
      );
      doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(INK).text(unitLine, colUnit.x, y, { width: colUnit.width });
      doc
        .font(FONT_SANS)
        .fontSize(9)
        .fillColor(MUTED)
        .text(UNIT_STATUS_LABELS[u.status] ?? u.status, colStatus.x, y, { width: colStatus.width });
      doc
        .font(FONT_SANS)
        .fontSize(9)
        .fillColor(MUTED)
        .text(u.currentRenter ?? '—', colRenter.x, y, { width: colRenter.width });
      doc
        .font(FONT_MONO_BOLD)
        .fontSize(9)
        .fillColor(INK)
        .text(formatFcfa(u.monthlyRent), colRent.x, y, { width: colRent.width, align: 'right' });
      y += rowHeight + 12;
    }
  }

  const occupiedRent = units.filter((u) => u.status === 'loue').reduce((sum, u) => sum + u.monthlyRent, 0);
  const totalBoxHeight = 34;
  drawPanel(doc, 275, y, 270, totalBoxHeight, { fill: PRIMARY_BG, stroke: PRIMARY_BORDER });
  doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(INK).text('Loyers mensuels en cours', 290, y + 11, { width: 160 });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(12)
    .fillColor(PRIMARY)
    .text(formatFcfa(occupiedRent), 275, y + 9, { width: 255, align: 'right' });
  y += totalBoxHeight + 30;

  // --- Tableau : historique des versements ---
  if (y > 680) {
    doc.addPage();
    y = 50;
  }
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Historique des versements', 50, y);
  y = doc.y + 12;

  if (payouts.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun versement enregistré.', 50, y);
    y = doc.y;
  } else {
    const colDate = { x: 50, width: 90 };
    const colPeriod = { x: 145, width: 180 };
    const colMethod = { x: 330, width: 130 };
    const colAmount = { x: 460, width: 85 };

    doc.font(FONT_SANS_BOLD).fontSize(8).fillColor(MUTED);
    doc.text('DATE', colDate.x, y, { width: colDate.width, characterSpacing: 0.3 });
    doc.text('PÉRIODE', colPeriod.x, y, { width: colPeriod.width, characterSpacing: 0.3 });
    doc.text('MODE', colMethod.x, y, { width: colMethod.width, characterSpacing: 0.3 });
    doc.text('MONTANT', colAmount.x, y, { width: colAmount.width, align: 'right', characterSpacing: 0.3 });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
    y += 10;

    for (const p of payouts) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      doc
        .font(FONT_MONO)
        .fontSize(9)
        .fillColor(INK)
        .text(formatDateSlash(isoDateOnly(p.paidAt)), colDate.x, y, { width: colDate.width });
      doc.font(FONT_SANS).fontSize(9).fillColor(INK).text(p.periodLabel, colPeriod.x, y, { width: colPeriod.width });
      doc
        .font(FONT_SANS)
        .fontSize(9)
        .fillColor(MUTED)
        .text(p.paymentMethodLabel, colMethod.x, y, { width: colMethod.width });
      doc
        .font(FONT_MONO_BOLD)
        .fontSize(9)
        .fillColor(INK)
        .text(formatFcfa(p.amount), colAmount.x, y, { width: colAmount.width, align: 'right' });
      y += 18;
    }
  }

  // Cautions remises au propriétaire : historique + ce qu'il détient encore (à restituer aux locataires).
  if (depositTransfers && (depositTransfers.rows.length > 0 || depositTransfers.withOwner > 0)) {
    y = Math.max(y, doc.y) + 24;
    if (y > 640) {
      doc.addPage();
      y = 50;
    }
    doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Cautions remises au propriétaire', 50, y);
    y = doc.y + 6;
    doc
      .font(FONT_SANS)
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        'Ces sommes appartiennent aux locataires : elles restent à restituer à la sortie du bail. Elles ne sont pas des loyers et ne figurent pas dans les versements ci-dessus.',
        50, y, { width: 495 },
      );
    y = doc.y + 10;
    for (const t of depositTransfers.rows) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const sign = t.direction === 'to_owner' ? 'Remis' : 'Rendu';
      doc.font(FONT_MONO).fontSize(9).fillColor(INK).text(formatDateSlash(isoDateOnly(t.paidAt)), 50, y, { width: 80 });
      doc.font(FONT_SANS).fontSize(9).fillColor(INK).text(`${sign} — ${t.typeLabel} · ${t.renterName}`, 135, y, { width: 320 });
      doc.font(FONT_MONO_BOLD).fontSize(9).fillColor(INK).text(formatFcfa(t.amount), 460, y, { width: 85, align: 'right' });
      y = Math.max(doc.y, y + 14) + 4;
    }
    drawPanel(doc, 275, y + 4, 270, 34, { fill: PRIMARY_BG, stroke: PRIMARY_BORDER });
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(INK).text('Cautions détenues par le propriétaire', 290, y + 15, { width: 160 });
    doc.font(FONT_MONO_BOLD).fontSize(12).fillColor(PRIMARY).text(formatFcfa(depositTransfers.withOwner), 275, y + 13, { width: 255, align: 'right' });
    y += 50;
    doc.y = y;
  }

  // Charges SONEB/SBEE (étape 31) : le point + ce qu'il reste à reverser au propriétaire.
  if (charges) {
    y = Math.max(y, doc.y) + 24;
    drawChargesStatementSection(doc, charges, y);
  }

  drawFooter(doc, { verificationCode });
  doc.end();
}

function isoDateOnly(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * Rapport mensuel comptable exportable (étape 18, demande directe de
 * l'utilisateur : « rapport mensuel exportable » pour le comptable) — même
 * calcul que l'écran (`computeAccountingDashboard`), mis en page pour être
 * imprimé ou transmis à la direction générale ou à un comptable externe.
 */
function streamAccountingReportPdf(res, { tenant, dashboard }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  const periodLabel = formatMonthLabel(dashboard.period.from.slice(0, 7));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="rapport-${dashboard.period.from.slice(0, 7)}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant, {
    title: 'RAPPORT MENSUEL',
    subtitle: periodLabel,
    meta: [['Période', periodLabel], ['Généré le', formatDateFr(new Date().toISOString().slice(0, 10))]],
  });

  let y = doc.y;
  if (dashboard.isClosed && dashboard.closedInfo) {
    doc
      .font(FONT_SANS)
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        `Mois clôturé le ${formatDateFr(isoDateOnly(dashboard.closedInfo.closedAt))}` +
          (dashboard.closedInfo.closedBy ? ` par ${dashboard.closedInfo.closedBy.name} (${dashboard.closedInfo.closedBy.roleLabel})` : '') +
          (dashboard.closedInfo.forced ? ' — clôture anticipée' : ''),
        50,
        y,
        { width: 495 },
      );
    y = doc.y + 15;
  } else {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Mois toujours ouvert.', 50, y);
    y = doc.y + 15;
  }

  // Résumé financier : mêmes totaux que la carte du tableau de bord écran.
  const t = dashboard.totals;
  const hasOtherIncomes = Number(t.otherIncomes) > 0;
  const ex = hasOtherIncomes ? 20 : 0;
  const boxHeight = 150 + ex;
  drawPanel(doc, 50, y, 495, boxHeight);
  const boxY = y + 14;
  drawPanelRow(doc, 'Loyers encaissés', `+ ${formatFcfa(t.rentCollected)}`, 65, boxY, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: SUCCESS_FG,
  });
  drawPanelRow(doc, "Frais d'agence à l'entrée (produit de l'entreprise)", `+ ${formatFcfa(t.entryFeesCollected)}`, 65, boxY + 20, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: SUCCESS_FG,
  });
  if (hasOtherIncomes) {
    drawPanelRow(doc, 'Autres entrées (honoraires, intérêts, remboursements…)', `+ ${formatFcfa(t.otherIncomes)}`, 65, boxY + 40, {
      labelWidth: 285,
      valueWidth: 180,
      valueColor: SUCCESS_FG,
    });
  }
  drawPanelRow(doc, 'Versements aux propriétaires', `- ${formatFcfa(t.ownerPayouts)}`, 65, boxY + 40 + ex, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  drawPanelRow(doc, "Dépenses de l'entreprise", `- ${formatFcfa(t.expenses)}`, 65, boxY + 60 + ex, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  doc.moveTo(65, boxY + 82 + ex).lineTo(530, boxY + 82 + ex).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text('Solde net', 65, boxY + 90 + ex);
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(16)
    .fillColor(t.netCashFlow >= 0 ? PRIMARY : DANGER_FG)
    .text(formatFcfa(t.netCashFlow), 300, boxY + 86 + ex, { width: 230, align: 'right' });
  doc
    .font(FONT_SANS)
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Impayés locataires (estimation) : ${formatFcfa(t.tenantArrears)} (${t.tenantArrearsCount}) · ` +
        `Charges impayées : ${formatFcfa(t.unpaidCharges)} (${t.unpaidChargesCount}) · ` +
        `Travaux facturés aux Biens (hors solde entreprise) : ${formatFcfa(t.propertyExpenses)}`,
      65,
      boxY + 116 + ex,
      { width: 460 },
    );
  y += boxHeight + 20;

  function sectionTitle(text) {
    if (y > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text(text, 50, y);
    y = doc.y + 8;
  }

  function line(label, value) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT_SANS).fontSize(9.5).fillColor(INK).text(label, 50, y, { width: 350 });
    doc.font(FONT_MONO_BOLD).fontSize(9.5).fillColor(INK).text(value, 400, y, { width: 145, align: 'right' });
    y += 16;
  }

  if (dashboard.expensesByCategory.length > 0) {
    sectionTitle("Dépenses de l'entreprise par catégorie");
    for (const c of dashboard.expensesByCategory) {
      line(EXPENSE_CATEGORY_LABELS[c.category] ?? c.category, formatFcfa(c.total));
    }
    y += 8;
  }

  if (dashboard.unpaidChargesByType.length > 0) {
    sectionTitle('Charges SONEB/SBEE impayées');
    for (const c of dashboard.unpaidChargesByType) {
      line(`${UTILITY_TYPE_LABELS[c.utilityType] ?? c.utilityType} (${c.count})`, formatFcfa(c.total));
    }
    y += 8;
  }

  if (dashboard.tenantArrears.length > 0) {
    sectionTitle(`Locataires en retard (${dashboard.tenantArrears.length})`);
    const shown = dashboard.tenantArrears.slice(0, 20);
    for (const a of shown) {
      line(`${a.renterName} — ${a.daysLate} j de retard (${a.unpaidMonths} mois)`, formatFcfa(a.amountOwed));
    }
    if (dashboard.tenantArrears.length > shown.length) {
      doc.font(FONT_SANS).fontSize(8.5).fillColor(MUTED).text(`… et ${dashboard.tenantArrears.length - shown.length} autre(s).`, 50, y);
      y = doc.y + 8;
    }
  }

  drawFooter(doc);
  doc.end();
}

/**
 * États financiers SYSCOHADA (livrable 8, "au minimum le squelette") — bilan,
 * compte de résultat et tableau des flux de trésorerie d'un même exercice,
 * réunis dans UN seul document plutôt que 3 exports séparés (comme le
 * ferait un cabinet comptable réel remettant "les états financiers" en un
 * bloc). Calculs partagés avec l'écran (`glFinancialStatements.js`) — jamais
 * recalculés ici, seulement mis en page.
 */
function streamFinancialStatementsPdf(res, { tenant, fiscalYear, incomeStatement, balanceSheet, cashFlow }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="etats-financiers-${fiscalYear.label}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant, {
    title: 'ÉTATS FINANCIERS',
    subtitle: `Exercice ${fiscalYear.label}`,
    meta: [['Exercice', fiscalYear.label], ['Généré le', formatDateFr(new Date().toISOString().slice(0, 10))]],
  });
  doc
    .font(FONT_SANS)
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Situation provisoire établie depuis les écritures enregistrées — le résultat net est une ligne calculée, ' +
        "pas une écriture d'affectation formelle. À faire valider par un expert-comptable avant toute utilisation officielle.",
      50,
      doc.y + 4,
      { width: 495 },
    );

  let y = doc.y + 16;

  function sectionTitle(text) {
    if (y > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text(text, 50, y);
    y = doc.y + 8;
  }

  function line(label, value, { bold = false, valueColor = INK } = {}) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(bold ? FONT_SANS_BOLD : FONT_SANS).fontSize(9.5).fillColor(bold ? INK : INK_SOFT).text(label, 50, y, { width: 350 });
    doc.font(bold ? FONT_MONO_BOLD : FONT_MONO).fontSize(9.5).fillColor(valueColor).text(formatFcfa(value), 400, y, { width: 145, align: 'right' });
    y += bold ? 18 : 15;
  }

  // ── Compte de résultat ────────────────────────────────────────────────
  sectionTitle('Compte de résultat');
  if (incomeStatement.produits.length === 0 && incomeStatement.charges.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucune écriture sur cet exercice.', 50, y);
    y = doc.y + 12;
  } else {
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(MUTED).text('PRODUITS', 50, y);
    y = doc.y + 4;
    for (const p of incomeStatement.produits) line(`${p.code} — ${p.label}`, p.amount);
    line('Total produits', incomeStatement.totalProduits, { bold: true });
    y += 6;
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(MUTED).text('CHARGES', 50, y);
    y = doc.y + 4;
    for (const c of incomeStatement.charges) line(`${c.code} — ${c.label}`, c.amount);
    line('Total charges', incomeStatement.totalCharges, { bold: true });
    y += 10;
    line('Résultat net', incomeStatement.resultatNet, {
      bold: true,
      valueColor: incomeStatement.resultatNet >= 0 ? SUCCESS_FG : DANGER_FG,
    });
  }
  y += 16;

  // ── Bilan ──────────────────────────────────────────────────────────────
  sectionTitle('Bilan');
  if (balanceSheet.actif.length === 0 && balanceSheet.passif.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucune écriture sur cet exercice.', 50, y);
    y = doc.y + 12;
  } else {
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(MUTED).text('ACTIF', 50, y);
    y = doc.y + 4;
    for (const a of balanceSheet.actif) line(`${a.code} — ${a.label}`, a.amount);
    line('Total actif', balanceSheet.totalActif, { bold: true });
    y += 6;
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(MUTED).text('PASSIF', 50, y);
    y = doc.y + 4;
    for (const p of balanceSheet.passif) line(`${p.code} — ${p.label}`, p.amount);
    // Bug corrigé (audit comptabilité avancée du 16/10/2026) : le résultat net (bénéfice OU perte) est
    // une ligne des CAPITAUX PROPRES (passif), jamais de l'actif — une perte le réduit, elle ne
    // s'ajoute pas à l'actif. Cumulé depuis toujours, jamais seulement cet exercice — voir le
    // commentaire détaillé sur `computeBalanceSheet` (pas d'écriture de report à nouveau distincte).
    if (balanceSheet.resultatNet < 0) line('Perte cumulée non affectée', balanceSheet.resultatNet);
    if (balanceSheet.resultatNet > 0) line('Bénéfice cumulé non affecté', balanceSheet.resultatNet);
    line('Total passif', balanceSheet.totalPassif, { bold: true });
  }
  y += 16;

  // ── Tableau des flux de trésorerie ──────────────────────────────────────
  sectionTitle('Tableau des flux de trésorerie');
  line('Trésorerie en début de période', cashFlow.openingBalance);
  line('Encaissements', cashFlow.totalInflows, { valueColor: SUCCESS_FG });
  line('Décaissements', -cashFlow.totalOutflows, { valueColor: DANGER_FG });
  line('Trésorerie en fin de période', cashFlow.closingBalance, { bold: true });

  drawFooter(doc);
  doc.end();
}

module.exports = {
  streamReceiptPdf,
  streamEntryReceiptPdf,
  streamPayslipPdf,
  streamPaymentAdvicePdf,
  streamOperationReceiptPdf,
  streamSubscriptionInvoicePdf,
  streamChargeReceiptPdf,
  streamLeaseContractPdf,
  streamOwnerStatementPdf,
  streamUtilityCarnetPdf,
  streamMoveOutPdf,
  streamMoveInPdf,
  streamFinancialStatementsPdf,
  streamAccountingReportPdf,
  formatFcfa,
  formatMonthLabel,
  formatPeriodLabel,
  formatDateFr,
};
