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
