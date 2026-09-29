'use strict';

/**
 * Rendu PDF de l'état des lieux (étape 48, audit) — `streamMoveInPdf`
 * (nouveau : n'existait pas avant) et `streamMoveOutPdf` (mode de règlement
 * de la caution + réserves du locataire + réouverture, tous corrigés/ajoutés
 * à cette étape). Objets construits à la main (forme `toPublicInspectionReport`/
 * `toPublicMoveOutReport`) — aucune base requise, ces fonctions ne lisent que
 * ce qu'on leur passe.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');

const { streamMoveInPdf, streamMoveOutPdf } = require('../src/services/pdf');

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
  const file = path.join(os.tmpdir(), `etat-lieux-test-${process.pid}-${Date.now()}.pdf`);
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

const tenant = { company_name: 'Cabinet Test', rccm: 'RCCM-X', ifu: 'IFU-X', contact_phone: '0100000000' };
const renter = { first_name: 'Jean', last_name: 'Dupont' };
const lease = { start_date: '2026-01-01' };
const property = { designation: 'autre', designation_custom: 'Studio', address: 'Adresse test' };

function zoneWithItems(items) {
  return { key: 'chambre', label: 'Chambre', custom: false, items };
}

test('streamMoveInPdf — PDF valide, sans colonne de retenue (constat, pas de facturation)', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const report = {
    conductedAt: '2026-01-01',
    zones: [zoneWithItems([{ key: 'porte', label: 'Porte', condition: 'BE', comment: null, photoUrls: [], deduction: 0, billing: null }])],
    generalNotes: null,
    tenantReserves: null,
    reopenedAt: null,
    tenantSignatureUrl: null,
    agentSignatureUrl: null,
  };
  const pdf = await capturePdf((res) => streamMoveInPdf(res, { tenant, renter, property, lease, report }));
  const text = pdfText(pdf);
  assert.match(text, /ÉTAT DES LIEUX D'ENTRÉE/);
  assert.match(text, /Porte — Bon état/);
  // Constat d'entrée : jamais de montant de retenue, cette notion n'existe pas ici.
  assert.doesNotMatch(text, /FCFA/);
});

test('streamMoveInPdf — réserves du locataire mises en avant, réouverture mentionnée', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const report = {
    conductedAt: '2026-01-01',
    zones: [zoneWithItems([{ key: 'porte', label: 'Porte', condition: 'ME', comment: null, photoUrls: [], deduction: 0, billing: null }])],
    generalNotes: null,
    tenantReserves: "Le locataire n'est pas d'accord sur l'état de la porte.",
    reopenedAt: '2026-02-01T10:00:00.000Z',
    tenantSignatureUrl: null,
    agentSignatureUrl: null,
  };
  const text = pdfText(await capturePdf((res) => streamMoveInPdf(res, { tenant, renter, property, lease, report })));
  assert.match(text, /RÉSERVES DU LOCATAIRE/);
  assert.match(text, /pas d'accord sur l'état de la porte/);
  assert.match(text, /corrigé le/);
});

test('streamMoveOutPdf — transition Bon état -> Mauvais état, facturation, mode de règlement de la caution (bug corrigé)', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const moveInZones = [zoneWithItems([{ key: 'carrelage', label: 'Carrelage', condition: 'BE' }])];
  const report = {
    conductedAt: '2026-06-01',
    zones: [
      zoneWithItems([
        {
          key: 'carrelage',
          label: 'Carrelage',
          condition: 'ME',
          comment: 'Carreaux cassés',
          photoUrls: [],
          deduction: 25000,
          billing: { lines: [{ label: 'Reprise carrelage', unitPrice: 25000, quantity: 1 }] },
        },
      ]),
    ],
    generalNotes: null,
    tenantReserves: null,
    reopenedAt: null,
    otherDeductionsAmount: 0,
    otherDeductionsNote: null,
    depositAmount: 60000,
    totalDeductions: 25000,
    netRefund: 35000,
    refundPaymentMethod: 'mobile_money',
    tenantSignatureUrl: null,
    agentSignatureUrl: null,
  };
  const text = pdfText(
    await capturePdf((res) => streamMoveOutPdf(res, { tenant, renter, property, lease, report, moveInZones, additionalDeposits: [] })),
  );
  assert.match(text, /Bon état -> Mauvais état/);
  assert.match(text, /Reprise carrelage/);
  assert.match(text, /35 000 FCFA/);
  // Bug corrigé (audit étape 48) : le mode de règlement n'apparaissait nulle part sur ce PV signé.
  assert.match(text, /Réglé par/);
  assert.match(text, /Mobile Money/);
});

test('streamMoveOutPdf — sans remboursement dû (caution absorbée), aucune mention de mode de règlement', { skip: !hasPdftotext && 'pdftotext indisponible' }, async () => {
  const report = {
    conductedAt: '2026-06-01',
    zones: [zoneWithItems([{ key: 'carrelage', label: 'Carrelage', condition: 'BE', comment: null, photoUrls: [], deduction: 0, billing: null }])],
    generalNotes: null,
    tenantReserves: null,
    reopenedAt: null,
    otherDeductionsAmount: 60000,
    otherDeductionsNote: 'Retenue intégrale',
    depositAmount: 60000,
    totalDeductions: 60000,
    netRefund: 0,
    refundPaymentMethod: null,
    tenantSignatureUrl: null,
    agentSignatureUrl: null,
  };
  const text = pdfText(await capturePdf((res) => streamMoveOutPdf(res, { tenant, renter, property, lease, report, moveInZones: [], additionalDeposits: [] })));
  assert.doesNotMatch(text, /Réglé par/);
});
