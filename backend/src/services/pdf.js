'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { DEFAULT_CONTRACT_TEMPLATE, renderContractTemplateSegments } = require('../constants/contract');
const { EXPENSE_CATEGORIES } = require('../constants/expenses');
const { UTILITY_TYPES } = require('../constants/charges');
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
function drawRichText(doc, segments, { width, lineGap = 0 } = {}) {
  const lines = [[]];
  for (const segment of segments) {
    segment.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, bold: segment.bold, mono: segment.mono });
    });
  }

  lines.forEach((runs) => {
    if (runs.length === 0) {
      doc.font(FONT_SANS).text('', { width, lineGap });
      return;
    }
    runs.forEach((run, i) => {
      doc.font(run.mono ? FONT_MONO_BOLD : run.bold ? FONT_SANS_BOLD : FONT_SANS);
      const continued = i < runs.length - 1;
      doc.text(run.text, i === 0 ? { width, lineGap, continued } : { continued });
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

/** Quittance de loyer (un paiement = une quittance). */
function streamReceiptPdf(res, { tenant, renter, property, lease, payment, receipt, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receipt.receipt_number}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('QUITTANCE DE LOYER', 50, doc.y);
  drawMetaLine(doc, [
    { text: 'N° ' },
    { text: receipt.receipt_number, mono: true },
    { text: ' · émise le ' },
    { text: formatDateFr(receipt.issued_at.toISOString().slice(0, 10)), mono: true },
  ]);

  let y = doc.y + 25;
  y += drawRow(doc, 'Locataire', `${renter.first_name} ${renter.last_name}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    y,
  );
  y += drawRow(doc, 'Période concernée', formatMonthLabel(payment.covers_month), y, { mono: true });
  y += drawRow(doc, 'Mode de règlement', PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method, y);
  y += drawRow(doc, 'Date de paiement', formatDateFr(payment.paid_at.toISOString().slice(0, 10)), y, { mono: true });

  y += 15;
  const amountBoxHeight = 54;
  drawPanel(doc, 50, y, 495, amountBoxHeight);
  doc
    .font(FONT_SANS)
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('MONTANT REÇU', 65, y + 15, { characterSpacing: 0.6 });
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(20)
    .fillColor(PRIMARY)
    .text(formatFcfa(payment.amount), 65, y + 27);

  y += amountBoxHeight + 25;
  doc
    .font(FONT_SANS)
    .fontSize(9)
    .fillColor(INK)
    .text(
      `Le cabinet ${tenant.company_name} certifie avoir reçu de ${renter.first_name} ${renter.last_name} ` +
        `la somme ci-dessus au titre du loyer du bien désigné, pour la période mentionnée.`,
      50,
      y,
      { width: 495 },
    );

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
  doc.moveDown(2);

  const todayIso = new Date().toISOString().slice(0, 10);
  const startDateIso =
    lease.start_date instanceof Date ? lease.start_date.toISOString().slice(0, 10) : lease.start_date;

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

  const signY = doc.y + 12;
  let signatureDrawn = false;
  if (tenant.signature_path) {
    const sigFile = path.join(UPLOADS_ROOT, tenant.signature_path);
    if (fs.existsSync(sigFile)) {
      try {
        doc.image(sigFile, 50, signY, { fit: [130, 45] });
        signatureDrawn = true;
      } catch {
        // Signature illisible : repli sur la ligne à signer ci-dessous.
      }
    }
  }
  if (!signatureDrawn) {
    doc.font(FONT_SANS).fontSize(10).fillColor(INK).text('_________________________', 50, signY + 30);
  }

  if (tenant.stamp_path) {
    const stampFile = path.join(UPLOADS_ROOT, tenant.stamp_path);
    if (fs.existsSync(stampFile)) {
      try {
        doc.opacity(0.9).image(stampFile, 200, signY - 15, { fit: [140, 140] }).opacity(1);
      } catch {
        // Cachet illisible : on continue sans (pas bloquant pour l'attestation).
      }
    }
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
function streamMoveOutPdf(res, { tenant, renter, property, lease, report }) {
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
      const line = `${item.label} — ${conditionLabel}`;
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
};

const UNIT_STATUS_LABELS = { libre: 'Libre', loue: 'Loué', reserve: 'Réservé' };

/**
 * Relevé propriétaire : patrimoine géré (biens/unités, statut, loyer, locataire
 * en place) et historique des versements déjà effectués. Généré à la demande,
 * jamais stocké — comme l'attestation de loyer, la date est celle du jour.
 */
function streamOwnerStatementPdf(res, { tenant, owner, units, payouts, verificationCode }) {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="releve-${owner.name.replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font(FONT_SANS_BOLD).fontSize(20).fillColor(PRIMARY).text('RELEVÉ PROPRIÉTAIRE', 50, doc.y);
  drawMetaLine(doc, [
    { text: 'Généré le ' },
    { text: formatDateFr(new Date().toISOString().slice(0, 10)), mono: true },
  ]);

  let y = doc.y + 20;
  y += drawRow(doc, 'Propriétaire', owner.name, y);
  if (owner.phone) y += drawRow(doc, 'Téléphone', owner.phone, y, { mono: true });
  if (owner.address) y += drawRow(doc, 'Adresse', owner.address, y);

  const occupiedRent = units.filter((u) => u.status === 'loue').reduce((sum, u) => sum + u.monthlyRent, 0);
  y += drawRow(doc, 'Loyers mensuels en cours', formatFcfa(occupiedRent), y, { mono: true });

  y += 15;
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Patrimoine géré', 50, y);
  y = doc.y + 10;

  if (units.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun bien enregistré.', 50, y);
    y = doc.y + 10;
  } else {
    for (const u of units) {
      const line = `${u.propertyCode} · ${u.unitCode} — ${u.designationLabel}${u.address ? `, ${u.address}` : ''}`;
      const detail = `${UNIT_STATUS_LABELS[u.status] ?? u.status} · ${formatFcfa(u.monthlyRent)}/mois${
        u.currentRenter ? ` · Locataire : ${u.currentRenter}` : ''
      }`;
      const h1 = doc.font(FONT_SANS_BOLD).fontSize(9.5).heightOfString(line, { width: 495 });
      doc.font(FONT_SANS_BOLD).fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 495 });
      y += h1 + 2;
      const h2 = doc.font(FONT_SANS).fontSize(9).heightOfString(detail, { width: 495 });
      doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text(detail, 50, y, { width: 495 });
      y += h2 + 10;
    }
  }

  y += 10;
  doc.font(FONT_SANS_BOLD).fontSize(12).fillColor(INK).text('Historique des versements', 50, y);
  y = doc.y + 10;

  if (payouts.length === 0) {
    doc.font(FONT_SANS).fontSize(9).fillColor(MUTED).text('Aucun versement enregistré.', 50, y);
  } else {
    for (const p of payouts) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const line = `${formatDateFr(isoDateOnly(p.paidAt))} · ${p.periodLabel} · ${p.paymentMethodLabel}`;
      doc.font(FONT_SANS).fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 350 });
      doc.font(FONT_MONO_BOLD).fontSize(9.5).fillColor(INK).text(formatFcfa(p.amount), 400, y, {
        width: 145,
        align: 'right',
      });
      y += 18;
    }
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
  const boxHeight = 130;
  drawPanel(doc, 50, y, 495, boxHeight);
  const boxY = y + 14;
  drawPanelRow(doc, 'Loyers encaissés', `+ ${formatFcfa(t.rentCollected)}`, 65, boxY, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: SUCCESS_FG,
  });
  drawPanelRow(doc, 'Versements aux propriétaires', `- ${formatFcfa(t.ownerPayouts)}`, 65, boxY + 20, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  drawPanelRow(doc, 'Dépenses du cabinet', `- ${formatFcfa(t.expenses)}`, 65, boxY + 40, {
    labelWidth: 285,
    valueWidth: 180,
    valueColor: DANGER_FG,
  });
  doc.moveTo(65, boxY + 62).lineTo(530, boxY + 62).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font(FONT_SANS_BOLD).fontSize(11).fillColor(INK).text('Solde net', 65, boxY + 70);
  doc
    .font(FONT_MONO_BOLD)
    .fontSize(16)
    .fillColor(t.netCashFlow >= 0 ? PRIMARY : DANGER_FG)
    .text(formatFcfa(t.netCashFlow), 300, boxY + 66, { width: 230, align: 'right' });
  doc
    .font(FONT_SANS)
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Impayés locataires (estimation) : ${formatFcfa(t.tenantArrears)} (${t.tenantArrearsCount}) · ` +
        `Charges impayées : ${formatFcfa(t.unpaidCharges)} (${t.unpaidChargesCount}) · ` +
        `Travaux facturés aux Biens (hors solde cabinet) : ${formatFcfa(t.propertyExpenses)}`,
      65,
      boxY + 96,
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

module.exports = {
  streamReceiptPdf,
  streamCertificatePdf,
  streamOwnerStatementPdf,
  streamMoveOutPdf,
  streamAccountingReportPdf,
  formatFcfa,
  formatMonthLabel,
  formatDateFr,
};
