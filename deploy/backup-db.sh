#!/usr/bin/env bash
# ── Sauvegarde de la base Lyko System ───────────────────────────────────────
# Dump compressé + horodaté du conteneur `db`, rotation à 14 jours.
# À planifier sur l'hôte (cron), ex. tous les jours à 2h30 :
#
#   30 2 * * *  cd /opt/lyko-system && ./deploy/backup-db.sh >> /var/log/lyko-backup.log 2>&1
#
# Restauration :
#   gunzip -c backups/lyko_system-AAAA-MM-JJ_HHMMSS.sql.gz \
#     | docker compose -f compose.prod.yml exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" lyko_system
set -euo pipefail

cd "$(dirname "$0")/.."

# Charge DB_NAME / DB_ROOT_PASSWORD depuis le .env du dépôt.
set -a; . ./.env; set +a

COMPOSE="docker compose -f compose.prod.yml"
OUT_DIR="backups"
STAMP="$(date +%F_%H%M%S)"
DEST="${OUT_DIR}/${DB_NAME}-${STAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$OUT_DIR"

echo "→ Dump ${DB_NAME} → ${DEST}"
$COMPOSE exec -T db \
  mysqldump -u root -p"${DB_ROOT_PASSWORD}" \
  --single-transaction --quick --routines --triggers --events \
  "${DB_NAME}" | gzip -c > "${DEST}"

# Vérifie que le dump n'est pas vide/tronqué.
if [ ! -s "${DEST}" ] || ! gzip -t "${DEST}"; then
  echo "✖ Sauvegarde invalide : ${DEST}" >&2
  rm -f "${DEST}"
  exit 1
fi

echo "→ Rotation (> ${RETENTION_DAYS} j)"
find "$OUT_DIR" -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "✔ OK ($(du -h "${DEST}" | cut -f1))"
