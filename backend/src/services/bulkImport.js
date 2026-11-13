'use strict';

/**
 * Import en masse depuis Excel (demande utilisateur, 2026-11-13) : un cabinet qui arrive avec 200
 * locataires ne doit pas tout ressaisir à la main. UN fichier, TROIS feuilles (Propriétaires,
 * Logements, Locataires), reliées par ce que le cabinet connaît déjà : le téléphone du propriétaire
 * et les références qu'il choisit lui-même pour ses biens et logements.
 *
 * Principes (validés avec l'utilisateur) :
 * - TOUT OU RIEN : une seule transaction. Une ligne en erreur = rien n'est créé — jamais de
 *   portefeuille à moitié importé à démêler ensuite.
 * - L'APERÇU EST UN VRAI ESSAI : après la vérification ligne par ligne, l'aperçu exécute l'import
 *   complet dans une transaction puis l'ANNULE. Tout ce que la base refuserait à la confirmation
 *   (mois clôturé, limite de l'offre, doublon…) est donc vu dès l'aperçu, sans logique dupliquée.
 * - MÊMES RÈGLES QUE LES FORMULAIRES : chaque ligne passe par les schémas de validation existants
 *   (`validators/*`) et les baux par `insertLeaseWithEntries` (services/renters.js) — cautions,
 *   écritures comptables, impayés à l'entrée, reçu d'entrée : rien n'est réimplémenté ici.
 * - Les locataires importés sont des « anciens locataires » (déjà dans les lieux avant l'outil) :
 *   jamais de frais d'agence ni de prorata d'entrée.
 * - L'historique des paiements n'est pas repris : seulement la situation de départ (à jour, ou
 *   impayés déclarés).
 */

const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { ApiError } = require('../middleware/error');
const logger = require('../utils/logger');
const { createOwnerSchema } = require('../validators/owners');
const { createPropertySchema, createUnitSchema } = require('../validators/properties');
const { createRenterSchema } = require('../validators/renters');
const { PROPERTY_TYPES, UNIT_DESIGNATIONS } = require('../constants/properties');
const { ADDITIONAL_DEPOSIT_TYPES, enabledAdditionalDepositTypes } = require('../constants/leaseDeposits');
const { assertWithinLimit } = require('./entitlements');
const { prepareLeaseTerms, insertLeaseWithEntries, loadDepositTogglesRow } = require('./renters');
const { generatePortalToken, hashToken } = require('../utils/tokens');

const MAX_ROWS_PER_SHEET = 2000;
const MAX_ERRORS = 200;

const PAYMENT_METHOD_OPTIONS = [
  { key: 'especes', label: 'Espèces' },
  { key: 'mobile_money', label: 'Mobile money' },
  { key: 'virement', label: 'Virement' },
  { key: 'cheque', label: 'Chèque' },
];
const YES_NO = ['Oui', 'Non'];

/**
 * Définition des feuilles — source unique pour le modèle téléchargé, la lecture du fichier et les
 * messages d'erreur (une colonne est toujours citée par son en-tête exact).
 * `type` : text | phone | amount | date | yesno | list | months. `field` : champ du schéma de
 * validation correspondant, pour traduire ses erreurs vers la bonne colonne.
 */
const SHEETS = {
  owners: {
    name: 'Propriétaires',
    columns: [
      { key: 'name', header: 'Nom', required: true, type: 'text', width: 30, example: 'Koffi ADJOVI' },
      { key: 'phone', header: 'Téléphone', required: true, type: 'phone', width: 16, example: '0161234567' },
      { key: 'email', header: 'E-mail', type: 'text', width: 28, example: 'koffi@exemple.bj' },
      { key: 'address', header: 'Adresse', type: 'text', width: 30, example: 'Cotonou, Fidjrossè' },
      { key: 'notes', header: 'Notes', type: 'text', width: 30, example: '' },
    ],
  },
  units: {
    name: 'Logements',
    columns: [
      { key: 'ownerPhone', header: 'Téléphone du propriétaire', required: true, type: 'phone', width: 24, example: '0161234567' },
      { key: 'propertyRef', header: 'Référence du bien', required: true, type: 'text', width: 24, example: 'Immeuble Fidjrossè' },
      { key: 'propertyType', header: 'Type de bien', required: true, type: 'list', options: PROPERTY_TYPES, width: 16, example: 'Immeuble' },
      { key: 'address', header: 'Adresse du bien', type: 'text', width: 30, example: 'Fidjrossè, rue 12.345' },
      { key: 'unitRef', header: 'Référence du logement', required: true, type: 'text', width: 22, example: 'A1' },
      { key: 'designation', header: 'Désignation', required: true, type: 'list', options: UNIT_DESIGNATIONS, width: 40, example: 'Chambre salon' },
      { key: 'designationCustom', header: 'Précision (si « Autre »)', type: 'text', width: 24, example: '' },
      { key: 'monthlyRent', header: 'Loyer mensuel', required: true, type: 'amount', width: 15, example: '45000' },
      { key: 'sbeeMeterNumber', header: 'Compteur SBEE', type: 'text', width: 16, example: '' },
      { key: 'sonebMeterNumber', header: 'Compteur SONEB', type: 'text', width: 16, example: '' },
      { key: 'furnished', header: 'Meublé', type: 'yesno', width: 10, example: 'Non' },
    ],
  },
  renters: {
    name: 'Locataires',
    columns: [
      { key: 'lastName', header: 'Nom', required: true, type: 'text', width: 20, example: 'HOUNSOU' },
      { key: 'firstName', header: 'Prénom', required: true, type: 'text', width: 20, example: 'Aïcha' },
      { key: 'phone', header: 'Téléphone', required: true, type: 'phone', width: 16, example: '0197654321' },
      { key: 'email', header: 'E-mail', type: 'text', width: 26, example: '' },
      { key: 'profession', header: 'Profession', type: 'text', width: 20, example: 'Commerçante' },
      { key: 'propertyRef', header: 'Référence du bien', required: true, type: 'text', width: 24, example: 'Immeuble Fidjrossè' },
      { key: 'unitRef', header: 'Référence du logement', required: true, type: 'text', width: 22, example: 'A1' },
      { key: 'startDate', header: "Date d'entrée", required: true, type: 'date', width: 15, example: '15/03/2024' },
      { key: 'monthlyRent', header: 'Loyer (si différent du logement)', type: 'amount', width: 30, example: '' },
      { key: 'rentDueDay', header: "Jour d'échéance (1 à 28)", type: 'amount', width: 24, example: '5' },
      { key: 'depositAmount', header: 'Caution de loyer', type: 'amount', width: 17, example: '90000' },
      { key: 'depositRefundable', header: 'Caution remboursable', type: 'yesno', width: 21, example: 'Oui' },
      { key: 'depositPaymentMethod', header: 'Caution reçue par', type: 'list', options: PAYMENT_METHOD_OPTIONS, width: 18, example: 'Espèces' },
      { key: 'depositSbee', header: 'Caution SBEE', type: 'amount', width: 14, example: '' },
      { key: 'depositSoneb', header: 'Caution SONEB', type: 'amount', width: 15, example: '' },
      { key: 'depositPeinture', header: 'Caution peinture', type: 'amount', width: 17, example: '' },
      { key: 'currentMonthPaid', header: 'Loyer du mois en cours déjà payé', type: 'yesno', width: 31, example: 'Non' },
      { key: 'unpaidRentMonths', header: 'Mois de loyer impayés', type: 'months', width: 24, example: '2026-09, 2026-10' },
      { key: 'debtSbee', header: 'Impayé SBEE', type: 'amount', width: 13, example: '' },
      { key: 'debtSoneb', header: 'Impayé SONEB', type: 'amount', width: 14, example: '' },
      { key: 'debtPoubelle', header: 'Impayé poubelle', type: 'amount', width: 16, example: '' },
      { key: 'debtAutre', header: 'Impayé autre', type: 'amount', width: 14, example: '' },
    ],
  },
};
const SHEET_ORDER = ['owners', 'units', 'renters'];

// ── Normalisation ────────────────────────────────────────────────────────────

/** Comparaison tolérante : casse, accents, espaces multiples et astérisque d'« obligatoire » ignorés. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Valeur brute d'une cellule ExcelJS → texte, nombre ou Date (formule : son résultat ; lien : son texte). */
function cellValue(cell) {
  let v = cell?.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.result !== undefined) v = v.result;
    else if (v.richText) v = v.richText.map((r) => r.text).join('');
    else if (v.text !== undefined) v = v.text;
    else if (v.error) v = '';
  }
  if (typeof v === 'string') v = v.trim();
  return v === undefined || v === null ? '' : v;
}

function isoFromParts(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Chaque convertisseur renvoie `{ value }` ou `{ error }` ; une cellule vide donne `{ value: '' }`. */
const CONVERT = {
  text: (raw) => ({ value: raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw) }),

  // Excel transforme « 0161234567 » en nombre 161234567 si la colonne n'est pas au format Texte :
  // le zéro initial perdu est restitué (un numéro béninois fait 10 chiffres et commence par 0).
  phone: (raw) => {
    let s = String(raw).replace(/[\s.\-()]/g, '');
    if (/^[1-9]\d{8}$/.test(s)) s = `0${s}`;
    return { value: s };
  },

  amount: (raw) => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? { value: Math.round(raw) === raw ? raw : NaN } : { error: 'Montant invalide' };
    const s = String(raw).replace(/\s/g, '').replace(/(fcfa|cfa|f)$/i, '');
    return /^\d+$/.test(s) ? { value: Number(s) } : { error: 'Montant invalide : un nombre entier, sans virgule (ex. 45000)' };
  },

  date: (raw) => {
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? { error: 'Date invalide' } : { value: raw.toISOString().slice(0, 10) };
    }
    // Date collée depuis un autre classeur dans une colonne au format Texte : Excel n'en garde que
    // le numéro de série (jours depuis le 30/12/1899). Bornes = années 1955 à 2173, hors montants.
    if (typeof raw === 'number') {
      if (!Number.isInteger(raw) || raw < 20000 || raw > 100000) return { error: 'Date invalide : attendu JJ/MM/AAAA (ex. 15/03/2024)' };
      return { value: new Date(Date.UTC(1899, 11, 30) + raw * 86400000).toISOString().slice(0, 10) };
    }
    const s = String(raw);
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    let iso = m ? isoFromParts(Number(m[3]), Number(m[2]), Number(m[1])) : null;
    if (!iso) {
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      iso = m ? isoFromParts(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    }
    return iso ? { value: iso } : { error: 'Date invalide : attendu JJ/MM/AAAA (ex. 15/03/2024)' };
  },

  yesno: (raw) => {
    const s = norm(raw === true ? 'oui' : raw === false ? 'non' : raw);
    if (['oui', 'o', 'yes', 'y', 'vrai', 'x', '1'].includes(s)) return { value: true };
    if (['non', 'n', 'no', 'faux', '0'].includes(s)) return { value: false };
    return { error: 'Répondre Oui ou Non' };
  },

  list: (raw, column) => {
    const s = norm(raw);
    const found = column.options.find((o) => norm(o.label) === s || norm(o.key) === s);
    return found ? { value: found.key } : { error: `Valeur inconnue. Choix possibles : ${column.options.map((o) => o.label).join(', ')}` };
  },

  // « 2026-09, 2026-10 », « 09/2026 ; 10/2026 » ou une cellule date (premier jour du mois).
  months: (raw) => {
    if (raw instanceof Date) return { value: [raw.toISOString().slice(0, 7)] };
    const out = [];
    for (const part of String(raw).split(/[,;\n]+|\s+(?=\d)/).map((p) => p.trim()).filter(Boolean)) {
      let m = part.match(/^(\d{4})-(\d{1,2})$/);
      let y = m ? Number(m[1]) : null;
      let mo = m ? Number(m[2]) : null;
      if (!m) {
        m = part.match(/^(\d{1,2})\/(\d{4})$/);
        if (m) { mo = Number(m[1]); y = Number(m[2]); }
      }
      if (!m || mo < 1 || mo > 12) return { error: `Mois invalide « ${part} » : attendu AAAA-MM (ex. 2026-09), séparés par des virgules` };
      out.push(`${y}-${String(mo).padStart(2, '0')}`);
    }
    return { value: [...new Set(out)] };
  },
};

// ── Modèle téléchargeable ────────────────────────────────────────────────────

async function buildTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Africa Immo Management';

  const help = wb.addWorksheet('Mode d’emploi');
  help.getColumn(1).width = 110;
  const lines = [
    ['Import de votre portefeuille — Africa Immo Management', true],
    [''],
    ['1. Remplissez les 3 feuilles suivantes : Propriétaires, Logements, Locataires. Une ligne par propriétaire, par logement, par locataire.'],
    ['2. Les colonnes dont le titre finit par une étoile (*) sont obligatoires. Ne modifiez pas les titres des colonnes.'],
    ['3. Envoyez le fichier dans l’outil : un aperçu vous montre ce qui sera créé et signale chaque erreur avec son numéro de ligne. Rien n’est enregistré avant votre confirmation.'],
    ['4. L’import se fait en une seule fois : s’il reste une erreur, rien n’est créé. Corrigez le fichier et renvoyez-le.'],
    [''],
    ['Comment les feuilles sont reliées', true],
    ['• Un logement est rattaché à son propriétaire par le « Téléphone du propriétaire » (le même que dans la feuille Propriétaires).'],
    ['• Un locataire est rattaché à son logement par la « Référence du bien » et la « Référence du logement », que vous choisissez librement (ex. « Immeuble Fidjrossè » et « A1 »). Écrivez-les de la même façon dans les deux feuilles.'],
    ['• Ces références servent uniquement à relier les feuilles : l’outil attribue ensuite ses propres codes aux biens et aux logements.'],
    ['• Un logement sans locataire dans la feuille Locataires est créé « libre ».'],
    [''],
    ['Formats', true],
    ['• Téléphones : 10 chiffres, ex. 0161234567.'],
    ['• Dates : JJ/MM/AAAA, ex. 15/03/2024.'],
    ['• Montants : en FCFA, nombre entier sans espace ni virgule, ex. 45000.'],
    ['• Listes (Type de bien, Désignation, Oui/Non…) : choisissez dans la liste déroulante de la cellule.'],
    [''],
    ['Locataires', true],
    ['• Les locataires importés sont déjà dans les lieux : ni frais d’agence ni prorata d’entrée ne sont comptés.'],
    ['• « Loyer du mois en cours déjà payé » : Oui si le locataire a déjà réglé le mois en cours ; sinon ce mois apparaîtra à encaisser.'],
    ['• « Mois de loyer impayés » : les mois précédents non réglés, au format AAAA-MM séparés par des virgules (ex. 2026-09, 2026-10), dans les 12 derniers mois. Chaque mois compte pour un loyer.'],
    ['• « Impayé SBEE / SONEB / poubelle / autre » : le montant total restant dû pour ce poste.'],
    ['• Cautions : indiquez les cautions déjà versées par le locataire. « Caution remboursable » : Non si elle ne sera jamais rendue.'],
    ['• L’historique des paiements passés n’est pas repris : seule la situation de départ est enregistrée.'],
  ];
  lines.forEach(([text, bold], i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (bold) cell.font = { bold: true, size: i === 0 ? 14 : 12 };
  });

  for (const key of SHEET_ORDER) {
    const def = SHEETS[key];
    const ws = wb.addWorksheet(def.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    def.columns.forEach((col, idx) => {
      const column = ws.getColumn(idx + 1);
      column.width = col.width;
      // Format Texte : garde le zéro initial des téléphones et empêche Excel de réinterpréter les dates.
      if (['phone', 'date', 'months', 'text'].includes(col.type)) column.numFmt = '@';
      const header = ws.getCell(1, idx + 1);
      header.value = col.required ? `${col.header} *` : col.header;
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? 'FF1E3A8A' : 'FF64748B' } };
      header.alignment = { wrapText: true, vertical: 'middle' };
      if (col.example) header.note = `Exemple : ${col.example}`;

      const options = col.type === 'yesno' ? YES_NO : col.type === 'list' ? col.options.map((o) => o.label) : null;
      if (options) {
        const letter = column.letter;
        ws.dataValidations.add(`${letter}2:${letter}${MAX_ROWS_PER_SHEET + 1}`, {
          type: 'list',
          allowBlank: true,
          formulae: [`"${options.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Valeur non reconnue',
          error: 'Choisissez une valeur dans la liste.',
        });
      }
    });
    ws.getRow(1).height = 32;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Lecture du fichier ───────────────────────────────────────────────────────

/**
 * Lit le classeur. Renvoie `{ rows: { owners, units, renters }, errors }` où chaque ligne est
 * `{ row, <clé de colonne>: valeur convertie }`. Les colonnes sont retrouvées par leur TITRE (ordre
 * libre) ; une ligne entièrement vide est ignorée.
 */
async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (_e) {
    throw new ApiError(400, 'Fichier illisible : envoyez un classeur Excel (.xlsx), de préférence le modèle fourni.');
  }

  const errors = [];
  const rows = {};
  for (const key of SHEET_ORDER) {
    const def = SHEETS[key];
    rows[key] = [];
    const ws = wb.worksheets.find((w) => norm(w.name) === norm(def.name));
    if (!ws) {
      errors.push({ sheet: def.name, row: null, column: null, message: `Feuille « ${def.name} » introuvable dans le fichier.` });
      continue;
    }

    const columnIndex = new Map();
    ws.getRow(1).eachCell((cell, colNumber) => {
      const title = norm(cellValue(cell));
      const col = def.columns.find((c) => norm(c.header) === title);
      if (col && !columnIndex.has(col.key)) columnIndex.set(col.key, colNumber);
    });
    const missing = def.columns.filter((c) => c.required && !columnIndex.has(c.key));
    if (missing.length) {
      errors.push({ sheet: def.name, row: 1, column: null, message: `Colonne(s) obligatoire(s) absente(s) : ${missing.map((c) => c.header).join(', ')}.` });
      continue;
    }

    let count = 0;
    for (let r = 2; r <= ws.rowCount; r += 1) {
      const excelRow = ws.getRow(r);
      const raw = {};
      let empty = true;
      for (const col of def.columns) {
        const idx = columnIndex.get(col.key);
        raw[col.key] = idx ? cellValue(excelRow.getCell(idx)) : '';
        if (raw[col.key] !== '') empty = false;
      }
      if (empty) continue;
      count += 1;
      if (count > MAX_ROWS_PER_SHEET) {
        errors.push({ sheet: def.name, row: r, column: null, message: `Trop de lignes : ${MAX_ROWS_PER_SHEET} au maximum par feuille. Découpez le fichier en plusieurs imports.` });
        break;
      }

      const line = { row: r };
      for (const col of def.columns) {
        if (raw[col.key] === '') {
          line[col.key] = '';
          if (col.required) errors.push({ sheet: def.name, row: r, column: col.header, message: 'Obligatoire' });
          continue;
        }
        const converted = CONVERT[col.type](raw[col.key], col);
        if (converted.error || Number.isNaN(converted.value)) {
          errors.push({ sheet: def.name, row: r, column: col.header, message: converted.error || 'Montant invalide : un nombre entier, sans virgule (ex. 45000)' });
          line[col.key] = '';
          line.invalid = true;
        } else {
          line[col.key] = converted.value;
        }
      }
      rows[key].push(line);
    }
  }
  return { rows, errors };
}

// ── Vérification ligne par ligne ─────────────────────────────────────────────

/** Erreurs d'un schéma de validation → erreurs citant la colonne du fichier (via `fieldToColumn`). */
function pushSchemaErrors(errors, sheet, row, parsed, fieldToColumn) {
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? '');
    const column = fieldToColumn[field];
    // Un champ que le fichier ne porte pas (valeur technique fixée par l'import) ne doit jamais être
    // reproché à l'utilisateur sous un nom qu'il ne connaît pas.
    errors.push({ sheet, row, column: column ?? null, message: issue.message });
  }
}

const headerOf = (sheetKey, key) => SHEETS[sheetKey].columns.find((c) => c.key === key).header;

function previousMonth(todayIso) {
  const [y, m] = todayIso.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Transforme les lignes lues en plan d'import (données déjà validées par les schémas existants).
 * N'écrit rien. `existing` : ce que la base contient déjà pour ce cabinet (téléphones, compteurs).
 */
function buildPlan(rows, existing, { todayIso, depositToggles }) {
  const errors = [];
  const S = { owners: SHEETS.owners.name, units: SHEETS.units.name, renters: SHEETS.renters.name };

  // ── Propriétaires ──
  const owners = [];
  const ownerByPhone = new Map(); // téléphone → { existingId } | { index dans `owners` }
  for (const line of rows.owners) {
    if (line.invalid) continue;
    const parsed = createOwnerSchema.safeParse({ name: line.name, phone: line.phone, email: line.email, address: line.address, notes: line.notes });
    if (!parsed.success) {
      pushSchemaErrors(errors, S.owners, line.row, parsed, { name: 'Nom', phone: 'Téléphone', email: 'E-mail', address: 'Adresse', notes: 'Notes' });
      continue;
    }
    const phone = parsed.data.phone;
    if (!phone) continue; // « Obligatoire » déjà signalé à la lecture
    if (ownerByPhone.has(phone)) {
      errors.push({ sheet: S.owners, row: line.row, column: 'Téléphone', message: 'Ce téléphone figure déjà sur une autre ligne de cette feuille.' });
      continue;
    }
    const known = existing.owners.get(phone);
    if (known) {
      if (known.mandateEnded) {
        errors.push({ sheet: S.owners, row: line.row, column: 'Téléphone', message: 'Ce propriétaire existe déjà mais son mandat est terminé : réactivez-le avant l’import.' });
        continue;
      }
      ownerByPhone.set(phone, { existingId: known.id });
    } else {
      ownerByPhone.set(phone, { index: owners.length });
      owners.push({ row: line.row, data: parsed.data });
    }
  }

  // ── Biens et logements ──
  const properties = []; // { row, ownerRef, data, units: [...] }
  const propertyByRef = new Map();
  const unitByRef = new Map(); // « réf bien|réf logement » → unité du plan
  const seenMeters = { sbee: new Map(), soneb: new Map() };
  const typeLabel = (k) => PROPERTY_TYPES.find((t) => t.key === k)?.label ?? k;

  for (const line of rows.units) {
    if (line.invalid || !line.propertyRef || !line.unitRef) continue;
    const ownerPhone = createOwnerSchema.shape.phone.safeParse(line.ownerPhone);
    if (!ownerPhone.success || !ownerPhone.data) {
      errors.push({ sheet: S.units, row: line.row, column: headerOf('units', 'ownerPhone'), message: 'Numéro béninois invalide (10 chiffres, ex. 0161234567)' });
      continue;
    }
    let ownerRef = ownerByPhone.get(ownerPhone.data);
    if (!ownerRef) {
      const known = existing.owners.get(ownerPhone.data);
      if (known && !known.mandateEnded) ownerRef = { existingId: known.id };
    }
    if (!ownerRef) {
      errors.push({ sheet: S.units, row: line.row, column: headerOf('units', 'ownerPhone'), message: 'Aucun propriétaire avec ce téléphone, ni dans la feuille Propriétaires ni dans votre espace.' });
      continue;
    }

    const propKey = norm(line.propertyRef);
    let property = propertyByRef.get(propKey);
    if (!property) {
      const parsedProperty = createPropertySchema.safeParse({ ownerId: 1, address: line.address || line.propertyRef, propertyType: line.propertyType });
      if (!parsedProperty.success) {
        pushSchemaErrors(errors, S.units, line.row, parsedProperty, { address: headerOf('units', 'address'), propertyType: headerOf('units', 'propertyType') });
        continue;
      }
      property = { row: line.row, ref: String(line.propertyRef), ownerPhone: ownerPhone.data, ownerRef, data: parsedProperty.data, units: [] };
      propertyByRef.set(propKey, property);
      properties.push(property);
    } else {
      // Un même bien ne peut avoir qu'un propriétaire et un type : toute ligne qui contredit la
      // première est signalée plutôt que silencieusement ignorée.
      if (property.ownerPhone !== ownerPhone.data) {
        errors.push({ sheet: S.units, row: line.row, column: headerOf('units', 'ownerPhone'), message: `Le bien « ${property.ref} » est rattaché à un autre propriétaire à la ligne ${property.row}.` });
        continue;
      }
      if (line.propertyType && line.propertyType !== property.data.propertyType) {
        errors.push({ sheet: S.units, row: line.row, column: headerOf('units', 'propertyType'), message: `Le bien « ${property.ref} » est de type « ${typeLabel(property.data.propertyType)} » à la ligne ${property.row}.` });
        continue;
      }
    }

    const parsedUnit = createUnitSchema.safeParse({
      designation: line.designation,
      designationCustom: line.designationCustom,
      monthlyRent: line.monthlyRent,
      sonebMeterNumber: line.sonebMeterNumber,
      sbeeMeterNumber: line.sbeeMeterNumber,
      furnished: line.furnished === '' ? false : line.furnished,
    });
    if (!parsedUnit.success) {
      pushSchemaErrors(errors, S.units, line.row, parsedUnit, {
        designation: headerOf('units', 'designation'),
        designationCustom: headerOf('units', 'designationCustom'),
        monthlyRent: headerOf('units', 'monthlyRent'),
        sonebMeterNumber: headerOf('units', 'sonebMeterNumber'),
        sbeeMeterNumber: headerOf('units', 'sbeeMeterNumber'),
        furnished: headerOf('units', 'furnished'),
      });
      continue;
    }

    const unitKey = `${propKey}|${norm(line.unitRef)}`;
    if (unitByRef.has(unitKey)) {
      errors.push({ sheet: S.units, row: line.row, column: headerOf('units', 'unitRef'), message: `Le logement « ${line.unitRef} » du bien « ${property.ref} » figure déjà à la ligne ${unitByRef.get(unitKey).row}.` });
      continue;
    }
    let meterConflict = false;
    for (const [kind, value, column] of [['sbee', parsedUnit.data.sbeeMeterNumber, 'sbeeMeterNumber'], ['soneb', parsedUnit.data.sonebMeterNumber, 'sonebMeterNumber']]) {
      if (!value) continue;
      if (existing.meters[kind].has(value)) {
        errors.push({ sheet: S.units, row: line.row, column: headerOf('units', column), message: 'Ce numéro de compteur est déjà utilisé par un logement de votre espace.' });
        meterConflict = true;
      } else if (seenMeters[kind].has(value)) {
        errors.push({ sheet: S.units, row: line.row, column: headerOf('units', column), message: `Ce numéro de compteur figure déjà à la ligne ${seenMeters[kind].get(value)}.` });
        meterConflict = true;
      } else {
        seenMeters[kind].set(value, line.row);
      }
    }
    if (meterConflict) continue;

    const unit = { row: line.row, ref: String(line.unitRef), data: parsedUnit.data, renter: null };
    property.units.push(unit);
    unitByRef.set(unitKey, unit);
  }

  // ── Locataires ──
  const enabledDeposits = new Set(enabledAdditionalDepositTypes(depositToggles).map((t) => t.key));
  const depositLabel = (key) => ADDITIONAL_DEPOSIT_TYPES.find((t) => t.key === key)?.label ?? key;
  const seenRenterPhones = new Map();
  const debtMonth = previousMonth(todayIso);
  const renterFieldToColumn = {
    firstName: 'Prénom', lastName: 'Nom', phone: 'Téléphone', email: 'E-mail', profession: 'Profession',
    startDate: headerOf('renters', 'startDate'), monthlyRent: headerOf('renters', 'monthlyRent'), rentDueDay: headerOf('renters', 'rentDueDay'),
    depositAmount: headerOf('renters', 'depositAmount'), depositPaymentMethod: headerOf('renters', 'depositPaymentMethod'),
    upToDateAtOnboarding: headerOf('renters', 'currentMonthPaid'), openingDebtItems: headerOf('renters', 'unpaidRentMonths'),
    additionalDeposits: headerOf('renters', 'depositSbee'),
  };
  let renterCount = 0;

  for (const line of rows.renters) {
    if (line.invalid || !line.propertyRef || !line.unitRef) continue;
    const unit = unitByRef.get(`${norm(line.propertyRef)}|${norm(line.unitRef)}`);
    if (!unit) {
      errors.push({ sheet: S.renters, row: line.row, column: headerOf('renters', 'unitRef'), message: `Aucun logement « ${line.unitRef} » dans le bien « ${line.propertyRef} » de la feuille Logements (ou sa ligne contient une erreur).` });
      continue;
    }
    if (unit.renter) {
      errors.push({ sheet: S.renters, row: line.row, column: headerOf('renters', 'unitRef'), message: `Ce logement est déjà attribué au locataire de la ligne ${unit.renter.row}.` });
      continue;
    }
    if (line.startDate && line.startDate > todayIso) {
      errors.push({ sheet: S.renters, row: line.row, column: headerOf('renters', 'startDate'), message: 'La date d’entrée est dans le futur : l’import concerne les locataires déjà dans les lieux.' });
      continue;
    }

    const additionalDeposits = {};
    let depositTypeDisabled = false;
    for (const [type, column] of [['sbee', 'depositSbee'], ['soneb', 'depositSoneb'], ['peinture', 'depositPeinture']]) {
      const amount = line[column];
      if (amount === '' || amount === 0) continue;
      if (!enabledDeposits.has(type)) {
        errors.push({ sheet: S.renters, row: line.row, column: headerOf('renters', column), message: `La ${depositLabel(type)} n’est pas activée dans vos Paramètres : activez-la avant l’import, ou videz cette colonne.` });
        depositTypeDisabled = true;
        continue;
      }
      additionalDeposits[type] = { amount, paymentMethod: line.depositPaymentMethod || 'especes', paidAt: todayIso, refundable: true };
    }
    if (depositTypeDisabled) continue;

    const rent = line.monthlyRent === '' ? unit.data.monthlyRent : line.monthlyRent;
    const openingDebtItems = [
      ...(line.unpaidRentMonths || []).map((periodMonth) => ({ debtType: 'loyer', periodMonth, amount: rent })),
      ...[['sbee', 'debtSbee'], ['soneb', 'debtSoneb'], ['poubelle', 'debtPoubelle'], ['autre', 'debtAutre']]
        .filter(([, column]) => line[column] !== '' && line[column] > 0)
        .map(([debtType, column]) => ({ debtType, periodMonth: debtMonth, amount: line[column], label: 'Repris à l’import' })),
    ];
    const depositAmount = line.depositAmount === '' ? 0 : line.depositAmount;

    const parsed = createRenterSchema.safeParse({
      firstName: line.firstName,
      lastName: line.lastName,
      phone: line.phone,
      email: line.email,
      profession: line.profession,
      unitId: 1, // remplacé par l'identifiant réel du logement au moment de l'écriture
      startDate: line.startDate,
      ...(line.monthlyRent === '' ? {} : { monthlyRent: line.monthlyRent }),
      ...(line.rentDueDay === '' ? {} : { rentDueDay: line.rentDueDay }),
      depositAmount,
      depositRefundable: line.depositRefundable === '' ? true : line.depositRefundable,
      // Date de réception = jour de l'import, comme le formulaire « ancien locataire » : c'est une
      // reprise de situation (le cabinet détient cette caution aujourd'hui), et une date ancienne
      // tomberait dans un mois comptable possiblement déjà clôturé.
      ...(depositAmount > 0 ? { depositPaymentMethod: line.depositPaymentMethod || 'especes', depositPaidAt: todayIso } : {}),
      additionalDeposits,
      // Ancien locataire : jamais de frais d'agence ni de prorata d'entrée.
      entryFeeAmount: 0,
      entryProration: 'aucun',
      upToDateAtOnboarding: line.currentMonthPaid === true,
      openingDebtItems,
    });
    if (!parsed.success) {
      pushSchemaErrors(errors, S.renters, line.row, parsed, renterFieldToColumn);
      continue;
    }
    const phone = parsed.data.phone;
    if (seenRenterPhones.has(phone)) {
      errors.push({ sheet: S.renters, row: line.row, column: 'Téléphone', message: `Ce téléphone figure déjà à la ligne ${seenRenterPhones.get(phone)}.` });
      continue;
    }
    seenRenterPhones.set(phone, line.row);
    if (existing.renterPhones.has(phone)) {
      errors.push({ sheet: S.renters, row: line.row, column: 'Téléphone', message: 'Un locataire avec ce téléphone existe déjà dans votre espace.' });
      continue;
    }
    unit.renter = { row: line.row, data: parsed.data };
    renterCount += 1;
  }

  const unitCount = properties.reduce((n, p) => n + p.units.length, 0);
  if (errors.length === 0 && owners.length + unitCount + renterCount === 0) {
    errors.push({ sheet: null, row: null, column: null, message: 'Le fichier ne contient aucune ligne à importer.' });
  }

  return {
    errors,
    plan: { owners, properties },
    summary: {
      ownersCreated: owners.length,
      ownersReused: [...ownerByPhone.values()].filter((o) => o.existingId).length,
      properties: properties.length,
      units: unitCount,
      vacantUnits: unitCount - renterCount,
      renters: renterCount,
    },
  };
}

// ── Écriture (une seule transaction) ─────────────────────────────────────────

async function loadExisting(tenantId) {
  const [ownerRows] = await pool.query('SELECT id, phone, mandate_ended_at FROM owners WHERE tenant_id = :tenantId AND phone IS NOT NULL', { tenantId });
  const [renterRows] = await pool.query('SELECT phone FROM renters WHERE tenant_id = :tenantId', { tenantId });
  const [meterRows] = await pool.query(
    'SELECT sbee_meter_number, soneb_meter_number FROM property_units WHERE tenant_id = :tenantId AND (sbee_meter_number IS NOT NULL OR soneb_meter_number IS NOT NULL)',
    { tenantId },
  );
  return {
    owners: new Map(ownerRows.map((o) => [o.phone, { id: o.id, mandateEnded: !!o.mandate_ended_at }])),
    renterPhones: new Set(renterRows.map((r) => r.phone)),
    meters: {
      sbee: new Set(meterRows.map((m) => m.sbee_meter_number).filter(Boolean)),
      soneb: new Set(meterRows.map((m) => m.soneb_meter_number).filter(Boolean)),
    },
  };
}

/**
 * Écrit tout le plan sur `conn` (transaction déjà ouverte par l'appelant). Lève une ApiError dont le
 * message cite la feuille et la ligne en cause quand une règle de la base refuse une ligne.
 */
async function writePlan(conn, tenantId, userId, plan) {
  const at = (sheet, row, err) => {
    if (err instanceof ApiError) {
      const wrapped = new ApiError(err.status, err.message, err.details);
      wrapped.importLocation = { sheet, row };
      return wrapped;
    }
    return err;
  };

  const unitCount = plan.properties.reduce((n, p) => n + p.units.length, 0);
  if (plan.owners.length) await assertWithinLimit(tenantId, 'owners', conn, plan.owners.length);
  if (unitCount) await assertWithinLimit(tenantId, 'units', conn, unitCount);

  const ownerIds = [];
  for (const owner of plan.owners) {
    const [result] = await conn.query(
      `INSERT INTO owners (tenant_id, name, phone, email, address, notes, created_by)
       VALUES (:tenantId, :name, :phone, :email, :address, :notes, :createdBy)`,
      { tenantId, ...owner.data, createdBy: userId },
    );
    ownerIds.push(result.insertId);
  }

  const [[{ n: existingProperties }]] = await conn.query('SELECT COUNT(*) AS n FROM properties WHERE tenant_id = :tenantId', { tenantId });
  let propertyNumber = Number(existingProperties);

  for (const property of plan.properties) {
    const ownerId = property.ownerRef.existingId ?? ownerIds[property.ownerRef.index];
    propertyNumber += 1;
    // Mêmes écritures que `services/properties.js` `createProperty` (code séquentiel + première
    // période de `property_owner_history`, indispensable à la comptabilité propriétaire).
    const code = `BIEN-${String(propertyNumber).padStart(3, '0')}`;
    const [propertyResult] = await conn.query(
      `INSERT INTO properties (tenant_id, code, owner_id, address, property_type, created_by)
       VALUES (:tenantId, :code, :ownerId, :address, :type, :createdBy)`,
      { tenantId, code, ownerId, address: property.data.address, type: property.data.propertyType, createdBy: userId },
    );
    const propertyId = propertyResult.insertId;
    await conn.query(
      'INSERT INTO property_owner_history (tenant_id, property_id, owner_id, starts_on, set_by) VALUES (:tenantId, :propertyId, :ownerId, CURDATE(), :setBy)',
      { tenantId, propertyId, ownerId, setBy: userId },
    );

    let unitNumber = 0;
    for (const unit of property.units) {
      unitNumber += 1;
      const [unitResult] = await conn.query(
        `INSERT INTO property_units
           (tenant_id, property_id, code, designation, designation_custom, monthly_rent,
            soneb_meter_number, sbee_meter_number, furnished, created_by)
         VALUES (:tenantId, :propertyId, :code, :designation, :designationCustom, :rent,
                 :sonebMeterNumber, :sbeeMeterNumber, :furnished, :createdBy)`,
        {
          tenantId,
          propertyId,
          code: `${code}-U${String(unitNumber).padStart(2, '0')}`,
          designation: unit.data.designation,
          designationCustom: unit.data.designationCustom,
          rent: unit.data.monthlyRent,
          sonebMeterNumber: unit.data.sonebMeterNumber,
          sbeeMeterNumber: unit.data.sbeeMeterNumber,
          furnished: unit.data.furnished ? 1 : 0,
          createdBy: userId,
        },
      );
      if (!unit.renter) continue;

      const data = { ...unit.renter.data, unitId: unitResult.insertId };
      try {
        const terms = await prepareLeaseTerms(conn, tenantId, { monthly_rent: unit.data.monthlyRent }, data);
        const [renterResult] = await conn.query(
          `INSERT INTO renters (tenant_id, first_name, last_name, phone, email, profession, notes, created_by)
           VALUES (:tenantId, :firstName, :lastName, :phone, :email, :profession, NULL, :createdBy)`,
          { tenantId, firstName: data.firstName, lastName: data.lastName, phone: data.phone, email: data.email, profession: data.profession, createdBy: userId },
        );
        await insertLeaseWithEntries(conn, {
          tenantId,
          userId,
          renterId: renterResult.insertId,
          renterName: `${data.firstName} ${data.lastName}`,
          data,
          terms,
        });
        // Lien du portail locataire créé d'office, comme à la création manuelle (`createRenter`).
        await conn.query('UPDATE renters SET portal_token_hash = :hash, portal_link_created_at = NOW() WHERE id = :id AND tenant_id = :tenantId', {
          hash: hashToken(generatePortalToken()),
          id: renterResult.insertId,
          tenantId,
        });
      } catch (err) {
        throw at(SHEETS.renters.name, unit.renter.row, err);
      }
    }
  }
}

/**
 * Point d'entrée unique. `commit: false` = aperçu (essai réel puis annulation) ; `commit: true` =
 * import définitif. Renvoie toujours `{ ok, errors, summary }` — `ok: false` signifie que RIEN n'a
 * été écrit.
 */
async function runImport(tenantId, userId, buffer, { commit }) {
  const { rows, errors: readErrors } = await readWorkbook(buffer);
  const todayIso = new Date().toISOString().slice(0, 10);
  const depositToggles = await loadDepositTogglesRow(pool, tenantId);
  const { errors: planErrors, plan, summary } = buildPlan(rows, await loadExisting(tenantId), { todayIso, depositToggles });

  const errors = [...readErrors, ...planErrors];
  const finish = (ok) => ({
    ok,
    summary,
    errorCount: errors.length,
    errors: errors
      .sort((a, b) => SHEET_ORDER.findIndex((k) => SHEETS[k].name === a.sheet) - SHEET_ORDER.findIndex((k) => SHEETS[k].name === b.sheet) || (a.row ?? 0) - (b.row ?? 0))
      .slice(0, MAX_ERRORS),
  });
  if (errors.length) return finish(false);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await writePlan(conn, tenantId, userId, plan);
    if (commit) {
      await conn.commit();
      logger.info('Import Excel effectué', { tenantId, by: userId, ...summary });
    } else {
      await conn.rollback();
    }
    return finish(true);
  } catch (err) {
    await conn.rollback().catch(() => {});
    // Refus métier (mois clôturé, limite de l'offre, doublon créé entre-temps…) : rendu comme une
    // erreur du fichier, pas comme une panne. Toute autre erreur remonte (500, suivie dans le back-office).
    if (err instanceof ApiError && err.status < 500) {
      errors.push({ sheet: err.importLocation?.sheet ?? null, row: err.importLocation?.row ?? null, column: null, message: err.message });
      return finish(false);
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { buildTemplateBuffer, runImport, SHEETS, MAX_ROWS_PER_SHEET };
