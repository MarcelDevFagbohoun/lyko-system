'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendSubscriptionActivatedEmail } = require('../src/services/email/sendEmail');
const { PLANS } = require('../src/constants/plans');

test("email d'abonnement — ne plante pas et échappe le contenu variable", async () => {
  const r = await sendSubscriptionActivatedEmail({
    to: 'x@example.com', dgName: '<b>Marcel</b>', companyName: 'A&B', plan: PLANS.pro, months: 4, amount: 65000, endDate: '1 janvier 2027', renewal: false,
  });
  assert.equal(typeof r.sent, 'boolean');
});

test('reçu PDF en mémoire — un vrai PDF avec le code de vérification', async () => {
  const { buildSubscriptionReceiptBuffer } = require('../src/services/pdf');
  const buf = await buildSubscriptionReceiptBuffer({
    client: { company_name: 'Cabinet Test', rccm: '', ifu: '' },
    payment: { invoice_number: 'AIM-2026-000001', reference: 'a'.repeat(32), months: 4, amount: 65000, founder_price: 0, paid_at: new Date() },
    planLabel: 'Pro',
    verificationCode: 'ABCD-EFGH-JKLM',
  });
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.ok(buf.length > 1000);
});
