# Déploiement — Lyko System (VPS + Docker Compose)

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

`deploy/backup-db.sh` : dump `mysqldump --single-transaction` compressé dans `backups/`,
rotation 14 jours. À planifier sur l'hôte :

```cron
30 2 * * *  cd /opt/lyko-system && ./deploy/backup-db.sh >> /var/log/lyko-backup.log 2>&1
```

Sauvegarder aussi le volume **`uploads`** (logos, cachets, signatures) et le fichier
**`.env`** (hors dépôt) — par ex. `docker run --rm -v lyko-system_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads-$(date +%F).tgz -C /u .`

**Restauration** :

```bash
gunzip -c backups/lyko_system-AAAA-MM-JJ_HHMMSS.sql.gz \
  | docker compose -f compose.prod.yml exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" lyko_system
```

## 5. Exploitation

| Besoin | Commande |
|---|---|
| État des services | `docker compose -f compose.prod.yml ps` |
| Logs (accès HTTP inclus, format JSON en prod) | `docker compose -f compose.prod.yml logs -f api` |
| État des migrations | `docker compose -f compose.prod.yml exec api node src/db/migrate.js status` |
| Console MySQL | `docker compose -f compose.prod.yml exec db mysql -u lyko -p lyko_system` |
| Redémarrer le proxy | `docker compose -f compose.prod.yml restart caddy` |
| Arrêt complet | `docker compose -f compose.prod.yml down` (garde les volumes) |

## 6. Sécurité — rappels (voir aussi `AVANCEMENT.md` § Étape 12a)

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

## 7. Dépannage

| Symptôme | Piste |
|---|---|
| Caddy boucle sur l'obtention du certificat | DNS pas encore propagé, ou port 80 fermé/pris. `dig +short app.mondomaine.tld` doit renvoyer l'IP du VPS. |
| `api` redémarre en boucle | Voir `logs api` : secret JWT < 32 car., `db` pas prête, ou migration en échec. |
| Front chargé mais appels API en erreur réseau/CORS | `PUBLIC_API_URL` ≠ `API_DOMAIN`, ou `web` pas rebuild après changement. `CORS_ORIGIN` (= `PUBLIC_APP_URL`) doit être exactement l'origine du front. |
| Logos/cachets cassés (403/CORP) | Vérifier que l'API répond bien sur `API_DOMAIN` et que `Cross-Origin-Resource-Policy: cross-origin` est présent sur `/uploads/...`. |
| 502 sur un domaine | Le conteneur cible n'est pas *healthy* : `docker compose -f compose.prod.yml ps`. |
