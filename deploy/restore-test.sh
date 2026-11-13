#!/usr/bin/env bash
# ── Test de restauration ───────────────────────────────────────────────────────────────
# Une sauvegarde jamais restaurée n'est qu'une supposition. Ce script prend la sauvegarde
# de base la plus récente de `backups/` (ou celle passée en argument), la déchiffre si
# besoin, la restaure dans une base JETABLE (`<DB_NAME>_restore_test`, sur le même serveur
# MySQL — la base de production n'est JAMAIS touchée), compare son contenu à la production,
# vérifie l'archive des fichiers téléversés, puis supprime la base jetable.
#
#   ./deploy/restore-test.sh                                  # dernière sauvegarde
#   ./deploy/restore-test.sh backups/lyko_system-….sql.gz.gpg # une sauvegarde précise
#
# À planifier chaque semaine, après la sauvegarde de la nuit (ex. dimanche 4h) :
#
#   0 4 * * 0  cd /opt/africa-immo && ./deploy/restore-test.sh >> /var/log/africa-immo-restore-test.log 2>&1
#
# Code de sortie non nul = la sauvegarde testée n'est PAS fiable.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

COMPOSE="docker compose -f compose.prod.yml"
OUT_DIR="backups"
SCRATCH_DB="${DB_NAME}_restore_test"
PASSPHRASE="${BACKUP_PASSPHRASE:-}"

fail() { echo "✖ $*" >&2; exit 1; }
sql() { $COMPOSE exec -T db mysql -u root -p"${DB_ROOT_PASSWORD}" -N -B "$@"; }

# Lit $1 en clair sur la sortie standard (déchiffre si `.gpg`).
plain() {
  case "$1" in
    *.gpg)
      [ -n "$PASSPHRASE" ] || fail "Sauvegarde chiffrée mais BACKUP_PASSPHRASE absent du .env."
      gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3<<<"$PASSPHRASE"
      ;;
    *) cat "$1" ;;
  esac
}

DB_FILE="${1:-$(ls -1t "${OUT_DIR}/${DB_NAME}"-*.sql.gz* 2>/dev/null | head -n 1 || true)}"
[ -n "$DB_FILE" ] && [ -f "$DB_FILE" ] || fail "Aucune sauvegarde de base trouvée dans ${OUT_DIR}/."
echo "→ Sauvegarde testée : ${DB_FILE} ($(du -h "$DB_FILE" | cut -f1))"

cleanup() { sql -e "DROP DATABASE IF EXISTS \`${SCRATCH_DB}\`" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ Restauration dans la base jetable ${SCRATCH_DB}"
sql -e "DROP DATABASE IF EXISTS \`${SCRATCH_DB}\`; CREATE DATABASE \`${SCRATCH_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
plain "$DB_FILE" | gunzip -c | sql "${SCRATCH_DB}" || fail "La restauration a échoué : cette sauvegarde est inutilisable."

count_tables() { sql -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$1' AND table_type = 'BASE TABLE'"; }
count_rows() { sql -e "SELECT COUNT(*) FROM \`$1\`.\`$2\`"; }

prod_tables="$(count_tables "${DB_NAME}")"
rest_tables="$(count_tables "${SCRATCH_DB}")"
echo "→ Tables : ${rest_tables} restaurées / ${prod_tables} en production"
[ "$rest_tables" -gt 0 ] || fail "Aucune table restaurée."
# Une migration appliquée APRÈS la sauvegarde peut légitimement ajouter des tables en production ;
# l'inverse (plus de tables dans la sauvegarde) ou un écart important signale un problème.
[ "$rest_tables" -le "$prod_tables" ] || fail "Plus de tables dans la sauvegarde qu'en production."
[ $((prod_tables - rest_tables)) -le 5 ] || fail "Trop de tables manquantes dans la sauvegarde (${rest_tables}/${prod_tables})."

# Tables métier essentielles : présentes, et peuplées dès que la production l'est. Le nombre de
# lignes restauré peut être légèrement inférieur (activité depuis la sauvegarde), jamais nul.
for t in _migrations tenants users leases rent_payments; do
  prod_rows="$(count_rows "${DB_NAME}" "$t")"
  rest_rows="$(count_rows "${SCRATCH_DB}" "$t")" || fail "Table ${t} absente de la sauvegarde."
  echo "   ${t} : ${rest_rows} lignes restaurées / ${prod_rows} en production"
  if [ "$prod_rows" -gt 0 ] && [ "$rest_rows" -eq 0 ]; then
    fail "Table ${t} vide dans la sauvegarde alors qu'elle contient ${prod_rows} lignes en production."
  fi
done

# Archive des fichiers téléversés du même horodatage (si elle existe) : lisible de bout en bout.
STAMP="$(basename "$DB_FILE" | sed -E "s/^${DB_NAME}-(.+)\.sql\.gz(\.gpg)?$/\1/")"
UP_FILE="$(ls -1 "${OUT_DIR}/uploads-${STAMP}".tar.gz* 2>/dev/null | head -n 1 || true)"
if [ -n "$UP_FILE" ]; then
  files="$(plain "$UP_FILE" | tar tzf - | wc -l)" || fail "Archive des fichiers téléversés illisible : ${UP_FILE}"
  echo "→ Fichiers téléversés : archive lisible (${files} entrées)"
else
  echo "⚠ Aucune archive de fichiers téléversés pour cette sauvegarde (${STAMP})."
fi

echo "✔ Sauvegarde restaurable : ${DB_FILE}"
