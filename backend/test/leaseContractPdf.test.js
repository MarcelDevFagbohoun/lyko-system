'use strict';

/**
 * Rendu PDF du contrat de bail avec mise en gras (**mot**) dans le texte des articles — demande
 * utilisateur, 2026-11-06. Vérifie surtout que `drawFormattedText` (continued text PDFKit, changement de
 * police entre segments gras/normal) ne plante pas et produit un PDF lisible ; `pdftotext` ne restitue
 * pas le style, seulement le texte, donc on vérifie le contenu, pas le gras lui-même.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');

const { streamLeaseContractPdf } = require('../src/services/pdf');

function capturePdf(streamFn) {
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    try {
      streamFn(res);
    } catch (err) {
      reject(err);
    }
  });
}

function pdfText(buffer) {
  const file = path.join(os.tmpdir(), `contrat-bail-test-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(file, buffer);
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } finally {
    fs.unlinkSync(file);
  }
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const tenant = { company_name: 'Cabinet Test', rccm: 'RCCM-X', ifu: 'IFU-X', stamp_path: null };
const data = {
  owner: { name: 'Propriétaire Test', address: null },
  renter: { firstName: 'Jean', lastName: 'Dupont', phone: '0100000000' },
  property: { code: 'IMM-01', address: null, typeLabel: 'Immeuble' },
  unit: { code: 'U1', designationLabel: 'Studio', furnished: false, sonebMeterNumber: null, sbeeMeterNumber: null },
  lease: {
    startDate: '2026-01-01',
    monthlyRent: 50000,
    rentDueDay: 5,
    rentDueOffsetDays: null,
    rentTiming: 'avance',
    rentTimingLabel: "Payé d'avance",
    depositAmount: 50000,
    entryFeeAmount: 0,
  },
  additionalDeposits: [],
  particularConditions: null,
  renderedText: '## Un seul article\nCeci est **un mot en gras** au milieu d\'une phrase normale, puis une seconde ligne.',
};
const contract = { status: 'draft', createdAt: new Date('2026-01-01') };

test(
  'streamLeaseContractPdf — un article avec du texte en gras (**mot**) se génère sans erreur et contient le texte',
  { skip: !hasPdftotext && 'pdftotext indisponible' },
  async () => {
    const pdf = await capturePdf((res) => streamLeaseContractPdf(res, { tenant, data, contract, issuer: null, leaseId: 1 }));
    const text = pdfText(pdf);
    assert.match(text, /Un seul article/);
    assert.match(text, /un mot en gras/);
    assert.match(text, /seconde ligne/);
  },
);
