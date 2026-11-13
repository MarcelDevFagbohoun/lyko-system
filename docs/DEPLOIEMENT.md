# Déploiement — Africa Immo Management (VPS + Docker Compose)

Pile : **Caddy** (HTTPS auto) → **web** (Next.js 15, standalone) + **api** (Express) → **db** (MySQL 8).
Seul Caddy est exposé (80/443). `db` et `api` ne sont joignables que sur les réseaux Docker internes.

```
Internet ──443──▶ caddy ──▶ web:3000   (app.mondomaine.tld)
                        └─▶ api:4000   (api.mondomaine.tld)
                                 └──▶ db:3306  (réseau interne, non exposé)
Volumes : db_data · uploads · caddy_data · caddy_config
```

---

## 1. Prérequis sur le VPS

- Docker Engine + plugin Compose v2 (`docker compose version` ≥ 2.20).
- Deux enregistrements DNS **A** (et **AAAA** si IPv6) pointant sur l'IP du VPS :
  - `app.mondomaine.tld`
  - `api.mondomaine.tld`
- Ports **80** et **443** ouverts (Let's Encrypt valide via HTTP-01 sur le 80).
- ~2 Go RAM (MySQL + 2 process Node). Disque : prévoir la croissance de `db_data` + `uploads` + `backups`.

## 2. Première installation

```bash
git clone <dépôt> /opt/lyko-system
cd /opt/lyko-system

cp .env.prod.example .env
```

Éditer `.env` :

| Variable | Valeur |
|---|---|
| `APP_DOMAIN`, `API_DOMAIN` | les deux sous-domaines (sans `https://`) |
| `ACME_EMAIL` | e-mail pour Let's Encrypt (avis d'expiration) |
| `PUBLIC_APP_URL`, `PUBLIC_API_URL` | `https://` + les domaines ci-dessus |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | `openssl rand -base64 24` chacun |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48` chacun, **distincts** |

```bash
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml logs -f caddy   # suivre l'obtention du certificat
```

Au premier `up` :
- `db` s'initialise (utilisateur applicatif `lyko` avec `ALL PRIVILEGES` **sur la seule base `lyko_system`** — aucun privilège global, moindre privilège respecté).
- `api` attend que `db` soit *healthy*, **joue les migrations** (`docker-entrypoint.sh` → `node src/db/migrate.js up`), puis démarre.
- `caddy` obtient les certificats TLS (quelques secondes une fois le DNS propagé).

Vérifs :

```bash
curl -fsS https://api.mondomaine.tld/api/health        # {"status":"ok",...}
curl -fsS https://api.mondomaine.tld/api/health/db     # {"status":"ok",...}
curl -fsSI https://app.mondomaine.tld | grep -i strict-transport-security
```

Puis ouvrir `https://app.mondomaine.tld` et créer le premier compte entreprise (inscription DG).

> **Test des certificats sans épuiser le quota Let's Encrypt** : décommenter la ligne
> `acme_ca …staging…` dans `deploy/Caddyfile`, `up -d`, vérifier, recommenter, puis
> `docker compose -f compose.prod.yml restart caddy` (supprimer le volume `caddy_data`
> si un certificat staging a été émis).

## 3. Mises à jour

```bash
cd /opt/lyko-system
git pull
./deploy/backup-db.sh                                   # sauvegarde avant migration
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d                # recrée uniquement ce qui a changé
docker compose -f compose.prod.yml logs -f api          # vérifier les migrations
```

- Les **migrations SQL** sont rejouées automatiquement au redémarrage de `api` (idempotent
  via la table `_migrations`).
- Si `PUBLIC_API_URL` change, le rebuild de `web` est **obligatoire** (valeur figée dans le
  bundle client) — `up -d` seul ne suffit pas.

## 4. Sauvegardes

`deploy/backup-db.sh` fait une sauvegarde **complète** : dump `mysqldump --single-transaction`
de la base, archive des fichiers téléversés (volume `uploads`), puis — selon le `.env` —
chiffrement et envoi **hors du serveur**. Une sauvegarde qui reste sur le même disque que la
base disparaît avec lui (panne, piratage, erreur de manipulation).

### Mise en place (une fois)

1. **Phrase secrète** : `openssl rand -base64 32` → `BACKUP_PASSPHRASE=` dans le `.env`
   (sans espace). **La noter aussi hors du serveur** (gestionnaire de mots de passe, papier
   au coffre) : sans elle les sauvegardes sont illisibles, y compris la copie du `.env`.
2. **Stockage externe** : `sudo apt install rclone gnupg`, puis `rclone config` pour créer
   une destination (Backblaze B2, S3, Google Drive, autre serveur en SFTP…). Renseigner
   `BACKUP_REMOTE=nom:dossier` — un dossier **dédié** aux sauvegardes (la rotation y supprime
   tout fichier de plus de 90 jours).
3. **Planifier** sur l'hôte :

```cron
30 2 * * *  cd /opt/africa-immo && ./deploy/backup-db.sh >> /var/log/africa-immo-backup.log 2>&1
0 4 * * 0   cd /opt/africa-immo && ./deploy/restore-test.sh >> /var/log/africa-immo-restore-test.log 2>&1
```

Sans `BACKUP_PASSPHRASE`, la sauvegarde reste locale et en clair (comportement d'origine) ;
`BACKUP_REMOTE` sans `BACKUP_PASSPHRASE` est refusé. Rotation : 14 jours en local, 90 jours
à distance (`BACKUP_RETENTION_DAYS`, `BACKUP_REMOTE_RETENTION_DAYS`).

### Vérifier qu'une sauvegarde est restaurable

`deploy/restore-test.sh` restaure la dernière sauvegarde dans une base jetable
(`<DB_NAME>_restore_test`, jamais la production), compare tables et lignes à la production,
relit l'archive des fichiers, puis supprime la base jetable. Code de sortie non nul = la
sauvegarde n'est pas fiable. À lancer à la main après la mise en place, puis chaque semaine.

### Restauration réelle

```bash
# Récupérer les fichiers si le serveur est perdu : rclone copy nom:dossier backups/
# Base (retirer l'étape gpg si la sauvegarde n'est pas chiffrée) :
gpg --decrypt backups/lyko_system-AAAA-MM-JJ_HHMMSS.sql.gz.gpg | gunzip -c \
  | docker compose -f compose.prod.yml exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" lyko_system
# Fichiers téléversés :
gpg --decrypt backups/uploads-AAAA-MM-JJ_HHMMSS.tar.gz.gpg \
  | docker compose -f compose.prod.yml exec -T api tar xzf - -C /app/uploads
# .env (serveur neuf) :
gpg --decrypt backups/env-AAAA-MM-JJ_HHMMSS.gpg > .env
```

## 5. Suivi des erreurs et disponibilité

Les erreurs serveur (500), les tâches planifiées en échec et les écrans qui plantent chez les
utilisateurs sont enregistrés et affichés dans le **back-office, onglet « Erreurs »**, regroupés
par erreur distincte. Une alerte e-mail part vers `PLATFORM_ADMIN_EMAIL` à chaque erreur
**nouvelle** (ou qui revient après avoir été marquée « Corrigé »).

Limite : si le serveur entier ou la base est hors service, rien ne peut être enregistré ni
envoyé depuis celui-ci. Ajouter une **sonde externe** gratuite (UptimeRobot, Better Stack…)
sur `https://<API_DOMAIN>/api/health`, avec alerte e-mail/SMS, pour être prévenu d'une panne totale.

## 6. Exploitation

| Besoin | Commande |
|---|---|
| État des services | `docker compose -f compose.prod.yml ps` |
| Logs (accès HTTP inclus, format JSON en prod) | `docker compose -f compose.prod.yml logs -f api` |
| État des migrations | `docker compose -f compose.prod.yml exec api node src/db/migrate.js status` |
| Console MySQL | `docker compose -f compose.prod.yml exec db mysql -u lyko -p lyko_system` |
| Redémarrer le proxy | `docker compose -f compose.prod.yml restart caddy` |
| Arrêt complet | `docker compose -f compose.prod.yml down` (garde les volumes) |

## 7. Sécurité — rappels (voir aussi `AVANCEMENT.md` § Étape 12a)

- **Pare-feu hôte** : n'ouvrir que 22 (SSH, idéalement filtré), 80, 443. `db` et `api`
  n'ont **pas** de `ports:` — inutile de les exposer.
- **`.env`** : `chmod 600 .env`, jamais dans Git (déjà couvert par `.gitignore`).
- **HTTPS forcé** : Caddy redirige 80→443 ; HSTS (2 ans, preload) posé par l'appli *et* le proxy.
- **En-têtes** : CSP (prod), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` — émis par
  l'appli ; Caddy retire l'en-tête `Server`.
- **`/_next/image`** renvoyé en 404 par Caddy (l'appli n'utilise pas l'optimiseur d'images).
- **Rotation des secrets JWT** : changer `JWT_*` dans `.env` puis `up -d api` invalide toutes
  les sessions en cours (déconnexion générale) — à faire en cas de fuite suspectée.
- **Mises à jour d'image** : `docker compose -f compose.prod.yml pull && up -d` régulièrement
  pour `mysql:8.0` et `caddy:2-alpine` ; rebuild pour les correctifs Node/déps applicatives.

## 8. Dépannage

| Symptôme | Piste |
|---|---|
| Caddy boucle sur l'obtention du certificat | DNS pas encore propagé, ou port 80 fermé/pris. `dig +short app.mondomaine.tld` doit renvoyer l'IP du VPS. |
| `api` redémarre en boucle | Voir `logs api` : secret JWT < 32 car., `db` pas prête, ou migration en échec. |
| Front chargé mais appels API en erreur réseau/CORS | `PUBLIC_API_URL` ≠ `API_DOMAIN`, ou `web` pas rebuild après changement. `CORS_ORIGIN` (= `PUBLIC_APP_URL`) doit être exactement l'origine du front. |
| Logos/cachets cassés (403/CORP) | Vérifier que l'API répond bien sur `API_DOMAIN` et que `Cross-Origin-Resource-Policy: cross-origin` est présent sur `/uploads/...`. |
| 502 sur un domaine | Le conteneur cible n'est pas *healthy* : `docker compose -f compose.prod.yml ps`. |

## Vérifications de compatibilité (avant mise en production)

- **MySQL 8.0** : la suite de tests complète (651 tests) passe sur MySQL 8.0 réel et sur MariaDB 10.11. MySQL 8 est plus strict (`ONLY_FULL_GROUP_BY`, dates impossibles refusées) : les filtres de dates côté API sont normalisés (`clampIsoDate`), et le front utilise `monthEnd()` pour les fins de mois.
- **Envoi de photos** : Caddy accepte jusqu'à 25 Mo par requête sur l'API (photos d'états des lieux).
- **Logo des PDF** : le dossier `backend/assets` est inclus dans l'image de l'API.
- Le build du front (`next build`) télécharge la police Inter depuis Google Fonts : il nécessite un accès Internet (normal sur le VPS).

## Adresse secrète du back-office

Par défaut le back-office est à `/admin`. En production, définissez `ADMIN_PATH` dans `.env` (ex. `ADMIN_PATH=gestion-3f9a1c7e2b4d`, généré avec `openssl rand -hex 8`) : il n'est alors joignable qu'à `https://<APP_DOMAIN>/gestion-3f9a1c7e2b4d`, et `/admin` répond « page introuvable ». Changer l'adresse demande seulement `docker compose -f compose.prod.yml up -d web` (pas de rebuild).
C'est une discrétion en plus, pas une protection : le mot de passe et la double authentification (TOTP) du back-office restent obligatoires.
