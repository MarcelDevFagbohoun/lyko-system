'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { DEFAULT_CONTRACT_TEMPLATE, renderContractTemplateSegments } = require('../constants/contract');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');
const { UTILITY_TYPES } = require('../constants/charges');
const { resolveRoleLabels } = require('../constants/roles');
const { compareCondition } = require('./inspection');
const config = require('../config/env');

const EXPENSE_CATEGORY_LABELS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
const UTILITY_TYPE_LABELS = Object.fromEntries(UTILITY_TYPES.map((t) => [t.key, t.label]));

// Charte graphique alignée sur celle de l'application (frontend/tailwind.config.ts)
// — mêmes tokens sémantiques, pour qu'un PDF généré ressemble à un écran de
// Lyko System plutôt qu'à un document généré à part avec ses propres couleurs.
const PRIMARY = '#1E3A8A';
const PRIMARY_BG = '#E8ECF9';
const PRIMARY_BORDER = '#B7C3EA';
const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
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
const FONT_MONO = 'Courier';
const FONT_MONO_BOLD = 'Courier-Bold';

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

/**
 * Dessine des segments `{ text, bold }` (voir `renderContractTemplateSegments`)
 * comme un texte enrichi : les portions en gras s'enchaînent sur la même
 * ligne que le texte autour (API « continued » de PDFKit), pour un rendu
 * fluide qui se retourne à la ligne normalement au lieu d'un bloc par valeur.
 *
 * PDFKit ne repositionne PAS correctement le retour à la ligne EXPLICITE
 * ("\n") à l'intérieur d'un enchaînement « continued » (le texte qui suit
 * hérite du décalage horizontal où le segment précédent s'est arrêté, au
 * lieu de revenir à la marge) — seul le retour à la ligne AUTOMATIQUE (mot
 * trop long pour la largeur) se positionne bien dans un enchaînement. D'où
 * la découpe en lignes ci-dessous : chaque ligne du texte source referme son
 * propre enchaînement avant de passer à la suivante, qui repart alors bien
 * de la marge de gauche.
 */
// Une ligne « Article N — Titre » (convention déjà suivie par les modèles de
// bail rédigés par les DG, ex. celui de KIko Store) : détectée pour lui
// donner un traitement de titre de section au lieu de se fondre dans le
// texte juridique courant. Une ligne qui ne suit pas cette convention (un
// modèle personnalisé sans cette structure) n'est simplement jamais détectée
// — aucun risque de mal interpréter un texte libre quelconque.
const ARTICLE_HEADING_RE = /^article\s+\d+\b/i;

function drawRichText(doc, segments, { width, lineGap = 0 } = {}) {
  const lines = [[]];
  for (const segment of segments) {
    segment.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, bold: segment.bold, mono: segment.mono });
    });
  }

  // `x` explicite (marge gauche du bloc) sur le premier appel de chaque
  // ligne : PDFKit ne lit `x`/`y` que comme arguments positionnels, jamais
  // comme clé de l'objet options — sans ce positionnement explicite, la
  // ligne démarre où le curseur du document a été laissé par l'appelant
  // (ex. une valeur alignée à droite juste avant), le paragraphe se
  // retrouve décalé et sort de la page avant sa fin. Déjà constaté : du
  // texte du bail disparaissait en plein milieu d'une phrase alors qu'il
  // était bien présent dans les données.
  lines.forEach((runs) => {
    if (runs.length === 0) {
      doc.font(FONT_SANS).text('', 50, doc.y, { width, lineGap });
      return;
    }
    // Titre d'article : une ligne composée d'un seul segment de texte brut
    // (aucun {{placeholder}} substitué dedans) commençant par « Article N ».
    const isHeading = runs.length === 1 && !runs[0].bold && !runs[0].mono && ARTICLE_HEADING_RE.test(runs[0].text.trim());
    if (isHeading) {
      doc.moveDown(0.6);
      doc.font(FONT_SANS_BOLD).fontSize(11.5).fillColor(PRIMARY).text(runs[0].text.trim(), 50, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.3);
      return;
    }
    runs.forEach((run, i) => {
      doc.font(run.mono ? FONT_MONO_BOLD : run.bold ? FONT_SANS_BOLD : FONT_SANS);
      doc.fontSize(11).fillColor(INK);
      const continued = i < runs.length - 1;
      if (i === 0) {
        doc.text(run.text, 50, doc.y, { width, lineGap, continued });
      } else {
        doc.text(run.text, { continued });
      }
    });
  });
}

// Les requêtes appelantes aliasent parfois les colonnes du bien joint en
// `property_label`/`property_address`, parfois en `label`/`address` : on
// accepte les deux pour ne pas dépendre d'une convention SQL précise.
function propertyLabel(property) {
  return property.property_label ?? property.label;
}
function propertyAddress(property) {
  return property.property_address ?? property.address;
}

function formatDateFr(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS_FR[m - 1]} ${y}`;
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
function drawHeader(doc, tenant) {
  doc.rect(0, 0, doc.page.width, 5).fill(PRIMARY);

  let textX = 50;
  if (tenant.logo_path) {
    const logoFile = path.join(UPLOADS_ROOT, tenant.logo_path);
    if (fs.existsSync(logoFile)) {
      try {
        doc.image(logoFile, 50, 48, { fit: [50, 50] });
        textX = 112;
      } catch {
        // Logo illisible (format inattendu) : on continue sans image.
      }
    }
  }
  doc
    .fillColor(INK)
    .font(FONT_SANS_BOLD)
    .fontSize(14)
    .text(tenant.company_name, textX, 52);
  doc
    .fillColor(MUTED)
    .font(FONT_MONO)
    .fontSize(8)
    .text(`RCCM ${tenant.rccm}  ·  IFU ${tenant.ifu}  ·  ${tenant.contact_phone}`, textX, 71);

  doc
    .moveTo(50, 112)
    .lineTo(545, 112)
    .strokeColor(BORDER_STRONG)
    .lineWidth(1)
    .stroke();
  doc.y = 134;
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
  const downloadDate = formatDateSlash(new Date().toISOString().slice(0, 10));
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // PDFKit déclenche son saut de page automatique sur `.text()` en
    // comparant `y` à `page.height - page.margins.bottom`, MÊME avec des
    // coordonnées absolues après `switchToPage` — sans ce contournement
    // (bien connu de PDFKit), dessiner le pied de page à y≈780 crée une
    // page BLANCHE supplémentaire à chaque itération au lieu d'écrire sur
    // la page visée (constaté : un document de 2 pages en ressortait avec
    // 4, les pieds de page réels invisibles, relégués sur les pages 3-4).
    const realBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(50, 772)
      .lineTo(545, 772)
      .strokeColor(BORDER)
      .lineWidth(0.75)
      .stroke();
    doc.fontSize(7.5);
    doc.font(FONT_SANS).fillColor(MUTED).text('Document téléchargé le ', 50, 781, { continued: true });
    doc.font(FONT_MONO_BOLD).fillColor(INK_SOFT).text(downloadDate, { continued: true });
    doc.font(FONT_SANS).fillColor(MUTED).text(' · Lyko System.');
    doc
      .fontSize(7.5)
      .fillColor(FAINT)
      .font(FONT_MONO)
      .text(`${i - range.start + 1} / ${range.count}`, 445, 781, { width: 100, align: 'right' });
    if (verificationCode) {
      const verifyHost = config.frontendUrl.replace(/^https?:\/\//, '');
      doc.fontSize(7.5);
      doc.font(FONT_SANS).fillColor(MUTED).text("Vérifiez l'authenticité de ce document sur ", 50, 792, { continued: true });
      doc.font(FONT_MONO_BOLD).fillColor(INK_SOFT).text(`${verifyHost}/verifier`, { continued: true });
      doc.font(FONT_SANS).fillColor(MUTED).text(' avec le code ', { continued: true });
      doc.font(FONT_MONO_BOLD).fillColor(INK_SOFT).text(verificationCode);
    }
    doc.page.margins.bottom = realBottomMargin;
  }
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

/**
 * Quittance de loyer (un paiement = une quittance). Refonte demandée par
 * l'utilisateur (référence : un reçu FedaPay/MTN Mobile Money) : bloc
 * d'identité à gauche, informations du reçu en libellés à droite, bloc
 * « Payé par », tableau (Description/Nombre de mois/P.U./Montant) avec une
 * ligne total mise en évidence.
 *
 * `issuer` : l'employé qui a réellement encaissé ce paiement précis
 * (`rent_payments.recorded_by`) — son cachet/sa signature/son nom sont
 * apposés s'il les a téléversés (`/api/auth/my-signature`), sinon on retombe
 * sur ceux de l'entreprise (`tenant.stamp_path`/`signature_path`), comme
 * avant cette fonctionnalité.
 */
function streamReceiptPdf(res, { tenant, renter, property, lease, payment, receipt, issuer, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receipt.receipt_number}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  // --- Titre (gauche) + informations du reçu, en libellés (droite) ---
  const topY = doc.y;
  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('QUITTANCE', 50, topY, { width: 250 });
  doc.font(FONT_SANS).fontSize(10).fillColor(MUTED).text('Loyer', 50, doc.y);

  const metaX = 335;
  let metaY = topY + 3;
  const metaRows = [
    ['N° reçu', receipt.receipt_number, true],
    ['Date', formatDateFr(payment.paid_at.toISOString().slice(0, 10)), true],
    ['Moyen de paiement', PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method, false],
  ];
  for (const [label, value, mono] of metaRows) {
    doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text(label, metaX, metaY, { width: 210, align: 'right' });
    metaY += 11;
    doc
      .font(mono ? FONT_MONO_BOLD : FONT_SANS_BOLD)
      .fontSize(10)
      .fillColor(INK)
      .text(value, metaX, metaY, { width: 210, align: 'right' });
    metaY += 17;
  }

  let y = Math.max(doc.y, metaY) + 15;

  // --- Payé par ---
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('PAYÉ PAR', 50, y, { characterSpacing: 0.6 });
  y += 13;
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text(`${renter.first_name} ${renter.last_name}`, 50, y);
  y += 15;
  doc.font(FONT_MONO).fontSize(9).fillColor(MUTED).text(renter.phone, 50, y);
  y += 26;

  // --- Tableau : Description / Nombre de mois / P.U. / Montant ---
  const colDesc = { x: 50, width: 225 };
  const colMonths = { x: 275, width: 100 };
  const colUnit = { x: 375, width: 85 };
  const colAmount = { x: 460, width: 85 };

  doc.font(FONT_SANS_BOLD).fontSize(8).fillColor(MUTED);
  doc.text('DESCRIPTION', colDesc.x, y, { width: colDesc.width, characterSpacing: 0.3 });
  doc.text('NOMBRE DE MOIS', colMonths.x, y, { width: colMonths.width, align: 'right', characterSpacing: 0.3 });
  doc.text('P.U.', colUnit.x, y, { width: colUnit.width, align: 'right', characterSpacing: 0.3 });
  doc.text('MONTANT', colAmount.x, y, { width: colAmount.width, align: 'right', characterSpacing: 0.3 });
  y += 14;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(BORDER_STRONG).lineWidth(1).stroke();
  y += 10;

  doc.font(FONT_SANS).fontSize(9.5).fillColor(INK).text(`Loyer — ${formatMonthLabel(payment.covers_month)}`, colDesc.x, y, {
    width: colDesc.width,
  });
  doc.font(FONT_MONO).fontSize(9.5).fillColor(INK).text('1', colMonths.x, y, { width: colMonths.width, align: 'right' });
  doc
    .font(FONT_MONO)
    .fontSize(9.5)
    .fillColor(INK)
    .text(formatFcfa(payment.amount), colUnit.x, y, { width: colUnit.width, align: 'right' });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(9.5)
    .fillColor(INK)
    .text(formatFcfa(payment.amount), colAmount.x, y, { width: colAmount.width, align: 'right' });
  y += 22;

  const totalBoxHeight = 34;
  drawPanel(doc, 275, y, 270, totalBoxHeight, { fill: PRIMARY_BG, stroke: PRIMARY_BORDER });
  doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(INK).text('Montant payé', 290, y + 11, { width: 130 });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(12)
    .fillColor(PRIMARY)
    .text(formatFcfa(payment.amount), 275, y + 9, { width: 255, align: 'right' });
  y += totalBoxHeight + 25;

  doc
    .font(FONT_SANS)
    .fontSize(9)
    .fillColor(INK)
    .text(
      `Le cabinet ${tenant.company_name} certifie avoir reçu de ${renter.first_name} ${renter.last_name} ` +
        `la somme ci-dessus au titre du loyer de ${propertyLabel(property)}, pour la période mentionnée.`,
      50,
      y,
      { width: 495 },
    );
  y = doc.y + 20;

  // --- Cachet / signature : ceux de l'employé qui a encaissé, sinon ceux de l'entreprise ---
  const SIGNATURE_BLOCK_HEIGHT = 130;
  if (y + SIGNATURE_BLOCK_HEIGHT > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    y = doc.y;
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

  const signY = y + 12;
  let signatureDrawn = false;
  if (signatureFile && fs.existsSync(signatureFile)) {
    try {
      doc.image(signatureFile, 50, signY, { fit: [130, 45] });
      signatureDrawn = true;
    } catch {
      // Signature illisible : repli sur la ligne à signer ci-dessous.
    }
  }
  if (!signatureDrawn) {
    doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('_________________________', 50, signY + 30);
  }
  if (stampFile && fs.existsSync(stampFile)) {
    try {
      doc.opacity(0.9).image(stampFile, 200, signY - 15, { fit: [140, 140] }).opacity(1);
    } catch {
      // Cachet illisible : on continue sans (pas bloquant pour la quittance).
    }
  }
  if (issuer) {
    doc
      .font(FONT_SANS_BOLD)
      .fontSize(9)
      .fillColor(INK)
      .text(`${issuer.first_name} ${issuer.last_name}`, 50, signY + 55);
    doc
      .font(FONT_SANS)
      .fontSize(8)
      .fillColor(MUTED)
      .text(resolveRoleLabels(tenant)[issuer.role] ?? issuer.role, 50, signY + 68);
  }

  drawFooter(doc, { verificationCode });
  doc.end();
}

/**
 * Attestation de loyer (« lettre » justifiant la location en cours).
 * Le corps du texte utilise le modèle personnalisé de l'entreprise
 * (Paramètres → Attestation de loyer) s'il existe, sinon le modèle par
 * défaut — même moteur de substitution dans les deux cas. La date est
 * TOUJOURS celle du jour de génération (jamais saisie manuellement).
 * Cachet et signature, si téléversés dans les Paramètres, sont apposés
 * automatiquement près du bloc de signature.
 */
function streamCertificatePdf(res, { tenant, renter, property, lease, issuer, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="attestation-loyer-${renter.last_name}.pdf"`,
  );
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('ATTESTATION DE LOYER', 50, doc.y);
  doc.moveDown(1.3);

  const todayIso = new Date().toISOString().slice(0, 10);
  const startDateIso =
    lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;

  // --- Récapitulatif : les faits essentiels en un coup d'œil, avant les
  // pages de texte juridique qui suivent (même principe que le bloc
  // « Locataire / Bien loué / Durée du bail » du PV de sortie).
  let y = doc.y;
  y += drawRow(doc, 'Locataire', `${renter.first_name} ${renter.last_name}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    y,
  );
  y += drawRow(doc, 'Loyer mensuel', formatFcfa(lease.monthly_rent), y, { mono: true });
  y += drawRow(doc, "Date d'entrée dans les lieux", formatDateFr(startDateIso), y, { mono: true });
  doc.y = y + 15;

  const template = normalizeLineBreaks(tenant.contract_template) || DEFAULT_CONTRACT_TEMPLATE;
  const segments = renderContractTemplateSegments(template, {
    signataire: `${issuer.first_name} ${issuer.last_name}`,
    entreprise: tenant.company_name,
    rccm: tenant.rccm,
    ifu: tenant.ifu,
    locataire: `${renter.first_name} ${renter.last_name}`,
    telephone: renter.phone,
    bien: `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    date_entree: formatDateFr(startDateIso),
    loyer: formatFcfa(lease.monthly_rent),
    date: formatDateFr(todayIso),
  });

  // Valeurs substituées (nom, RCCM, loyer…) en gras pour ressortir du texte
  // juridique fixe autour.
  doc.fontSize(11).fillColor(INK);
  drawRichText(doc, segments, { width: 495, lineGap: 5 });

  doc.moveDown(2.5);

  // Le bloc « Fait à…/Pour le cabinet/signature/cachet » ne doit jamais se
  // couper entre deux pages (la signature d'un côté, le cachet de l'autre,
  // à des kilomètres l'un de l'autre) — page neuve d'avance s'il ne reste
  // pas assez de place pour l'ensemble sur la page en cours.
  const SIGNATURE_BLOCK_HEIGHT = 220;
  if (doc.y + SIGNATURE_BLOCK_HEIGHT > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }

  doc.fontSize(11).fillColor(INK);
  doc.font(FONT_SANS).text('Fait à Cotonou, le ', { continued: true });
  doc.font(FONT_MONO_BOLD).text(formatDateFr(todayIso), { continued: true });
  doc.font(FONT_SANS).text('.');
  doc.moveDown(2);
  doc.font(FONT_SANS_BOLD).fontSize(10).text('Pour le cabinet,');

  // Cachet/signature du DG (signataire légal du bail) — repli sur ceux de
  // l'entreprise s'il n'a pas téléversé les siens, même logique que la
  // quittance (`/api/auth/my-signature`).
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

  const signY = doc.y + 12;
  let signatureDrawn = false;
  if (signatureFile && fs.existsSync(signatureFile)) {
    try {
      doc.image(signatureFile, 50, signY, { fit: [130, 45] });
      signatureDrawn = true;
    } catch {
      // Signature illisible : repli sur la ligne à signer ci-dessous.
    }
  }
  if (!signatureDrawn) {
    doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('_________________________', 50, signY + 30);
  }

  if (stampFile && fs.existsSync(stampFile)) {
    try {
      doc.opacity(0.9).image(stampFile, 200, signY - 15, { fit: [140, 140] }).opacity(1);
    } catch {
      // Cachet illisible : on continue sans (pas bloquant pour l'attestation).
    }
  }

  if (issuer?.role) {
    doc.font(FONT_SANS_BOLD).fontSize(9).fillColor(INK).text(`${issuer.first_name} ${issuer.last_name}`, 50, signY + 55);
    doc
      .font(FONT_SANS)
      .fontSize(8)
      .fillColor(MUTED)
      .text(resolveRoleLabels(tenant)[issuer.role] ?? issuer.role, 50, signY + 68);
  }

  drawFooter(doc, { verificationCode });
  doc.end();
}

// Étape 13 (idée n°9, refonte par zones) : BE/ME/SR, échelle ordonnée
// BE > SR > ME (voir constants/inspection.js) — reprise ici uniquement pour
// l'affichage, cette échelle n'a pas besoin d'être importée pour ça.
const CONDITION_LABELS = { BE: 'Bon état', ME: 'Mauvais état', SR: 'Sous réserve' };
const CONDITION_COLORS = { BE: SUCCESS_FG, ME: DANGER_FG, SR: WARNING_FG };

/** Chemin disque d'un fichier téléversé référencé par son URL publique `/uploads/...`. */
function uploadedFile(publicUrl) {
  return publicUrl ? path.join(UPLOADS_ROOT, publicUrl.replace(/^\/uploads\//, '')) : null;
}

/**
 * PV de sortie & décompte de caution (section 6, Sorties de locataires ;
 * refondu étape 13 idée n°9 avec la grille par zones + signatures). `report`
 * est la forme publique (`toPublicMoveOutReport`) : `zones`, `conductedAt`
 * (chaîne AAAA-MM-JJ), `tenantSignatureUrl`/`agentSignatureUrl`, etc. —
 * jamais la ligne SQL brute. Le rapport est figé à la finalisation (montants
 * stockés, jamais recalculés ici).
 */
function streamMoveOutPdf(res, { tenant, renter, property, lease, report, moveInZones = [] }) {
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

  drawHeader(doc, tenant);

  doc.font(FONT_SANS_BOLD).fontSize(18).fillColor(PRIMARY).text('PV DE SORTIE & DÉCOMPTE DE CAUTION', 50, doc.y);
  drawMetaLine(doc, [
    { text: 'État des lieux de sortie réalisé le ' },
    { text: formatDateFr(report.conductedAt), mono: true },
  ]);

  let y = doc.y + 20;
  y += drawRow(doc, 'Locataire', `${renter.first_name} ${renter.last_name}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    y,
  );
  y += drawRow(
    doc,
    'Durée du bail',
    `${formatDateFr(isoDateOnly(lease.start_date))} au ${formatDateFr(report.conductedAt)}`,
    y,
    { mono: true },
  );

  y += 15;

  for (const zone of report.zones) {
    if (y > doc.page.height - doc.page.margins.bottom - 60) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(PRIMARY).text(zone.label.toUpperCase(), 50, y);
    y = doc.y + 6;

    for (const item of zone.items) {
      if (y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const conditionLabel = item.condition ? CONDITION_LABELS[item.condition] : 'Non renseigné';
      const moveInCondition = moveInConditionByKey.get(`${zone.key}::${item.key}`) ?? null;
      const transition = compareCondition(moveInCondition, item.condition);
      // "->" plutôt que le caractère "→" : hors de l'encodage standard des
      // polices intégrées à PDFKit (Helvetica), qui l'affiche comme un
      // glyphe cassé — même limite que documentée pour "Ð" (`\r` isolé)
      // dans `normalizeLineBreaks`, ici propre au jeu de caractères de la police.
      const conditionText =
        transition === 'degraded'
          ? `${CONDITION_LABELS[moveInCondition]} -> ${conditionLabel}`
          : conditionLabel;
      const line = `${item.label} — ${conditionText}`;
      const h1 = doc.font(FONT_SANS).fontSize(9.5).heightOfString(line, { width: 350 });
      doc.font(FONT_SANS).fontSize(9.5).fillColor(item.condition ? CONDITION_COLORS[item.condition] : MUTED).text(line, 50, y, { width: 350 });
      doc
        .font(FONT_MONO_BOLD)
        .fontSize(9.5)
        .fillColor(item.deduction > 0 ? DANGER_FG : MUTED)
        .text(item.deduction > 0 ? `- ${formatFcfa(item.deduction)}` : '—', 400, y, { width: 145, align: 'right' });
      y += h1;
      if (item.comment) {
        const comment = normalizeLineBreaks(item.comment);
        const h2 = doc.font(FONT_SANS).fontSize(8.5).heightOfString(comment, { width: 350 });
        doc.font(FONT_SANS).fontSize(8.5).fillColor(MUTED).text(comment, 50, y, { width: 350 });
        y += h2;
      }
      // Détail de facturation (catalogue) : une sous-ligne par élément
      // choisi, pour que le décompte soit lisible ligne par ligne, pas
      // seulement un total par poste.
      if (item.billing?.lines?.length > 0) {
        for (const l of item.billing.lines) {
          const qtyText = l.quantity > 1 ? ` × ${l.quantity}` : '';
          const billingLine = `• ${l.label}${qtyText}`;
          const h3 = doc.font(FONT_SANS).fontSize(8.5).heightOfString(billingLine, { width: 300 });
          doc.font(FONT_SANS).fontSize(8.5).fillColor(MUTED).text(billingLine, 60, y, { width: 300 });
          doc
            .font(FONT_MONO)
            .fontSize(8.5)
            .fillColor(MUTED)
            .text(formatFcfa(l.unitPrice * l.quantity), 400, y, { width: 145, align: 'right' });
          y += h3;
        }
      }
      y += 8;
    }
    y += 6;
  }

  if (report.otherDeductionsAmount > 0) {
    const line = report.otherDeductionsNote || 'Autres retenues';
    doc.font(FONT_SANS).fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 350 });
    doc
      .font(FONT_MONO_BOLD)
      .fontSize(9.5)
      .fillColor(DANGER_FG)
      .text(`- ${formatFcfa(report.otherDeductionsAmount)}`, 400, y, { width: 145, align: 'right' });
    y += 20;
  }

  y += 10;
  if (y > doc.page.height - doc.page.margins.bottom - 90) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const boxHeight = 90;
  drawPanel(doc, 50, y, 495, boxHeight);
  const boxY = y + 14;
  drawPanelRow(doc, 'Caution initiale', formatFcfa(report.depositAmount), 65, boxY, { labelWidth: 335, valueWidth: 130 });
  drawPanelRow(doc, 'Total des retenues', `- ${formatFcfa(report.totalDeductions)}`, 65, boxY + 20, {
    labelWidth: 335,
    valueWidth: 130,
    valueColor: DANGER_FG,
  });
  doc.moveTo(65, boxY + 42).lineTo(530, boxY + 42).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text('Net à restituer au locataire', 65, boxY + 50);
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(16)
    .fillColor(PRIMARY)
    .text(formatFcfa(report.netRefund), 350, boxY + 46, { width: 180, align: 'right' });

  y += boxHeight + 25;
  if (report.generalNotes) {
    const h = doc.font(FONT_SANS).fontSize(9).heightOfString(normalizeLineBreaks(report.generalNotes), { width: 495 });
    doc.font(FONT_SANS).fontSize(9).fillColor(INK).text(normalizeLineBreaks(report.generalNotes), 50, y, { width: 495 });
    y += h + 15;
  }

  // Signatures (locataire + agent) — capturées à la finalisation de la fiche.
  const sigHeight = 110;
  if (y > doc.page.height - doc.page.margins.bottom - sigHeight) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 15;
  doc.font(FONT_SANS_BOLD).fontSize(10).fillColor(INK).text('Signature du locataire', 50, y, { width: 230 });
  doc.font(FONT_SANS_BOLD).fontSize(10).fillColor(INK).text("Signature de l'agent", 315, y, { width: 230 });
  const sigImgY = y + 16;
  const tenantSigFile = uploadedFile(report.tenantSignatureUrl);
  const agentSigFile = uploadedFile(report.agentSignatureUrl);
  doc.rect(50, sigImgY, 230, 70).strokeColor(BORDER).lineWidth(1).stroke();
  doc.rect(315, sigImgY, 230, 70).strokeColor(BORDER).lineWidth(1).stroke();
  try {
    if (tenantSigFile && fs.existsSync(tenantSigFile)) doc.image(tenantSigFile, 55, sigImgY + 5, { fit: [220, 60] });
    if (agentSigFile && fs.existsSync(agentSigFile)) doc.image(agentSigFile, 320, sigImgY + 5, { fit: [220, 60] });
  } catch {
    // Signature illisible : on continue sans (pas bloquant pour le PV).
  }

  drawFooter(doc);
  doc.end();
}

const PAYMENT_METHOD_LABELS = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  kkiapay: 'Paiement en ligne (KKiaPay)',
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

  drawHeader(doc, tenant);

  const topY = doc.y;
  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('CARNET DES CHARGES', 50, topY, { width: 300 });
  doc.font(FONT_SANS).fontSize(10).fillColor(MUTED).text('Eau (SONEB) et électricité (SBEE)', 50, doc.y);

  const metaX = 335;
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('Période', metaX, topY + 3, { width: 210, align: 'right' });
  doc.font(FONT_SANS_BOLD).fontSize(10).fillColor(INK).text(periodLabelFr(carnet.from, carnet.to), metaX, topY + 14, { width: 210, align: 'right' });
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('Généré le', metaX, topY + 30, { width: 210, align: 'right' });
  doc.font(FONT_MONO_BOLD).fontSize(10).fillColor(INK).text(formatDateFr(new Date().toISOString().slice(0, 10)), metaX, topY + 41, { width: 210, align: 'right' });

  let y = Math.max(doc.y, topY + 41 + 17) + 12;

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
function streamOwnerStatementPdf(res, { tenant, owner, units, payouts, charges = null, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="releve-${owner.name.replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  // --- Titre (gauche) + méta-données, en libellés (droite) ---
  const topY = doc.y;
  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('RELEVÉ', 50, topY, { width: 250 });
  doc.font(FONT_SANS).fontSize(10).fillColor(MUTED).text('Propriétaire', 50, doc.y);

  const metaX = 335;
  doc.font(FONT_SANS).fontSize(8).fillColor(MUTED).text('Généré le', metaX, topY + 3, { width: 210, align: 'right' });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(10)
    .fillColor(INK)
    .text(formatDateFr(new Date().toISOString().slice(0, 10)), metaX, topY + 14, { width: 210, align: 'right' });

  let y = Math.max(doc.y, topY + 14 + 17) + 15;

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

  drawHeader(doc, tenant);

  doc.font(FONT_SANS_BOLD).fontSize(18).fillColor(PRIMARY).text('RAPPORT MENSUEL', 50, doc.y);
  drawMetaLine(doc, [{ text: periodLabel, mono: true }]);

  let y = doc.y + 10;
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
  const boxHeight = 150;
  drawPanel(doc, 50, y, 495, boxHeight);
  const boxY = y + 14;
  drawPanelRow(doc, 'Loyers encaissés', `+ ${formatFcfa(t.rentCollected)}`, 65, boxY, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: SUCCESS_FG,
  });
  drawPanelRow(doc, "Frais d'agence à l'entrée (produit du cabinet)", `+ ${formatFcfa(t.entryFeesCollected)}`, 65, boxY + 20, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: SUCCESS_FG,
  });
  drawPanelRow(doc, 'Versements aux propriétaires', `- ${formatFcfa(t.ownerPayouts)}`, 65, boxY + 40, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  drawPanelRow(doc, 'Dépenses du cabinet', `- ${formatFcfa(t.expenses)}`, 65, boxY + 60, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  doc.moveTo(65, boxY + 82).lineTo(530, boxY + 82).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text('Solde net', 65, boxY + 90);
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(16)
    .fillColor(t.netCashFlow >= 0 ? PRIMARY : DANGER_FG)
    .text(formatFcfa(t.netCashFlow), 300, boxY + 86, { width: 230, align: 'right' });
  doc
    .font(FONT_SANS)
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Impayés locataires (estimation) : ${formatFcfa(t.tenantArrears)} (${t.tenantArrearsCount}) · ` +
        `Charges impayées : ${formatFcfa(t.unpaidCharges)} (${t.unpaidChargesCount}) · ` +
        `Travaux facturés aux Biens (hors solde cabinet) : ${formatFcfa(t.propertyExpenses)}`,
      65,
      boxY + 116,
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
    sectionTitle('Dépenses du cabinet par catégorie');
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

  drawHeader(doc, tenant);
  doc.font(FONT_SANS_BOLD).fontSize(18).fillColor(PRIMARY).text('ÉTATS FINANCIERS', 50, doc.y);
  drawMetaLine(doc, [{ text: `Exercice ${fiscalYear.label}`, mono: true }]);
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
    if (balanceSheet.resultatNet < 0) line('Perte de l\'exercice', -balanceSheet.resultatNet);
    line('Total actif', balanceSheet.totalActif, { bold: true });
    y += 6;
    doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(MUTED).text('PASSIF', 50, y);
    y = doc.y + 4;
    for (const p of balanceSheet.passif) line(`${p.code} — ${p.label}`, p.amount);
    if (balanceSheet.resultatNet > 0) line("Bénéfice de l'exercice", balanceSheet.resultatNet);
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
  streamCertificatePdf,
  streamOwnerStatementPdf,
  streamUtilityCarnetPdf,
  streamMoveOutPdf,
  streamFinancialStatementsPdf,
  streamAccountingReportPdf,
  formatFcfa,
  formatMonthLabel,
  formatDateFr,
};
