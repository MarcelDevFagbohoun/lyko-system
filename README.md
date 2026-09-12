# Lyko System

Plateforme web multi-tenant de gestion d'entreprises immobilières / juridiques :
locataires, propriétaires, contrats, paiements, réclamations, comptabilité, charges.

- **Frontend** : Next.js 14 (App Router) + TailwindCSS + PWA
- **Backend** : Node.js / Express + MySQL
- **Auth** : JWT (access court + refresh) et gestion de rôles
- **Charte graphique** : maquette « Cabinet M Conseils » (voir `docs/charte-graphique.md`)

> Développement **étape par étape**. Chaque étape est codée, testée et validée avant la
> suivante — voir `docs/AVANCEMENT.md`.

---

## Prérequis

- Node.js ≥ 20
- Un serveur MySQL 8 (installé localement **ou** via `docker compose`)

## Installation

```bash
# à la racine du dépôt
npm install                 # concurrently (racine)
npm run install:all         # dépendances backend + frontend
```

## Base de données

### Option A — MySQL déjà installé

Créez la base et l'utilisateur applicatif (compte admin requis une seule fois) :

```bash
sudo mysql < backend/scripts/bootstrap-db.sql
#   ou : mysql -u root -p < backend/scripts/bootstrap-db.sql
```

Adaptez le mot de passe dans `backend/scripts/bootstrap-db.sql` **et** dans `backend/.env`.

### Option B — MySQL via Docker

```bash
docker compose up -d db
# backend/.env : DB_HOST=127.0.0.1 DB_USER=lyko DB_PASSWORD=lyko_dev_password DB_NAME=lyko_system
```

### Vérifier la connexion

```bash
npm run db:check
```

## Configuration

```bash
cp backend/.env.example  backend/.env       # secrets JWT, accès MySQL
cp frontend/.env.example frontend/.env.local
```

Générez des secrets JWT forts : `openssl rand -base64 48`.

## Lancer en développement

```bash
npm run dev
# API  : http://localhost:4000  (health : /api/health, /api/health/db)
# Web  : http://localhost:3000
```

## Structure

```
lyko-system/
├── backend/          API Express + MySQL
│   ├── src/
│   │   ├── config/       env, pool MySQL
│   │   ├── middleware/   sécurité (helmet, cors, rate-limit), auth (JWT, rôles, permissions), erreurs
│   │   ├── routes/       /api/health, /api/auth, /api/employees (+ modules ajoutés par étape)
│   │   ├── validators/   schémas Zod (auth, employés)
│   │   ├── services/     session (JWT+refresh), permissions
│   │   ├── constants/    catalogue des permissions par module
│   │   └── db/           runner de migrations + migrations/
│   ├── uploads/          logos d'entreprise (hors version control)
│   └── scripts/          bootstrap-db.sql, check-db.js
├── frontend/         Next.js 14 App Router
│   ├── app/          pages (App Router) — chaque route protégée = page.tsx (metadata) + *-view.tsx (client)
│   ├── components/
│   │   ├── ui/         button, card, badge, input, table, stat-card (charte)
│   │   ├── brand/      logo Lyko par défaut
│   │   ├── system/     indicateur de connexion, service worker
│   │   ├── marketing/  en-tête/pied public, sections de la landing
│   │   ├── auth/       formulaires inscription/connexion/changement de mot de passe, garde de route
│   │   ├── espace/     en-tête de l'espace connecté
│   │   └── employees/  sélecteur de permissions
│   ├── lib/
│   │   ├── auth/      contexte de session (React)
│   │   ├── api/        client fetch, appels /auth et /employees
│   │   └── validation/ miroir des règles du backend (UX temps réel)
│   └── public/       manifest PWA, service worker, offline.html, icônes
└── docs/             charte graphique, suivi d'avancement
```

### Dépannage

Si le frontend renvoie une erreur 500 `Cannot find module './vendor-chunks/...'` après un
`next build`, c'est un cache `.next` corrompu (souvent causé par un `next start` resté actif
pendant un nouveau build) : `rm -rf frontend/.next && npm run build`.

## Scripts utiles

| Commande | Effet |
|---|---|
| `npm run dev` | API + Web en parallèle |
| `npm run build` | build de production du frontend |
| `npm run db:check` | teste la connexion MySQL |
| `npm run db:migrate` | applique les migrations SQL en attente |
| `npm run lint` | ESLint (frontend) |
