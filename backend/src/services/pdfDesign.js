'use strict';

/**
 * Modèle graphique commun de TOUS les PDF Africa Immo Management (reçus, fiches de paie, PV, contrats, relevés, rapports).
 * Référence : le « Procès-verbal de sortie » validé par le DG — bandeau bleu marine avec logo, titre et carte de
 * références ; sections à barre d'accent ; cartes d'information arrondies ; tableaux à en-tête marine et lignes
 * zébrées ; montant principal dans une barre marine ; signatures en cartes ; pied de page identique partout.
 * Contrastes élevés (texte foncé sur fond clair, texte blanc sur marine) pour rester lisibles à l'impression.
 */
const fs = require('fs');
const { parseActivities } = require('../utils/activities');
const path = require('path');

const C = {
  NAVY: '#0B2A5B',
  NAVY_SOFT: '#17357A',
  ACCENT: '#1F5BBF',
  TINT: '#EAF0FB',
  TINT_BORDER: '#C5D3EE',
  INK: '#0F172A',
  INK_SOFT: '#334155',
  MUTED: '#5B6B82',
  ZEBRA: '#EEF3FB',
  WHITE: '#FFFFFF',
  SUCCESS: '#047857',
  SUCCESS_BG: '#E3F5EC',
  DANGER: '#B91C1C',
  DANGER_BG: '#FDEAEA',
  WARNING: '#B45309',
  WARNING_BG: '#FDF2DC',
  LIGHT_ON_NAVY: '#B6C7E8',
};
const F = { SANS: 'Helvetica', BOLD: 'Helvetica-Bold', ITALIC: 'Helvetica-Oblique', MONO: 'Courier', MONO_BOLD: 'Courier-Bold' };
const LEFT = 50;
const WIDTH = 495;
const BANNER_H = 118;
const CONTENT_TOP = 142;
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

function fcfa(amount) {
  const n = Math.round(Number(amount));
  const grouped = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped} FCFA`;
}

// --- Montant en lettres (français, « Arrêté … à la somme de … francs CFA ») -------------------------------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n) {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    return `${TENS[t]}${u === 1 ? ' et un' : `-${UNITS[u]}`}`;
  }
  if (n < 80) {
    const u = n - 60;
    return `soixante${u === 11 ? ' et onze' : `-${UNITS[u]}`}`;
  }
  const u = n - 80;
  return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITS[u]}`;
}

function below1000(n, { final = true } = {}) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h > 0) {
    if (h === 1) parts.push('cent');
    else parts.push(`${UNITS[h]} cent${r === 0 && final ? 's' : ''}`);
  }
  if (r > 0) parts.push(r === 80 && !final ? 'quatre-vingt' : below100(r));
  return parts.join(' ');
}

function amountInWordsFr(value) {
  let n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'zéro';
  const groups = [
    [1_000_000_000, 'milliard'],
    [1_000_000, 'million'],
  ];
  const out = [];
  for (const [size, name] of groups) {
    const q = Math.floor(n / size);
    if (q > 0) {
      out.push(`${below1000(q)} ${name}${q > 1 ? 's' : ''}`);
      n %= size;
    }
  }
  const th = Math.floor(n / 1000);
  if (th > 0) {
    out.push(th === 1 ? 'mille' : `${below1000(th, { final: false })} mille`);
    n %= 1000;
  }
  if (n > 0) out.push(below1000(n));
  return out.join(' ');
}

function sentenceAmount(amount, prefix) {
  const words = amountInWordsFr(amount);
  return `${prefix} ${words} (${fcfa(amount).replace(' FCFA', '')}) francs CFA.`;
}

function imageIfExists(relativePath) {
  if (!relativePath) return null;
  const file = path.join(UPLOADS_ROOT, relativePath.replace(/^\/(uploads|api\/files)\//, ''));
  return fs.existsSync(file) ? file : null;
}


const ACTIVITY_LINE_H = 10.5;
const ACTIVITY_MAX_LINES = 3;

/** Découpe les activités en lignes (retour à la ligne automatique si elles sont nombreuses), « +N » si tout ne tient pas. */
function layoutActivityList(doc, activities, width, { font = F.SANS, size = 7.5 } = {}) {
  const list = Array.isArray(activities) ? activities.filter(Boolean) : [];
  if (list.length === 0) return { lines: [], height: 0 };
  doc.font(font).fontSize(size);
  const BULLET = 9; // puce + espace
  const GAP = 12;
  const lines = [[]];
  let x = 0;
  for (let i = 0; i < list.length; i += 1) {
    const w = BULLET + doc.widthOfString(list[i]);
    const cur = lines[lines.length - 1];
    if (cur.length > 0 && x + GAP + w > width) {
      if (lines.length === ACTIVITY_MAX_LINES) {
        cur.push({ text: `+${list.length - i}`, w: BULLET + doc.widthOfString(`+${list.length - i}`), more: true });
        return { lines, height: lines.length * ACTIVITY_LINE_H };
      }
      lines.push([]);
      x = 0;
    }
    const line = lines[lines.length - 1];
    x += (line.length > 0 ? GAP : 0) + w;
    line.push({ text: list[i], w });
  }
  return { lines, height: lines.length * ACTIVITY_LINE_H };
}

/** Liste non ordonnée en ligne : « • Activité  • Activité … », sous le RCCM/IFU, dans le bloc d'identité. Renvoie la hauteur. */
function drawActivityList(doc, layout, x, y, { font = F.SANS, size = 7.5, color = C.INK_SOFT, bullet = C.ACCENT } = {}) {
  layout.lines.forEach((line, li) => {
    let cx = x;
    line.forEach((item, i) => {
      if (i > 0) cx += 12;
      const cy = y + li * ACTIVITY_LINE_H;
      if (!item.more) doc.circle(cx + 2, cy + size / 2 - 0.3, 1.4).fill(bullet);
      doc.font(font).fontSize(size).fillColor(color).text(item.text, cx + 9, cy, { lineBreak: false });
      cx += item.w;
    });
  });
  return layout.height;
}

/** Bandeau de première page : logo (sur tuile blanche), société, titre, sous-titre, carte de références. */
function drawBanner(doc, tenant, { title, subtitle = null, meta = [], light = false } = {}) {
  if (light) return drawLightBanner(doc, tenant, { title, subtitle, meta });
  const w = doc.page.width;
  const acts = layoutActivityList(doc, parseActivities(tenant.activities), (meta.length > 0 ? 300 : WIDTH) - (imageIfExists(tenant.logo_path) ? 52 : 0));
  const extra = acts.height > 0 ? acts.height + 4 : 0;
  const bannerH = BANNER_H + extra;
  doc.rect(0, 0, w, bannerH).fill(C.NAVY);
  doc.rect(0, bannerH, w, 4).fill(C.ACCENT);

  let textX = LEFT;
  const logoFile = imageIfExists(tenant.logo_path);
  if (logoFile) {
    try {
      doc.roundedRect(LEFT, 24, 40, 40, 7).fill(C.WHITE);
      doc.image(logoFile, LEFT + 4, 28, { fit: [32, 32], align: 'center', valign: 'center' });
      textX = LEFT + 52;
    } catch {
      textX = LEFT;
    }
  }
  const hasMeta = meta.length > 0;
  const textW = hasMeta ? 300 - (textX - LEFT) : WIDTH - (textX - LEFT);
  doc.font(F.BOLD).fontSize(10.5).fillColor(C.WHITE).text(String(tenant.company_name).toUpperCase(), textX, 28, { width: textW, characterSpacing: 0.6, lineBreak: false });
  const identity = [tenant.rccm && `RCCM ${tenant.rccm}`, tenant.ifu && `IFU ${tenant.ifu}`, tenant.contact_phone].filter(Boolean).join('  ·  ');
  doc.font(F.SANS).fontSize(7.5).fillColor(C.LIGHT_ON_NAVY).text(identity, textX, 43, { width: textW, lineBreak: false });
  if (acts.height > 0) drawActivityList(doc, acts, textX, 55, { color: C.LIGHT_ON_NAVY, bullet: C.LIGHT_ON_NAVY });

  const titleW = hasMeta ? 300 : WIDTH;
  let titleSize = 22;
  doc.font(F.BOLD).fontSize(titleSize);
  while (doc.widthOfString(title) > titleW && titleSize > 14) {
    titleSize -= 1;
    doc.fontSize(titleSize);
  }
  doc.fillColor(C.WHITE).text(title, LEFT, 66 + extra, { width: titleW, lineBreak: false });
  if (subtitle) doc.font(F.SANS).fontSize(10.5).fillColor(C.LIGHT_ON_NAVY).text(subtitle, LEFT, 66 + extra + titleSize + 6, { width: titleW, lineBreak: false });

  if (hasMeta) {
    const cardX = 365;
    const cardW = WIDTH + LEFT - cardX;
    const items = meta.slice(0, 3);
    const cardH = 14 + items.length * 26;
    doc.roundedRect(cardX, 26, cardW, cardH, 8).fill(C.NAVY_SOFT);
    items.forEach(([label, value], i) => {
      const y = 36 + i * 26;
      doc.font(F.SANS).fontSize(6.5).fillColor(C.LIGHT_ON_NAVY).text(String(label).toUpperCase(), cardX + 14, y, { width: cardW - 28, characterSpacing: 0.5, lineBreak: false });
      doc.font(F.BOLD).fontSize(9.5).fillColor(C.WHITE).text(String(value ?? '—'), cardX + 14, y + 9, { width: cardW - 28, lineBreak: false });
    });
  }
  doc._aimTitle = title;
  doc._aimContext = meta[0] ? String(meta[0][1] ?? '') : '';
  doc.y = CONTENT_TOP + extra;
  return CONTENT_TOP + extra;
}


/** Palette « courrier » des reçus : fond blanc, gris ardoise, un seul filet d'accent (même esprit que les e-mails de facture). */
const L = { RULE: '#E2E8F0', PANEL: '#F1F5F9', PANEL_SOFT: '#F8FAFC', ACCENT: '#1E3A8A', INK: '#0F172A', MUTED: '#64748B' };

/** Bandeau clair : logo + société à gauche, grand titre sombre, carte de références grise à droite, filet fin dessous. */
function drawLightBanner(doc, tenant, { title, subtitle, meta }) {
  const acts = layoutActivityList(doc, parseActivities(tenant.activities), (meta.length > 0 ? 300 : WIDTH) - (imageIfExists(tenant.logo_path) ? 52 : 0));
  const extra = acts.height > 0 ? acts.height + 4 : 0;
  const bannerH = BANNER_H + extra;
  let textX = LEFT;
  const logoFile = imageIfExists(tenant.logo_path);
  if (logoFile) {
    try {
      doc.roundedRect(LEFT, 26, 40, 40, 8).lineWidth(0.75).fillAndStroke(C.WHITE, L.RULE);
      doc.image(logoFile, LEFT + 4, 30, { fit: [32, 32], align: 'center', valign: 'center' });
      textX = LEFT + 52;
    } catch {
      textX = LEFT;
    }
  }
  const hasMeta = meta.length > 0;
  const textW = hasMeta ? 300 - (textX - LEFT) : WIDTH - (textX - LEFT);
  doc.font(F.BOLD).fontSize(10.5).fillColor(L.INK).text(String(tenant.company_name).toUpperCase(), textX, 30, { width: textW, characterSpacing: 0.6, lineBreak: false });
  const identity = [tenant.rccm && `RCCM ${tenant.rccm}`, tenant.ifu && `IFU ${tenant.ifu}`, tenant.contact_phone].filter(Boolean).join('  ·  ');
  doc.font(F.SANS).fontSize(7.5).fillColor(L.MUTED).text(identity, textX, 45, { width: textW, lineBreak: false });
  if (acts.height > 0) drawActivityList(doc, acts, textX, 57, { color: L.MUTED, bullet: L.ACCENT });

  const titleW = hasMeta ? 300 : WIDTH;
  let titleSize = 20;
  doc.font(F.BOLD).fontSize(titleSize);
  while (doc.widthOfString(title) > titleW && titleSize > 13) {
    titleSize -= 1;
    doc.fontSize(titleSize);
  }
  doc.fillColor(L.INK).text(title, LEFT, 78 + extra, { width: titleW, lineBreak: false });
  if (subtitle) doc.font(F.SANS).fontSize(10).fillColor(L.MUTED).text(subtitle, LEFT, 78 + extra + titleSize + 5, { width: titleW, lineBreak: false });

  if (hasMeta) {
    const cardX = 365;
    const cardW = WIDTH + LEFT - cardX;
    const items = meta.slice(0, 3);
    const cardH = 14 + items.length * 26;
    // Carte de références : fond blanc uni, simple filet (demande utilisateur 2026-10-30), plus de gris.
    doc.roundedRect(cardX, 28, cardW, cardH, 8).lineWidth(0.75).fillAndStroke(C.WHITE, L.RULE);
    items.forEach(([label, value], i) => {
      const y = 38 + i * 26;
      doc.font(F.SANS).fontSize(6.5).fillColor(L.MUTED).text(String(label).toUpperCase(), cardX + 14, y, { width: cardW - 28, characterSpacing: 0.5, lineBreak: false });
      doc.font(F.BOLD).fontSize(9.5).fillColor(L.INK).text(String(value ?? '—'), cardX + 14, y + 9, { width: cardW - 28, lineBreak: false });
    });
  }
  // Filet fin sur toute la largeur + court accent bleu à gauche.
  doc.rect(LEFT, bannerH, WIDTH, 0.75).fill(L.RULE);
  doc.rect(LEFT, bannerH - 0.75, 56, 2.25).fill(L.ACCENT);
  doc._aimTitle = title;
  doc._aimContext = meta[0] ? String(meta[0][1] ?? '') : '';
  doc._aimLight = true;
  doc.y = CONTENT_TOP + extra;
  return CONTENT_TOP + extra;
}

/** Bandeau fin des pages suivantes (dessiné à la fin, pour toutes les pages sauf la première). */
function drawContinuationBand(doc, title, context) {
  const w = doc.page.width;
  const realBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  if (doc._aimLight) {
    doc.rect(LEFT, 36, WIDTH, 0.75).fill(L.RULE);
    doc.rect(LEFT, 35, 40, 2.25).fill(L.ACCENT);
    doc.font(F.BOLD).fontSize(10).fillColor(L.INK).text(title, LEFT, 14, { width: 320, lineBreak: false });
    if (context) doc.font(F.SANS).fontSize(8.5).fillColor(L.MUTED).text(context, 370, 15, { width: 175, align: 'right', lineBreak: false });
    doc.page.margins.bottom = realBottom;
    return;
  }
  doc.rect(0, 0, w, 36).fill(C.NAVY);
  doc.rect(0, 36, w, 3).fill(C.ACCENT);
  doc.font(F.BOLD).fontSize(10).fillColor(C.WHITE).text(title, LEFT, 13, { width: 320, lineBreak: false });
  if (context) doc.font(F.SANS).fontSize(8.5).fillColor(C.LIGHT_ON_NAVY).text(context, 370, 14, { width: 175, align: 'right', lineBreak: false });
  doc.page.margins.bottom = realBottom;
}

/** Titre de section : barre d'accent + libellé en capitales marine. Renvoie le y suivant. */
function drawSection(doc, y, label, { right = null, bar = true } = {}) {
  if (bar) doc.rect(LEFT, y, 3.5, 13).fill(C.ACCENT);
  doc.font(F.BOLD).fontSize(10.5).fillColor(C.NAVY).text(String(label).toUpperCase(), bar ? LEFT + 11 : LEFT, y + 1.5, { width: 330, lineBreak: false, characterSpacing: 0.3 });
  if (right) doc.font(F.SANS).fontSize(8).fillColor(C.MUTED).text(right, 360, y + 3, { width: 185, align: 'right', lineBreak: false });
  return y + 24;
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureRoom(doc, y, needed) {
  if (y + needed > pageBottom(doc)) {
    doc.addPage();
    return doc.page.margins.top + 4;
  }
  return y;
}

/** Cadre d'informations : grille de cellules (3 par ligne) libellé/valeur, séparateurs fins. */
function drawInfoGrid(doc, y, cells, { columns = 3, light = false } = {}) {
  const border = light ? L.RULE : C.TINT_BORDER;
  const labelColor = light ? L.MUTED : C.MUTED;
  const rows = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  const colW = WIDTH / columns;
  const pad = light ? 0 : 12; // sans cadre, le texte s'aligne sur le titre de section
  const textW = light ? colW - 12 : colW - 24;
  const heights = rows.map((row) => {
    const h = Math.max(...row.map(([, v]) => doc.font(F.BOLD).fontSize(9.5).heightOfString(String(v ?? '—'), { width: textW })));
    return Math.max(40, h + 28);
  });
  const total = heights.reduce((a, b) => a + b, 0);
  y = ensureRoom(doc, y, total + 6);
  // Version « light » (reçus) : aucune bordure, ni cadre ni filets de séparation (demande utilisateur 2026-10-30).
  if (!light) doc.roundedRect(LEFT, y, WIDTH, total, 8).lineWidth(0.75).fillAndStroke(C.WHITE, border);
  let cy = y;
  rows.forEach((row, ri) => {
    if (ri > 0 && !light) doc.moveTo(LEFT, cy).lineTo(LEFT + WIDTH, cy).lineWidth(0.5).strokeColor(border).stroke();
    row.forEach(([label, value], ci) => {
      const x = LEFT + ci * colW;
      if (ci > 0 && !light) doc.moveTo(x, cy + 8).lineTo(x, cy + heights[ri] - 8).lineWidth(0.5).strokeColor(border).stroke();
      doc.font(F.SANS).fontSize(6.5).fillColor(labelColor).text(String(label).toUpperCase(), x + pad, cy + 10, { width: textW, characterSpacing: 0.5, lineBreak: false });
      doc.font(F.BOLD).fontSize(9.5).fillColor(C.INK).text(String(value ?? '—'), x + pad, cy + 22, { width: textW });
    });
    cy += heights[ri];
  });
  return y + total + 18;
}

/** Tuiles chiffrées (bordure gauche colorée, fond teinté). `tiles` : [{ value, label, color, bg }]. */
function drawStatTiles(doc, y, tiles) {
  y = ensureRoom(doc, y, 58);
  const gap = 8;
  const w = (WIDTH - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = LEFT + i * (w + gap);
    doc.roundedRect(x, y, w, 50, 6).fill(t.bg);
    doc.roundedRect(x, y, 3.5, 50, 1.5).fill(t.color);
    doc.font(F.BOLD).fontSize(19).fillColor(t.color).text(String(t.value), x + 14, y + 8, { width: w - 22, lineBreak: false });
    doc.font(F.SANS).fontSize(8).fillColor(C.INK_SOFT).text(t.label, x + 14, y + 33, { width: w - 22, lineBreak: false });
  });
  return y + 50 + 20;
}

/**
 * Tableau à en-tête marine et lignes zébrées. `columns` : [{ label, width, align?, key?, bold?, color? }] ; `rows` :
 * tableaux de valeurs (ou objets si `key`). Gère les sauts de page (en-tête répété).
 */
function drawTable(doc, y, columns, rows, { rowHeight = 24 } = {}) {
  const head = () => {
    doc.rect(LEFT, y, WIDTH, 22).fill(C.NAVY);
    let x = LEFT;
    for (const col of columns) {
      doc.font(F.BOLD).fontSize(7.5).fillColor(C.WHITE).text(col.label.toUpperCase(), x + 10, y + 7.5, { width: col.width - 20, align: col.align ?? 'left', characterSpacing: 0.4, lineBreak: false });
      x += col.width;
    }
    y += 22;
  };
  y = ensureRoom(doc, y, 22 + rowHeight * 2);
  head();
  rows.forEach((row, i) => {
    const values = columns.map((col, ci) => (Array.isArray(row) ? row[ci] : row[col.key ?? ci]));
    const heights = columns.map((col, ci) => doc.font(col.bold ? F.BOLD : F.SANS).fontSize(9).heightOfString(String(values[ci] ?? ''), { width: col.width - 20 }));
    const h = Math.max(rowHeight, Math.max(...heights) + 12);
    if (y + h > pageBottom(doc)) {
      doc.addPage();
      y = doc.page.margins.top + 4;
      head();
    }
    if (i % 2 === 0) doc.rect(LEFT, y, WIDTH, h).fill(C.ZEBRA);
    let x = LEFT;
    columns.forEach((col, ci) => {
      doc.font(col.bold ? F.BOLD : F.SANS).fontSize(9).fillColor(col.color ?? C.INK).text(String(values[ci] ?? '—'), x + 10, y + (h - 9) / 2 - 1, { width: col.width - 20, align: col.align ?? 'left' });
      x += col.width;
    });
    y += h;
  });
  doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(0.75).strokeColor(C.TINT_BORDER).stroke();
  return y + 14;
}

/** Ligne de total : barre marine arrondie, libellé à gauche, montant en grand à droite. */
function drawTotalBar(doc, y, label, amountText, { color = C.NAVY } = {}) {
  y = ensureRoom(doc, y, 52);
  doc.roundedRect(LEFT, y, WIDTH, 44, 7).fill(color);
  doc.font(F.BOLD).fontSize(10.5).fillColor(C.WHITE).text(String(label).toUpperCase(), LEFT + 16, y + 17, { width: 260, characterSpacing: 0.4, lineBreak: false });
  doc.font(F.BOLD).fontSize(17).fillColor(C.WHITE).text(amountText, LEFT + 240, y + 13, { width: WIDTH - 256, align: 'right', lineBreak: false });
  return y + 44 + 8;
}

/** Montant en lettres, en italique discret. */
function drawWordsLine(doc, y, amount, prefix, { color = C.MUTED } = {}) {
  y = ensureRoom(doc, y, 24);
  doc.font(F.ITALIC).fontSize(8.5).fillColor(color).text(sentenceAmount(amount, prefix), LEFT, y, { width: WIDTH });
  return doc.y + 14;
}

/** Encadré de texte (notes, observations). */
function drawNote(doc, y, label, text) {
  doc.font(F.SANS).fontSize(9);
  const h = doc.heightOfString(text, { width: WIDTH - 28 }) + 24;
  y = ensureRoom(doc, y, h + (label ? 30 : 6));
  if (label) y = drawSection(doc, y, label);
  doc.roundedRect(LEFT, y, WIDTH, h, 7).lineWidth(0.75).fillAndStroke(C.WHITE, C.TINT_BORDER);
  doc.font(F.SANS).fontSize(9).fillColor(C.INK_SOFT).text(text, LEFT + 14, y + 12, { width: WIDTH - 28 });
  return y + h + 18;
}

/**
 * Cartes de signature (une ou deux). `cards` : [{ title, name, role?, date?, signatureFile?, stampFile?, hint? }].
 * Bandeau marine en tête de carte, zone de signature, nom et fonction dessous.
 */
function drawSignatureCards(doc, y, cards, { section = true, plain = false } = {}) {
  // Cachet/signature agrandis (demande utilisateur, 2026-10-23) : la carte et ses deux zones d'image
  // grandissent ensemble pour rester professionnelles (ni signature écrasée, ni cachet rogné) — tout
  // le reste du bloc (ligne d'appui, nom, fonction, mention) est redescendu en conséquence.
  const cardH = 170;
  y = ensureRoom(doc, y, cardH + (section ? 40 : 10));
  if (section) y = drawSection(doc, y, 'Signatures');
  const gap = 15;
  const w = cards.length === 1 ? 240 : (WIDTH - gap) / 2;
  const startX = cards.length === 1 ? LEFT + WIDTH - w : LEFT;
  cards.forEach((c, i) => {
    const x = startX + i * (w + gap);
    doc.roundedRect(x, y, w, cardH, 7).lineWidth(0.75).fillAndStroke(C.WHITE, C.TINT_BORDER);
    if (plain) {
      doc.font(F.BOLD).fontSize(8.5).fillColor(C.MUTED).text(String(c.title), x + 14, y + 8, { width: w - 28, lineBreak: false });
    } else {
      doc.save();
      doc.roundedRect(x, y, w, 22, 7).clip();
      doc.rect(x, y, w, 22).fill(C.NAVY);
      doc.restore();
      doc.font(F.BOLD).fontSize(7.5).fillColor(C.WHITE).text(String(c.title).toUpperCase(), x + 14, y + 8, { width: w - 28, characterSpacing: 0.5, lineBreak: false });
    }
    // Cachet + signature superposés (demande utilisateur, 2026-10-30) : à l'image d'une quittance signée à
    // la main, le cachet reste à l'emplacement central (celui qu'occupait la signature seule) et la
    // signature est dessinée PAR-DESSUS, agrandie — d'où l'ordre : le cachet d'abord (le fond), la
    // signature ensuite (par-dessus, opacité pleine pour rester lisible sur le cachet).
    const boxY = y + 26;
    const boxH = 100;
    if (c.stampFile) {
      try {
        const stampW = Math.min(w - 28, 150);
        doc.opacity(0.9).image(c.stampFile, x + (w - stampW) / 2, boxY, { fit: [stampW, boxH] }).opacity(1);
      } catch { /* cachet illisible : on continue */ }
    }
    if (c.signatureFile) {
      try {
        const sigW = Math.min(w - 20, 180);
        doc.image(c.signatureFile, x + (w - sigW) / 2, boxY + 12, { fit: [sigW, 78], align: 'center', valign: 'center' });
      } catch { /* signature illisible : on continue */ }
    }
    doc.moveTo(x + 14, boxY + 100).lineTo(x + w - 14, boxY + 100).dash(2, { space: 2 }).lineWidth(0.75).strokeColor(C.TINT_BORDER).stroke().undash();
    doc.font(F.BOLD).fontSize(9).fillColor(C.INK).text(c.name || ' ', x + 14, boxY + 106, { width: w - 28, lineBreak: false });
    const sub = [c.role, c.date && `Date : ${c.date}`].filter(Boolean).join('  ·  ');
    if (sub) doc.font(F.SANS).fontSize(7.5).fillColor(C.MUTED).text(sub, x + 14, boxY + 119, { width: w - 28, lineBreak: false });
    if (c.hint) doc.font(F.ITALIC).fontSize(7).fillColor(C.MUTED).text(c.hint, x + 14, y + cardH - 14, { width: w - 28, lineBreak: false });
  });
  return y + cardH + 14;
}


// ---------------------------------------------------------------------------------------------------------------------
// Style « reçu » épuré (demande utilisateur 2026-10-30 : s'inspirer des reçus Claude/Google) : fond blanc, aucune bande de
// couleur, titre en grand, références en clé/valeur, tableau à simples filets, totaux alignés à droite.
// ---------------------------------------------------------------------------------------------------------------------
const sentenceCase = (t) => { const x = String(t ?? '').toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1); };

/** En-tête : titre + logo, références clé/valeur, identité de l'émetteur. Renvoie le y suivant. */
function drawPlainHeader(doc, tenant, { title, subtitle = null, meta = [] }) {
  const heading = sentenceCase(title);
  const logoFile = imageIfExists(tenant.logo_path);
  const titleW = logoFile ? WIDTH - 64 : WIDTH;
  let size = 24;
  doc.font(F.BOLD).fontSize(size);
  while (doc.widthOfString(heading) > titleW && size > 14) { size -= 1; doc.fontSize(size); }
  doc.fillColor(C.INK).text(heading, LEFT, 50, { width: titleW, lineBreak: false });
  let y = 50 + size + 6;
  if (subtitle) { doc.font(F.SANS).fontSize(10.5).fillColor(C.MUTED).text(subtitle, LEFT, y, { width: titleW, lineBreak: false }); y += 20; }
  if (logoFile) {
    try { doc.image(logoFile, LEFT + WIDTH - 48, 46, { fit: [48, 48], align: 'right', valign: 'top' }); } catch { /* logo illisible : on continue */ }
  }
  y = Math.max(y, 100) + 10;
  for (const [label, value] of meta) {
    doc.font(F.BOLD).fontSize(9.5).fillColor(C.INK).text(String(label), LEFT, y, { width: 130, lineBreak: false });
    doc.font(F.SANS).fontSize(9.5).fillColor(C.INK).text(String(value ?? '—'), LEFT + 135, y, { width: WIDTH - 135, lineBreak: false });
    y += 15;
  }
  y += 14;
  doc.font(F.BOLD).fontSize(10).fillColor(C.INK).text(String(tenant.company_name), LEFT, y, { width: WIDTH, lineBreak: false });
  const identity = [tenant.rccm && `RCCM ${tenant.rccm}`, tenant.ifu && `IFU ${tenant.ifu}`, tenant.contact_phone].filter(Boolean).join('  ·  ');
  if (identity) doc.font(F.SANS).fontSize(8.5).fillColor(C.MUTED).text(identity, LEFT, y + 14, { width: WIDTH, lineBreak: false });
  doc._aimTitle = heading;
  doc._aimContext = meta[0] ? String(meta[0][1] ?? '') : '';
  doc._aimLight = true;
  doc.y = y + 40;
  return y + 40;
}

/** Titre de section sobre : gras, casse normale, aucune barre. */
function drawPlainSection(doc, y, label) {
  y = ensureRoom(doc, y, 40);
  doc.font(F.BOLD).fontSize(11).fillColor(C.INK).text(String(label), LEFT, y, { width: WIDTH, lineBreak: false });
  return y + 20;
}

/** Tableau à simples filets : en-tête grise, un filet sous l'en-tête et un sous chaque ligne, aucun aplat de couleur. */
function drawPlainTable(doc, y, columns, rows) {
  const rule = (yy, color = L.RULE, w = 0.5) => doc.moveTo(LEFT, yy).lineTo(LEFT + WIDTH, yy).lineWidth(w).strokeColor(color).stroke();
  const head = () => {
    let x = LEFT;
    for (const col of columns) {
      doc.font(F.SANS).fontSize(8.5).fillColor(C.MUTED).text(col.label, x, y, { width: col.width - 8, align: col.align ?? 'left', lineBreak: false });
      x += col.width;
    }
    y += 16;
    rule(y, C.TINT_BORDER, 0.75);
    y += 8;
  };
  y = ensureRoom(doc, y, 70);
  head();
  for (const row of rows) {
    const values = columns.map((col, ci) => (Array.isArray(row) ? row[ci] : row[col.key ?? ci]));
    const heights = columns.map((col, ci) => doc.font(col.bold ? F.BOLD : F.SANS).fontSize(9.5).heightOfString(String(values[ci] ?? ''), { width: col.width - 8 }));
    const h = Math.max(18, Math.max(...heights) + 4);
    if (y + h + 10 > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top + 4; head(); }
    let x = LEFT;
    columns.forEach((col, ci) => {
      doc.font(col.bold ? F.BOLD : F.SANS).fontSize(9.5).fillColor(col.color ?? C.INK).text(String(values[ci] ?? '—'), x, y, { width: col.width - 8, align: col.align ?? 'left' });
      x += col.width;
    });
    y += h + 6;
    rule(y);
    y += 8;
  }
  return y + 6;
}

/** Montant principal en grand (libellé gris au-dessus), puis, sous le tableau, une ligne de total alignée à droite. */
function drawPlainAmount(doc, y, label, amountText) {
  y = ensureRoom(doc, y, 52);
  doc.font(F.SANS).fontSize(9).fillColor(C.MUTED).text(String(label), LEFT, y, { width: WIDTH, lineBreak: false });
  doc.font(F.BOLD).fontSize(20).fillColor(C.INK).text(amountText, LEFT, y + 13, { width: WIDTH, lineBreak: false });
  return y + 52;
}
function drawPlainTotal(doc, y, label, amountText) {
  y = ensureRoom(doc, y, 34);
  const x = LEFT + WIDTH - 270;
  doc.moveTo(x, y).lineTo(LEFT + WIDTH, y).lineWidth(0.75).strokeColor(C.TINT_BORDER).stroke();
  doc.font(F.BOLD).fontSize(10.5).fillColor(C.INK).text(String(label), x, y + 10, { width: 150, lineBreak: false });
  doc.font(F.BOLD).fontSize(10.5).fillColor(C.INK).text(amountText, x + 120, y + 10, { width: 150, align: 'right', lineBreak: false });
  return y + 36;
}

/** Note : simple paragraphe, sans cadre. */
function drawPlainNote(doc, y, text) {
  doc.font(F.SANS).fontSize(9);
  const h = doc.heightOfString(text, { width: WIDTH });
  y = ensureRoom(doc, y, h + 12);
  doc.font(F.SANS).fontSize(9).fillColor(C.INK_SOFT).text(text, LEFT, y, { width: WIDTH });
  return y + h + 18;
}

/** Pied de page commun + bandeaux de continuation. À appeler une seule fois avant `doc.end()`. */
function finishDocument(doc, { verificationCode = null, frontendHost = null, downloadDate = null } = {}) {
  const range = doc.bufferedPageRange();
  const realBottom = doc.page.margins.bottom;
  const today = downloadDate ?? new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    if (i > range.start) drawContinuationBand(doc, doc._aimTitle ?? '', doc._aimContext ?? '');
    doc.page.margins.bottom = 0;
    doc.moveTo(LEFT, 772).lineTo(LEFT + WIDTH, 772).lineWidth(0.75).strokeColor(C.TINT_BORDER).stroke();
    doc.font(F.SANS).fontSize(7.5).fillColor(C.MUTED).text(`Document téléchargé le ${today} · Africa Immo Management`, LEFT, 780, { width: 330, lineBreak: false });
    doc.font(F.SANS).fontSize(7.5).fillColor(C.MUTED).text(`Page ${i - range.start + 1} / ${range.count}`, 445, 780, { width: 100, align: 'right', lineBreak: false });
    if (verificationCode) {
      doc.font(F.SANS).fontSize(7.5).fillColor(C.MUTED).text(`Vérifiez l'authenticité de ce document sur ${frontendHost ?? ''}/verifier avec le code `, LEFT, 791, { continued: true, lineBreak: false });
      doc.font(F.BOLD).fillColor(C.INK).text(verificationCode, { lineBreak: false });
    }
    doc.page.margins.bottom = realBottom;
  }
}

module.exports = {
  C, F, LEFT, WIDTH, CONTENT_TOP, fcfa, amountInWordsFr, sentenceAmount, imageIfExists,
  drawBanner, layoutActivityList, drawActivityList, drawContinuationBand, drawSection, drawInfoGrid, drawStatTiles, drawTable, drawTotalBar,
  drawWordsLine, drawNote, drawSignatureCards, finishDocument, ensureRoom,
  drawPlainHeader, drawPlainSection, drawPlainTable, drawPlainAmount, drawPlainTotal, drawPlainNote,
};
