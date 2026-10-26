#!/usr/bin/env bash
# Garde-fou : échoue si un fichier sensible est suivi par git (env réels, clés, dumps, uploads).
# Usage : bash scripts/check-no-secrets.sh   (à lancer avant chaque push, ou en CI)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
bad=$(git ls-files | grep -E '(^|/)\.env($|\.)|\.(pem|key|p12|pfx|jks|sqlite3?|bak|dump)$|\.sql\.gz$|(^|/)uploads/.+|(^|/)backups?(-local)?/' | grep -vE '\.env(\.prod)?\.example$|uploads/\.gitkeep$' || true)
if [ -n "$bad" ]; then echo "Fichiers sensibles suivis par git :"; echo "$bad"; exit 1; fi
hits=$(git ls-files -z | xargs -0 grep -IlE '(sk_live_|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})' 2>/dev/null | grep -v 'check-no-secrets.sh' || true)
if [ -n "$hits" ]; then echo "Secret probable dans :"; echo "$hits"; exit 1; fi
echo "OK : aucun fichier sensible ni secret détecté."
