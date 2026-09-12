#!/bin/sh
# Étape 12b — au démarrage du conteneur API : applique les migrations SQL en
# attente, puis lance la commande passée (par défaut `node src/server.js`).
#
# Le runner (`src/db/migrate.js`) est idempotent : il tient une table
# `_migrations` et n'exécute que les fichiers absents de cette table, chacun
# dans une transaction. Rejouer l'entrypoint est donc sans effet.
#
# Déploiement mono-instance (Compose) : pas de course possible. Pour plusieurs
# répliques d'API, sortir cette étape dans un service one-shot dédié.
set -e

echo "→ Migrations de base de données…"
node src/db/migrate.js up

echo "→ Démarrage : $*"
exec "$@"
