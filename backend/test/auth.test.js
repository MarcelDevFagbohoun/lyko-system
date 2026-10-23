'use strict';

/**
 * Inscription + vérification d'email obligatoire (demande utilisateur, 2026-10-18) : email +
 * pays + téléphone validé par pays, code à 8 chiffres envoyé par email (Resend, FAUX client
 * injecté ici — AUCUN appel réseau ni aucune dépense), connexion bloquée tant que le code n'est
 * pas saisi, email de bienvenue différé (~2 min, via `jobs/welcomeEmailJob.js`), nettoyage des
 * inscriptions abandonnées après 24h (`jobs/registrationCleanupJob.js`). Voir routes/auth.js.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool } = require('../src/config/db');
const { createApp } = require('../src/app');
const { setClientForTests } = require('../src/services/email/resendClient');
const { runWelcomeEmailJob } = require('../src/jobs/welcomeEmailJob');
const { runRegistrationCleanupJob } = require('../src/jobs/registrationCleanupJob');

let server;
let baseUrl;
const createdTenantIds = [];

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  setClientForTests(null);
  await new Promise((resolve) => server.close(resolve));
  for (const tenantId of createdTenantIds) {
    await pool.query('DELETE FROM tenants WHERE id = :id', { id: tenantId }).catch(() => {});
  }
  await closePool();
});

/** Faux client Resend — capture chaque envoi, jamais d'appel réseau. `calls[i].args[0]` = payload. */
function installEmailClient() {
  const calls = [];
  setClientForTests({
    emails: {
      async send(payload) {
        calls.push(payload);
        return { data: { id: 'fake-id' }, error: null };
      },
    },
  });
  return calls;
}

let emailCalls;
beforeEach(() => {
  emailCalls = installEmailClient();
});

function extractCode(html) {
  const match = html.match(/font-size:32px;font-weight:bold;letter-spacing:0\.15em;color:#1E3A8A;">(\d{8})</);
  return match ? match[1] : null;
}

// `PHONE_LOCAL_RE` (validators/auth.js) exige EXACTEMENT 10 chiffres — `padStart` garantit que
// même un tirage aléatoire court (ex. 42) donne toujours 8 chiffres après le préfixe, jamais un
// numéro trop court qui échouerait la validation de façon intermittente.
function uniquePhone(prefix = '01') {
  return `${prefix}${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
}

function uniqueEmail() {
  return `qa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

// `registerLimiter` (routes/auth.js) plafonne à 10 inscriptions/heure PAR IP — un plafond
// anti-abus légitime en production, qu'il ne faut surtout pas affaiblir juste pour ce fichier de
// test. `app.set('trust proxy', 1)` (app.js) fait foi de `X-Forwarded-For` : chaque test simule
// une IP distincte (comme des personnes/navigateurs différents), exactement comme les vraies
// inscriptions concurrentes que ce plafond est censé limiter — jamais un contournement du
// plafond lui-même.
let ipCounter = 0;
function nextTestIp() {
  ipCounter += 1;
  return `10.77.0.${ipCounter}`;
}

async function registerAndGetCode(overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  const ip = overrides.ip ?? nextTestIp();
  const body = {
    firstName: 'Marcel',
    lastName: 'Houenou',
    companyName: `QA Register ${Date.now()}`,
    rccm: 'RB/COT/21 B 1234',
    ifu: '1234567890123',
    email,
    country: 'BJ',
    phone: uniquePhone(),
    password: 'Abcdef12!@',
    confirmPassword: 'Abcdef12!@',
    acceptTerms: true,
    ...overrides,
  };
  delete body.ip;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const sent = emailCalls.find((c) => c.to === email);
  const code = sent ? extractCode(sent.html) : null;
  const [[userRow]] = await pool.query('SELECT id, tenant_id FROM users WHERE email = :email LIMIT 1', { email });
  if (userRow) createdTenantIds.push(userRow.tenant_id);
  return { res, json, code, email, userId: userRow?.id, tenantId: userRow?.tenant_id };
}

test("POST /register — crée le compte mais n'ouvre AUCUNE session (vérification en attente)", async () => {
  const { res, json, code, email } = await registerAndGetCode();
  assert.equal(res.status, 201);
  assert.equal(json.pendingVerification, true);
  assert.equal(json.email, email);
  assert.equal(json.accessToken, undefined, 'aucun token tant que l\'email n\'est pas vérifié');
  assert.ok(code, 'un code à 8 chiffres doit avoir été envoyé par email');
  assert.equal(code.length, 8);

  const [[row]] = await pool.query(
    'SELECT email_verified_at, email_verification_attempts FROM users WHERE email = :email LIMIT 1',
    { email },
  );
  assert.equal(row.email_verified_at, null);
  assert.equal(row.email_verification_attempts, 0);
  const [[t]] = await pool.query('SELECT t.terms_accepted_at, t.terms_version FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = :email', { email });
  assert.ok(t.terms_accepted_at, 'la date d’acceptation des conditions est conservée');
  assert.ok(t.terms_version);
});

test('POST /register — refusé (400) sans acceptation des conditions d’utilisation', async () => {
  const { res } = await registerAndGetCode({ acceptTerms: false });
  assert.equal(res.status, 400);
});

test('POST /register — pays Togo avec un numéro réel validé par libphonenumber-js, stocké en E.164', async () => {
  const { res, json: _json, userId } = await registerAndGetCode({ country: 'TG', phone: '90123456', email: uniqueEmail() });
  assert.equal(res.status, 201);
  const [[row]] = await pool.query('SELECT phone FROM users WHERE id = :id', { id: userId });
  assert.equal(row.phone, '+22890123456');
});

test('POST /register — numéro invalide pour le pays choisi → 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextTestIp() },
    body: JSON.stringify({
      firstName: 'Marcel',
      lastName: 'Houenou',
      companyName: 'QA Bad Phone',
      rccm: 'RB/COT/21 B 1234',
      ifu: '1234567890123',
      email: uniqueEmail(),
      country: 'TG',
      phone: '0161234567', // format béninois, invalide pour le Togo
      password: 'Abcdef12!@',
      confirmPassword: 'Abcdef12!@',
    acceptTerms: true,
    }),
  });
  assert.equal(res.status, 400);
});

test('POST /register — numéro déjà utilisé → 409 ; email déjà associé à un compte DG → 409', async () => {
  const first = await registerAndGetCode();

  const samePhone = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextTestIp() },
    body: JSON.stringify({
      firstName: 'Awa',
      lastName: 'Kpakpo',
      companyName: 'QA Doublon Téléphone',
      rccm: 'RB/COT/21 B 1234',
      ifu: '1234567890123',
      email: uniqueEmail(),
      country: 'BJ',
      phone: (await pool.query('SELECT phone FROM users WHERE id = :id', { id: first.userId }))[0][0].phone,
      password: 'Abcdef12!@',
      confirmPassword: 'Abcdef12!@',
    acceptTerms: true,
    }),
  });
  assert.equal(samePhone.status, 409);

  const sameEmail = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextTestIp() },
    body: JSON.stringify({
      firstName: 'Awa',
      lastName: 'Kpakpo',
      companyName: 'QA Doublon Email',
      rccm: 'RB/COT/21 B 1234',
      ifu: '1234567890123',
      email: first.email,
      country: 'BJ',
      phone: uniquePhone(),
      password: 'Abcdef12!@',
      confirmPassword: 'Abcdef12!@',
    acceptTerms: true,
    }),
  });
  assert.equal(sameEmail.status, 409);
});

test('POST /login — refusé (403, code "email_not_verified") tant que le code n\'a pas été saisi, même avec le bon mot de passe', async () => {
  const { userId } = await registerAndGetCode();
  const [[row]] = await pool.query('SELECT phone FROM users WHERE id = :id', { id: userId });

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: row.phone, password: 'Abcdef12!@' }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.deepEqual(body.details?.code, ['email_not_verified']);
});

test('POST /verify-email — code incorrect refusé, compteur incrémenté ; code correct ouvre la session', async () => {
  const { email, code } = await registerAndGetCode();

  const wrong = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '00000000' === code ? '11111111' : '00000000' }),
  });
  assert.equal(wrong.status, 400);
  const [[afterWrong]] = await pool.query('SELECT email_verification_attempts FROM users WHERE email = :email', { email });
  assert.equal(afterWrong.email_verification_attempts, 1);

  const ok = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.ok(okBody.accessToken, 'la vérification doit ouvrir la session, comme /login');
  assert.equal(okBody.user.email, email);
  assert.equal(okBody.tenant.country, 'BJ');

  const [[row]] = await pool.query(
    'SELECT email_verified_at, email_verification_code_hash, welcome_email_due_at FROM users WHERE email = :email',
    { email },
  );
  assert.ok(row.email_verified_at);
  assert.equal(row.email_verification_code_hash, null, 'le code haché est effacé après usage');
  assert.ok(row.welcome_email_due_at, "l'email de bienvenue doit être programmé");

  // La connexion normale fonctionne maintenant.
  const [[phoneRow]] = await pool.query(
    'SELECT phone FROM users WHERE email = :email',
    { email },
  );
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phoneRow.phone, password: 'Abcdef12!@' }),
  });
  assert.equal(login.status, 200);

  // Connexion par e-mail (casse ignorée), mot de passe faux refusé.
  const byEmail = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: ` ${email.toUpperCase()} `, password: 'Abcdef12!@' }),
  });
  assert.equal(byEmail.status, 200);
  assert.equal((await byEmail.json()).user.email, email);
  const badPwd = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: email, password: 'Mauvais12!@' }),
  });
  assert.equal(badPwd.status, 401);
});

test('POST /verify-email — refuse un code expiré, et bloque après 5 tentatives', async () => {
  const { email, code, userId } = await registerAndGetCode();

  await pool.query('UPDATE users SET email_verification_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = :id', {
    id: userId,
  });
  const expired = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(expired.status, 400);
  assert.match((await expired.json()).error, /expiré/);

  // Remet une expiration valide, épuise les tentatives avec un mauvais code.
  await pool.query(
    'UPDATE users SET email_verification_expires_at = DATE_ADD(NOW(), INTERVAL 15 MINUTE), email_verification_attempts = 5 WHERE id = :id',
    { id: userId },
  );
  const lockedOut = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(lockedOut.status, 429);
});

test('POST /resend-verification-code — invalide l\'ancien code, réinitialise les tentatives ; toujours 200 même pour un email inconnu', async () => {
  const { email, code: firstCode, userId } = await registerAndGetCode();
  await pool.query('UPDATE users SET email_verification_attempts = 3 WHERE id = :id', { id: userId });

  const resend = await fetch(`${baseUrl}/api/auth/resend-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(resend.status, 200);
  const sent = emailCalls.filter((c) => c.to === email);
  const newCode = extractCode(sent[sent.length - 1].html);
  assert.notEqual(newCode, firstCode);

  const [[row]] = await pool.query('SELECT email_verification_attempts FROM users WHERE id = :id', { id: userId });
  assert.equal(row.email_verification_attempts, 0);

  const oldCodeAttempt = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: firstCode }),
  });
  assert.equal(oldCodeAttempt.status, 400, "l'ancien code ne doit plus fonctionner");

  const unknown = await fetch(`${baseUrl}/api/auth/resend-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'inconnu-' + uniqueEmail() }),
  });
  assert.equal(unknown.status, 200, 'réponse générique, ne révèle jamais si un email existe');
});

test('runWelcomeEmailJob — envoie une seule fois, seulement une fois l\'échéance passée', async () => {
  const { email, code, userId } = await registerAndGetCode();
  await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });

  // Pas encore dû (programmé 2 min après vérification, juste à l'instant) → rien envoyé.
  await runWelcomeEmailJob({ tenantIds: [(await pool.query('SELECT tenant_id FROM users WHERE id=:id', { id: userId }))[0][0].tenant_id] });
  assert.ok(!emailCalls.some((c) => c.to === email && c.subject === 'Bienvenue sur Africa Immo Management'));

  await pool.query('UPDATE users SET welcome_email_due_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = :id', { id: userId });
  const [[u]] = await pool.query('SELECT tenant_id FROM users WHERE id = :id', { id: userId });
  await runWelcomeEmailJob({ tenantIds: [u.tenant_id] });
  assert.ok(emailCalls.some((c) => c.to === email && c.subject === 'Bienvenue sur Africa Immo Management'));

  const sentCountBefore = emailCalls.filter((c) => c.to === email && c.subject === 'Bienvenue sur Africa Immo Management').length;
  await runWelcomeEmailJob({ tenantIds: [u.tenant_id] });
  const sentCountAfter = emailCalls.filter((c) => c.to === email && c.subject === 'Bienvenue sur Africa Immo Management').length;
  assert.equal(sentCountAfter, sentCountBefore, 'jamais envoyé deux fois');
});

test('runRegistrationCleanupJob — supprime une inscription non vérifiée après 24h, jamais une récente', async () => {
  const stale = await registerAndGetCode();
  const fresh = await registerAndGetCode();

  await pool.query('UPDATE users SET created_at = DATE_SUB(NOW(), INTERVAL 25 HOUR) WHERE id = :id', { id: stale.userId });

  await runRegistrationCleanupJob({ tenantIds: [stale.tenantId, fresh.tenantId] });

  const [[staleTenant]] = await pool.query('SELECT id FROM tenants WHERE id = :id', { id: stale.tenantId });
  assert.equal(staleTenant, undefined, "l'inscription abandonnée (>24h) doit avoir été supprimée");

  const [[freshTenant]] = await pool.query('SELECT id FROM tenants WHERE id = :id', { id: fresh.tenantId });
  assert.ok(freshTenant, 'une inscription récente ne doit jamais être supprimée');

  // Évite au `after()` de re-tenter une suppression déjà faite pour `stale`.
  createdTenantIds.splice(createdTenantIds.indexOf(stale.tenantId), 1);
});
