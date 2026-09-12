'use strict';

/**
 * Vérifie la connexion MySQL avec la configuration de backend/.env.
 * Sortie 0 si OK, 1 sinon. Utilisé comme critère de validation de l'étape 0.
 *
 *   npm run db:check
 */

const config = require('../src/config/env');
const { pingDatabase, closePool } = require('../src/config/db');

(async () => {
  process.stdout.write(
    `→ Connexion à mysql://${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}\n`,
  );
  try {
    const diag = await pingDatabase();
    process.stdout.write('✔ Connexion MySQL réussie\n');
    process.stdout.write(`  serveur   : ${diag.serverVersion}\n`);
    process.stdout.write(`  base      : ${diag.database}\n`);
    process.stdout.write(`  latence   : ${diag.latencyMs} ms\n`);
    process.stdout.write(`  heure srv : ${diag.serverTime}\n`);
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write(`✖ Échec de connexion : ${err.message}\n`);
    if (err.code) process.stderr.write(`  code : ${err.code}\n`);
    process.stderr.write('\nPistes :\n');
    process.stderr.write('  1. Le serveur MySQL est-il démarré ?\n');
    process.stderr.write('  2. backend/.env contient-il les bons DB_USER / DB_PASSWORD / DB_NAME ?\n');
    process.stderr.write('  3. La base et l\'utilisateur existent-ils ? (voir README, section "Base de données")\n');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
})();
