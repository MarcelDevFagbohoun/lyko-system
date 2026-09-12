'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { DEFAULT_CONTRACT_TEMPLATE, renderContractTemplateSegments } = require('../constants/contract');

const PRIMARY = '#1E3A8A';
const INK = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

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
      if (part.length > 0) lines[lines.length - 1].push({ text: part, bold: segment.bold });
    });
  }

  lines.forEach((runs) => {
    if (runs.length === 0) {
      doc.font('Helvetica').text('', { width, lineGap });
      return;
    }
    runs.forEach((run, i) => {
      doc.font(run.bold ? 'Helvetica-Bold' : 'Helvetica');
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

/** En-tête commun : logo (si présent), nom du cabinet, ligne de séparation. */
function drawHeader(doc, tenant) {
  let textX = 50;
  if (tenant.logo_path) {
    const logoFile = path.join(UPLOADS_ROOT, tenant.logo_path);
    if (fs.existsSync(logoFile)) {
      try {
        doc.image(logoFile, 50, 45, { fit: [50, 50] });
        textX = 112;
      } catch {
        // Logo illisible (format inattendu) : on continue sans image.
      }
    }
  }
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(tenant.company_name, textX, 50);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(`RCCM ${tenant.rccm} · IFU ${tenant.ifu} · ${tenant.contact_phone}`, textX, 68);

  doc
    .moveTo(50, 110)
    .lineTo(545, 110)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();
  doc.y = 130;
}

function drawFooter(doc) {
  doc
    .fontSize(7.5)
    .fillColor(MUTED)
    .font('Helvetica')
    .text('Document généré par Lyko System.', 50, 780, { align: 'center', width: 495 });
}

// Retourne la hauteur réellement occupée (la valeur peut passer sur plusieurs
// lignes, ex. bien loué + adresse) afin que l'appelant avance correctement.
function drawRow(doc, label, value, y) {
  const valueHeight = doc.font('Helvetica-Bold').fontSize(10).heightOfString(value, { width: 315 });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(label, 50, y, { width: 180 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, 230, y, { width: 315 });
  return Math.max(valueHeight, 14) + 8;
}

/** Quittance de loyer (un paiement = une quittance). */
function streamReceiptPdf(res, { tenant, renter, property, lease, payment, receipt }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${receipt.receipt_number}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font('Helvetica-Bold').fontSize(20).fillColor(PRIMARY).text('QUITTANCE DE LOYER', 50, doc.y);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`N° ${receipt.receipt_number} · émise le ${formatDateFr(receipt.issued_at.toISOString().slice(0, 10))}`);

  let y = doc.y + 25;
  y += drawRow(doc, 'Locataire', `${renter.first_name} ${renter.last_name}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    y,
  );
  y += drawRow(doc, 'Période concernée', formatMonthLabel(payment.covers_month), y);
  y += drawRow(doc, 'Mode de règlement', PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method, y);
  y += drawRow(doc, 'Date de paiement', formatDateFr(payment.paid_at.toISOString().slice(0, 10)), y);

  y += 15;
  const amountBoxHeight = 50;
  doc
    .rect(50, y, 495, amountBoxHeight)
    .fillAndStroke('#F1F5F9', BORDER);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text('Montant reçu', 65, y + 14);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(PRIMARY)
    .text(formatFcfa(payment.amount), 65, y + 26);

  y += amountBoxHeight + 25;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(INK)
    .text(
      `Le cabinet ${tenant.company_name} certifie avoir reçu de ${renter.first_name} ${renter.last_name} ` +
        `la somme ci-dessus au titre du loyer du bien désigné, pour la période mentionnée.`,
      50,
      y,
      { width: 495 },
    );

  drawFooter(doc);
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
function streamCertificatePdf(res, { tenant, renter, property, lease, issuer }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="attestation-loyer-${renter.last_name}.pdf"`,
  );
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font('Helvetica-Bold').fontSize(20).fillColor(PRIMARY).text('ATTESTATION DE LOYER', 50, doc.y);
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

  doc.font('Helvetica').fontSize(11).text(`Fait à Cotonou, le ${formatDateFr(todayIso)}.`);
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(10).text('Pour le cabinet,');

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
    doc.font('Helvetica').fontSize(10).text('_________________________', 50, signY + 30);
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

  drawFooter(doc);
  doc.end();
}

const CONDITION_LABELS = { bon: 'Bon', moyen: 'Moyen', mauvais: 'Mauvais' };

/**
 * PV de sortie & décompte de caution (section 6, Sorties de locataires) :
 * grille contradictoire des retenues (état des lieux de sortie), puis le
 * calcul caution initiale → retenues → net à restituer. Le rapport est
 * figé au moment de la sortie (montants stockés, jamais recalculés).
 */
function streamMoveOutPdf(res, { tenant, renter, property, lease, report }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="pv-sortie-${renter.last_name}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font('Helvetica-Bold').fontSize(18).fillColor(PRIMARY).text('PV DE SORTIE & DÉCOMPTE DE CAUTION', 50, doc.y);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`État des lieux de sortie réalisé le ${formatDateFr(isoDateOnly(report.conducted_at))}`);

  let y = doc.y + 20;
  y += drawRow(doc, 'Locataire', `${renter.first_name} ${renter.last_name}`, y);
  y += drawRow(
    doc,
    'Bien loué',
    `${propertyLabel(property)}${propertyAddress(property) ? ', ' + propertyAddress(property) : ''}`,
    y,
  );
  y += drawRow(doc, 'Durée du bail', `${formatDateFr(isoDateOnly(lease.start_date))} au ${formatDateFr(isoDateOnly(report.conducted_at))}`, y);

  y += 15;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('État des lieux de sortie', 50, y);
  y = doc.y + 10;

  for (const item of report.items) {
    const line = `${item.label} — ${CONDITION_LABELS[item.condition] ?? item.condition}`;
    const h1 = doc.font('Helvetica').fontSize(9.5).heightOfString(line, { width: 350 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 350 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(item.deduction > 0 ? '#B91C1C' : MUTED)
      .text(item.deduction > 0 ? `- ${formatFcfa(item.deduction)}` : '—', 400, y, { width: 145, align: 'right' });
    y += h1;
    if (item.comment) {
      const comment = normalizeLineBreaks(item.comment);
      const h2 = doc.font('Helvetica').fontSize(8.5).heightOfString(comment, { width: 350 });
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(comment, 50, y, { width: 350 });
      y += h2;
    }
    y += 8;
  }

  if (report.other_deductions_amount > 0) {
    const line = report.other_deductions_note || 'Autres retenues';
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 350 });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#B91C1C')
      .text(`- ${formatFcfa(report.other_deductions_amount)}`, 400, y, { width: 145, align: 'right' });
    y += 20;
  }

  y += 10;
  const boxHeight = 90;
  doc.rect(50, y, 495, boxHeight).fillAndStroke('#F1F5F9', BORDER);
  const boxY = y + 14;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Caution initiale', 65, boxY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(formatFcfa(report.deposit_amount), 400, boxY, { width: 130, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Total des retenues', 65, boxY + 20);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#B91C1C').text(`- ${formatFcfa(report.total_deductions)}`, 400, boxY + 20, { width: 130, align: 'right' });
  doc.moveTo(65, boxY + 42).lineTo(530, boxY + 42).strokeColor(BORDER).lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Net à restituer au locataire', 65, boxY + 50);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(PRIMARY).text(formatFcfa(report.net_refund), 350, boxY + 46, { width: 180, align: 'right' });

  y += boxHeight + 25;
  if (report.general_notes) {
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(normalizeLineBreaks(report.general_notes), 50, y, { width: 495 });
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
function streamOwnerStatementPdf(res, { tenant, owner, units, payouts }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="releve-${owner.name.replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  drawHeader(doc, tenant);

  doc.font('Helvetica-Bold').fontSize(20).fillColor(PRIMARY).text('RELEVÉ PROPRIÉTAIRE', 50, doc.y);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Généré le ${formatDateFr(new Date().toISOString().slice(0, 10))}`);

  let y = doc.y + 20;
  y += drawRow(doc, 'Propriétaire', owner.name, y);
  if (owner.phone) y += drawRow(doc, 'Téléphone', owner.phone, y);
  if (owner.address) y += drawRow(doc, 'Adresse', owner.address, y);

  const occupiedRent = units.filter((u) => u.status === 'loue').reduce((sum, u) => sum + u.monthlyRent, 0);
  y += drawRow(doc, 'Loyers mensuels en cours', formatFcfa(occupiedRent), y);

  y += 15;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Patrimoine géré', 50, y);
  y = doc.y + 10;

  if (units.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Aucun bien enregistré.', 50, y);
    y = doc.y + 10;
  } else {
    for (const u of units) {
      const line = `${u.propertyCode} · ${u.unitCode} — ${u.designationLabel}${u.address ? `, ${u.address}` : ''}`;
      const detail = `${UNIT_STATUS_LABELS[u.status] ?? u.status} · ${formatFcfa(u.monthlyRent)}/mois${
        u.currentRenter ? ` · Locataire : ${u.currentRenter}` : ''
      }`;
      const h1 = doc.font('Helvetica-Bold').fontSize(9.5).heightOfString(line, { width: 495 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 495 });
      y += h1 + 2;
      const h2 = doc.font('Helvetica').fontSize(9).heightOfString(detail, { width: 495 });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(detail, 50, y, { width: 495 });
      y += h2 + 10;
    }
  }

  y += 10;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Historique des versements', 50, y);
  y = doc.y + 10;

  if (payouts.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Aucun versement enregistré.', 50, y);
  } else {
    for (const p of payouts) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const line = `${formatDateFr(isoDateOnly(p.paidAt))} · ${p.periodLabel} · ${p.paymentMethodLabel}`;
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(line, 50, y, { width: 350 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(formatFcfa(p.amount), 400, y, {
        width: 145,
        align: 'right',
      });
      y += 18;
    }
  }

  drawFooter(doc);
  doc.end();
}

function isoDateOnly(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

module.exports = {
  streamReceiptPdf,
  streamCertificatePdf,
  streamOwnerStatementPdf,
  streamMoveOutPdf,
  formatFcfa,
  formatMonthLabel,
  formatDateFr,
};
