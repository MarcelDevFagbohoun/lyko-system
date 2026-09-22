'use strict';

/**
 * Garde-fou avant `npm run dev` : un second `next dev` + `nodemon` lancé
 * depuis un autre terminal alors qu'une première instance tourne déjà
 * corrompt le cache partagé `frontend/.next` (deux process qui compilent
 * en même temps dans le même dossier) — cause de la quasi-totalité des
 * erreurs "ENOENT .next/..." et "CSS ne s'applique pas" rencontrées.
 *
 * Vérifie que les ports 3000 (frontend) et 4000 (backend) sont libres avant
 * de démarrer ; sinon, affiche comment nettoyer et refuse de lancer un
 * second serveur en double.
 */

const net = require('net');

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

(async () => {
  const [freeFrontend, freeBackend] = await Promise.all([isPortFree(3000), isPortFree(4000)]);

  if (freeFrontend && freeBackend) {
    process.exit(0);
  }

  const busy = [];
  if (!freeFrontend) busy.push('3000 (frontend)');
  if (!freeBackend) busy.push('4000 (backend)');

  process.stderr.write(
    `\n✖ npm run dev refusé : port(s) déjà occupé(s) — ${busy.join(', ')}.\n` +
      `  Un serveur de dev tourne probablement déjà dans un autre terminal.\n` +
      `  Lancer une deuxième instance corromprait le cache .next partagé.\n\n` +
      `  Pour nettoyer et repartir propre :\n` +
      `    fuser -k 3000/tcp 4000/tcp\n` +
      `    pkill -9 -f "next dev"; pkill -9 -f nodemon; pkill -9 -f next-server; pkill -9 -f "node src/server.js"\n` +
      `    rm -rf frontend/.next\n` +
      `    npm run dev\n\n`,
  );
  process.exit(1);
})();
