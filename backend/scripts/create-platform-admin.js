'use strict';
// Usage : node scripts/create-platform-admin.js "Nom" email@exemple.com   (le mot de passe est demandé via PLATFORM_ADMIN_PASSWORD)
const { pool, closePool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

(async () => {
  const [name, email] = process.argv.slice(2);
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!name || !email || !password || password.length < 12) {
    console.error('Usage : PLATFORM_ADMIN_PASSWORD=<12 caractères min> node scripts/create-platform-admin.js "Nom" email');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  await pool.query(
    'INSERT INTO platform_admins (email, name, password_hash) VALUES (:email, :name, :hash) ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), status = \'active\'',
    { email: email.toLowerCase(), name, hash },
  );
  console.log('Administrateur enregistré :', email.toLowerCase());
  await closePool();
})().catch((e) => { console.error(e.message); process.exit(1); });
