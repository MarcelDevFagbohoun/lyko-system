#!/usr/bin/env bash
# ── Sauvegarde complète d'Africa Immo Management ───────────────────────────────────────
# 1. Dump compressé + horodaté de la base (conteneur `db`).
# 2. Archive des fichiers téléversés (volume `uploads` : cachets, justificatifs, photos…).
# 3. Si BACKUP_PASSPHRASE est défini : chiffrement AES-256 (gpg) de la base, des fichiers
#    et d'une copie du `.env` — plus aucun fichier en clair ne reste dans `backups/`.
# 4. Si BACKUP_REMOTE est défini : envoi HORS SERVEUR via rclone (S3, Backblaze B2,
#    Google Drive, autre VPS en SFTP…) — une sauvegarde qui vit sur le même disque que la
#    base disparaît avec lui (panne, piratage, erreur de manipulation).
# 5. Rotation : 14 jours en local, 90 jours sur le stockage externe (réglables).
#
# À planifier sur l'hôte (cron), ex. tous les jours à 2h30 :
#
#   30 2 * * *  cd /opt/africa-immo && ./deploy/backup-db.sh >> /var/log/africa-immo-backup.log 2>&1
#
# Variables (dans le `.env` à la racine, voir `.env.prod.example`) :
#   BACKUP_PASSPHRASE              phrase secrète de chiffrement — OBLIGATOIRE dès que
#                                  BACKUP_REMOTE est défini (jamais de données de cabinets
#                                  en clair chez un tiers). À conserver AUSSI hors du serveur
#                                  (gestionnaire de mots de passe) : sans elle, les
#                                  sauvegardes sont illisibles — y compris la copie du `.env`.
#   BACKUP_REMOTE                  destination rclone, ex. `b2:africa-immo-backups`
#   BACKUP_RETENTION_DAYS          rotation locale (défaut 14)
#   BACKUP_REMOTE_RETENTION_DAYS   rotation externe (défaut 90)
#
# Vérifier qu'une sauvegarde est réellement restaurable : ./deploy/restore-test.sh
# Restauration réelle : voir docs/DEPLOIEMENT.md, section 4.
set -euo pipefail

cd "$(dirname "$0")/.."

# Charge DB_NAME / DB_ROOT_PASSWORD / BACKUP_* depuis le .env du dépôt.
set -a; . ./.env; set +a

COMPOSE="docker compose -f compose.prod.yml"
OUT_DIR="backups"
STAMP="$(date +%F_%H%M%S)"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
REMOTE_RETENTION_DAYS="${BACKUP_REMOTE_RETENTION_DAYS:-90}"
PASSPHRASE="${BACKUP_PASSPHRASE:-}"
REMOTE="${BACKUP_REMOTE:-}"

fail() { echo "✖ $*" >&2; exit 1; }

if [ -n "$REMOTE" ]; then
  [ -n "$PASSPHRASE" ] || fail "BACKUP_REMOTE est défini sans BACKUP_PASSPHRASE : envoi externe refusé (données en clair)."
  command -v rclone >/dev/null || fail "rclone introuvable (BACKUP_REMOTE est défini) — voir docs/DEPLOIEMENT.md, section 4."
fi
if [ -n "$PASSPHRASE" ]; then
  command -v gpg >/dev/null || fail "gpg introuvable (BACKUP_PASSPHRASE est défini) — apt install gnupg."
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

# Chiffre $1 vers $1.gpg puis supprime l'original. La phrase secrète passe par un descripteur
# de fichier, jamais par la ligne de commande (visible dans `ps`).
encrypt() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 -o "$1.gpg" "$1" 3<<<"$PASSPHRASE"
  rm -f "$1"
}

PRODUCED=()

# ── 1. Base de données ───────────────────────────────────────────────────────
DB_FILE="${OUT_DIR}/${DB_NAME}-${STAMP}.sql.gz"
echo "→ Dump ${DB_NAME} → ${DB_FILE}"
$COMPOSE exec -T db \
  mysqldump -u root -p"${DB_ROOT_PASSWORD}" \
  --single-transaction --quick --routines --triggers --events \
  "${DB_NAME}" | gzip -c > "${DB_FILE}"

# Vérifie que le dump n'est ni vide ni tronqué : mysqldump termine toujours par cette ligne.
if [ ! -s "${DB_FILE}" ] || ! gzip -t "${DB_FILE}" || ! gunzip -c "${DB_FILE}" | tail -n 1 | grep -q 'Dump completed'; then
  rm -f "${DB_FILE}"
  fail "Dump de la base invalide ou incomplet."
fi

# ── 2. Fichiers téléversés ───────────────────────────────────────────────────
UP_FILE="${OUT_DIR}/uploads-${STAMP}.tar.gz"
echo "→ Archive des fichiers téléversés → ${UP_FILE}"
$COMPOSE exec -T api tar czf - -C /app/uploads . > "${UP_FILE}"
if [ ! -s "${UP_FILE}" ] || ! tar tzf "${UP_FILE}" >/dev/null; then
  rm -f "${UP_FILE}"
  fail "Archive des fichiers téléversés invalide."
fi

# ── 3. Chiffrement ───────────────────────────────────────────────────────────
if [ -n "$PASSPHRASE" ]; then
  echo "→ Chiffrement (AES-256)"
  encrypt "${DB_FILE}";  DB_FILE="${DB_FILE}.gpg"
  encrypt "${UP_FILE}";  UP_FILE="${UP_FILE}.gpg"
  # Le `.env` (secrets JWT, clé de chiffrement des clés FedaPay) : sans lui, une base restaurée
  # est inexploitable. Sauvegardé UNIQUEMENT chiffré.
  ENV_FILE="${OUT_DIR}/env-${STAMP}"
  cp .env "${ENV_FILE}"
  encrypt "${ENV_FILE}"; ENV_FILE="${ENV_FILE}.gpg"
  PRODUCED+=("${ENV_FILE}")
else
  echo "⚠ BACKUP_PASSPHRASE non défini : sauvegarde locale EN CLAIR, sans copie du .env."
fi
PRODUCED+=("${DB_FILE}" "${UP_FILE}")
chmod 600 "${PRODUCED[@]}"

# ── 4. Envoi hors serveur ────────────────────────────────────────────────────
if [ -n "$REMOTE" ]; then
  echo "→ Envoi vers ${REMOTE}"
  for f in "${PRODUCED[@]}"; do
    rclone copy "$f" "${REMOTE}" || fail "Envoi externe en échec pour $f — la sauvegarde n'existe QUE sur ce serveur."
  done
  # Contrôle : chaque fichier doit être présent à distance, à la bonne taille.
  for f in "${PRODUCED[@]}"; do
    local_size="$(stat -c %s "$f")"
    remote_size="$(rclone lsf --files-only --format s --include "/$(basename "$f")" "${REMOTE}")"
    [ "$local_size" = "$remote_size" ] || fail "Contrôle externe en échec pour $(basename "$f") (local ${local_size} o, distant ${remote_size:-absent})."
  done
  echo "→ Rotation externe (> ${REMOTE_RETENTION_DAYS} j)"
  rclone delete "${REMOTE}" --min-age "${REMOTE_RETENTION_DAYS}d"
else
  echo "⚠ BACKUP_REMOTE non défini : la sauvegarde reste sur CE serveur uniquement."
fi

# ── 5. Rotation locale ───────────────────────────────────────────────────────
echo "→ Rotation locale (> ${RETENTION_DAYS} j)"
find "$OUT_DIR" -type f \( -name "${DB_NAME}-*.sql.gz*" -o -name "uploads-*.tar.gz*" -o -name "env-*.gpg" \) \
  -mtime "+${RETENTION_DAYS}" -print -delete

echo "✔ OK — base $(du -h "${DB_FILE}" | cut -f1), fichiers $(du -h "${UP_FILE}" | cut -f1)"
