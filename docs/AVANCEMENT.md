# Suivi d'avancement — Lyko System

Règle : chaque étape est **codée → testée → validée** avant la suivante.
On ne fusionne jamais deux étapes.

| # | Étape | État |
|---|---|---|
| 0 | Socle technique | 🟢 Validé (2026-09-08) |
| 1 | Page de présentation (landing) | 🟢 Validée |
| 2 | Inscription & authentification | 🟢 Validée |
| 3 | Gestion des employés & rôles | 🟢 Validée |
| 4 | Module Gestion des locataires | 🟢 Validée |
| 5 | Module Gestion des propriétaires | 🟢 Validée |
| 6 | Module Sorties de locataires | 🟢 Validée |
| 7 | Module Plaintes & réclamations | 🟢 Validée |
| 8 | Module Comptabilité & finances | 🟢 Validée |
| 9 | Module Charges & redevances (SONEB/SBEE) | 🟢 Validée |
| 10 | Fonctionnalités transversales | 🟢 Validée |
| 11 | Mode hors-ligne (lecture + file d'écriture limitée) | 🟢 Validée (2026-09-10, navigateur) |
| 12a | Sécurité & audit (durcissement) | 🟡 Codé — validation navigateur/build en attente |
| 12b | Déploiement (VPS + Docker Compose) | 🟡 Codé — build/déploiement à valider sur le VPS |
| 13 | Fonctionnalités additionnelles (post-lancement) | 🟡 En cours — portails locataire/propriétaire, alertes prédictives et carte du portefeuille validés, autres idées non démarrées |
| 14 | Attribution de Biens à un agent (portefeuille restreint) | 🟢 Validée |
| 15 | État des lieux par zones (refonte) | 🟢 Validée |
| 16 | Toutes les opérations datées | 🟢 Validée |
| 17 | Retour immédiat sur chaque action (toasts) | 🟢 Validée |
| 18 | Outils comptables/agents (tâches, rapport, historique) | 🟢 Validée |
| 19 | Refonte design professionnel des documents PDF | 🟢 Validée |
| 20 | Marketplace des Unités vacantes (back-office) | 🟢 Validée |
| 21 | Quick Immo — site externe (vitrine, comptes, demandes) | 🟢 Validée |

---

## Étape 0 — Socle technique

**Objectif** : initialiser le projet (Next.js + Express + MySQL), configuration PWA de base,
charte graphique (composants réutilisables, thème Tailwind), configuration JWT.

**Critère de validation** : le projet démarre, page stylée selon la charte, connexion MySQL fonctionnelle.

### Livré

- Monorepo `backend/` + `frontend/` + scripts racine (`npm run dev`, `db:check`, `db:migrate`).
- **Backend Express** : sécurité (helmet, CORS whitelist, rate-limit), pool MySQL (`mysql2`),
  routes `/api/health` et `/api/health/db`, gestion d'erreurs centralisée, logger, arrêt gracieux.
- **Config JWT** : `src/utils/jwt.js` (access + refresh, secrets par `.env`, refus des secrets faibles en prod).
  Les routes d'authentification arrivent à l'étape 2.
- **Runner de migrations** SQL sans dépendance (`npm run db:migrate` / `:status`) + `bootstrap-db.sql`.
- **Frontend Next.js 14** : thème Tailwind = charte complète, polices Geist + Inter,
  composants `ui/` (Button, Card, Badge, Input/Field, Table, StatCard), logo Lyko par défaut,
  indicateur de connexion permanent (en ligne / hors-ligne), page-socle de diagnostic.
- **PWA de base** : `manifest.webmanifest`, `sw.js` (precache du shell + offline.html,
  network-first navigations, SWR assets), enregistrement en production.
- En-têtes de sécurité HTTP côté Next (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).

### Tests effectués

- [x] `npm install` + `npm run install:all` sans erreur
- [x] `node src/server.js` démarre l'API ; `GET /api/health` → 200
- [x] `npm run db:check` → connexion MySQL OK (base `lyko_system`, utilisateur dédié `lyko`, MySQL 8.0.46, latence ~1-49 ms)
- [x] `npm run db:migrate` → crée `_migrations`, aucune erreur
- [x] `GET /api/health/db` → 200, `{ ok: true, serverVersion, database, latencyMs }`
- [x] `npm --prefix frontend run build` → succès, 5 pages prérendues, polices Geist/Inter auto-hébergées (woff2 dans le build, donc disponibles hors-ligne)
- [x] `npm --prefix frontend run lint` → aucune erreur
- [x] `next start` (build prod) : `GET /` → 200, en-têtes sécurité présents (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`)
- [x] `/manifest.webmanifest` → 200 `application/manifest+json` ; `/sw.js` → 200, `Cache-Control: no-cache`, `Service-Worker-Allowed: /`
- [x] Page-socle : palette, typo, boutons, badges de statut, StatCard, tableau conformes à la charte ; indicateur de connexion réactif à `navigator.onLine`
- [ ] Capture d'écran visuelle — non réalisable dans cet environnement (téléchargement du navigateur headless bloqué par le réseau) ; à vérifier visuellement via `npm run dev` → http://localhost:3000

### Provisionnement effectué

`backend/scripts/bootstrap-db.sql` exécuté par le DG via `sudo mysql` : base `lyko_system` (utf8mb4) +
utilisateur applicatif dédié `lyko` (ni root, ni superutilisateur), conforme au principe du moindre privilège.

### Hors périmètre (étapes ultérieures)

Authentification, multi-tenant, modules métier, notifications WhatsApp, file de sync hors-ligne.

---

## Étape 1 — Page de présentation (landing page)

**Objectif** : landing page publique complète (section 4.1) — objectif de Lyko System,
fonctionnalités principales, boutons « Créer mon compte » / « Se connecter ».

**Critère de validation** : page accessible sans connexion, responsive, boutons fonctionnels
vers inscription/connexion.

### Livré

- `app/page.tsx` : landing publique (Hero, 6 modules, « Comment ça marche », sécurité
  multi-entreprise, bandeau CTA) construite avec `components/marketing/` (`SiteHeader`,
  `SiteFooter`, `Hero`, `FeatureGrid`, `HowItWorks`, `SecurityBand`, `CtaBanner`).
- En-tête public responsive : navigation par ancres en desktop, menu hamburger en mobile
  (`SiteHeader`, composant client), CTA « Se connecter » / « Créer mon compte » toujours visibles.
- `app/inscription/` et `app/connexion/` : points d'entrée réels (200, pas de lien mort) —
  contenu minimal « arrive à l'étape 2 » pour ne pas anticiper les formulaires métier.
- L'ancienne page de diagnostic de l'étape 0 déplacée vers `app/diagnostics/` (outil interne,
  non lié depuis la navigation publique).
- Aperçu produit dans le hero construit avec les vrais composants `ui/` (StatCard, Badge, Card) —
  pas de capture d'écran fictive.

### Tests effectués

- [x] `npm run lint` → aucune erreur
- [x] `npm run build` → 4 routes prérendues (`/`, `/inscription`, `/connexion`, `/diagnostics`)
- [x] `next start` (prod) : `GET /`, `/inscription`, `/connexion`, `/diagnostics` → 200
- [x] Titres de page corrects par route (`<title>… · Lyko System</title>`)
- [x] Liens CTA vérifiés dans le HTML rendu : 5× `/inscription`, 4× `/connexion`
  (en-tête desktop, en-tête mobile, hero, bandeau CTA, pied de page) — aucun lien mort
- [x] Classes responsives présentes (`sm:grid-cols-2`, `lg:grid-cols-3`, `md:flex` / `hidden` pour le menu mobile)
- [x] Meta viewport correcte (`width=device-width, initial-scale=1`)
- [ ] Vérification visuelle multi-largeurs — non réalisable dans cet environnement (téléchargement
  du navigateur headless bloqué par le réseau) ; à confirmer via `npm run dev` sur un vrai navigateur

### Hors périmètre (étapes ultérieures)

Logique des formulaires d'inscription/connexion, création de tenant, session JWT (étape 2).

---

## Étape 2 — Inscription & authentification

**Objectif** : formulaire d'inscription entreprise (section 4.2), création automatique de
l'espace/tenant (section 4.3), connexion, déconnexion, session JWT, redirection avec logo.

**Critère de validation** : un utilisateur peut s'inscrire, se déconnecter, se reconnecter,
et retrouve son espace avec son logo.

### Schéma de données (`001_auth_core.sql`)

- `tenants` (company_name, rccm, ifu, contact_phone, logo_path)
- `users` (tenant_id → tenants, first_name, last_name, phone unique, email unique nullable,
  password_hash, role enum `dg|comptable|agent`, par défaut `dg` à l'inscription)
- `refresh_tokens` (user_id → users, token_hash sha256, expires_at, revoked_at) — rotation et révocation

### Backend

- Validateurs Zod (`validators/auth.js`) : téléphone béninois (10 chiffres, normalisation
  +229/00229/229), RCCM (`RB/XXX/AA L 1234`), IFU (13 chiffres), mot de passe (10+ car.,
  maj./min./chiffre/spécial), confirmation de mot de passe.
- `POST /api/auth/register` (multipart, upload logo PNG/JPEG/WEBP 2 Mo max via `multer`,
  mémoire → écrit sur disque après création du tenant) : transaction tenant+user, émission
  de session, cookie refresh httpOnly.
- `POST /api/auth/login`, `POST /api/auth/refresh` (rotation + détection de réutilisation),
  `POST /api/auth/logout` (révocation), `GET /api/auth/me` (restauration de session).
- `middleware/auth.js` (`requireAuth`) : vérifie l'access token Bearer.
- Limiteur dédié sur `/register` et `/login` (20 req/15 min) en plus du limiteur global.
- Fichiers servis statiquement sous `/uploads` (répertoire hors version control).
- Correctif : le runner de migrations de l'étape 0 traitait un fichier commençant par un
  commentaire d'en-tête comme entièrement commenté (première instruction perdue) — corrigé
  dans `db/migrate.js` avant d'exécuter la première vraie migration.

### Frontend

- `lib/auth/auth-context.tsx` : contexte React (access token en mémoire, jamais localStorage ;
  restauration de session via `/refresh` + `/me` au chargement).
- `components/auth/require-auth.tsx` : garde de route côté client (redirige vers `/connexion`).
- `app/inscription` : formulaire complet (section 4.2) avec validation en temps réel
  (RCCM/IFU/téléphone au blur, indicateur de force du mot de passe, correspondance de la
  confirmation en direct), upload de logo avec aperçu.
- `app/connexion` : formulaire numéro + mot de passe.
- `app/espace` : espace protégé — logo de l'entreprise (ou logo Lyko par défaut), nom de l'entreprise,
  rôle, déconnexion, état vide avec guide de démarrage (« Ajouter mon premier employé »
  étape 3, « Ajouter mon premier bien/locataire » étape 4 — non fonctionnels, correctement
  étiquetés comme à venir).

### Tests effectués (backend, bout en bout contre la vraie base MySQL)

- [x] Mot de passe faible → 400 · RCCM invalide → 400 · mots de passe différents → 400 ·
  IFU invalide → 400 · téléphone invalide → 400
- [x] Inscription valide + logo → 201, tenant+user créés en transaction, cookie
  `lyko_refresh` posé (HttpOnly, SameSite=Lax, Path=/api/auth, 7 j)
- [x] Logo servi statiquement (`/uploads/tenants/<id>/logo.png` → 200 image/png)
- [x] Même numéro déjà utilisé → 409
- [x] Connexion mot de passe incorrect → 401 (message générique, pas de fuite d'existence)
- [x] Connexion correcte → 200
- [x] `GET /me` sans token → 401 ; avec token → 200 (tenant + logoUrl inclus)
- [x] `POST /refresh` → rotation (nouveau token ≠ ancien) ; réutilisation de l'ancien
  refresh token révoqué → 401 (détection de rejeu)
- [x] `POST /logout` → 204, cookie effacé ; refresh suivant → 401 « Session absente »
- [x] CORS avec `Origin: http://localhost:3000` : préflight OPTIONS OK, credentials OK sur
  tout le cycle (register/login/me), caractères accentués (« Aïcha ») préservés (utf8mb4)
- [x] `npm run lint` et `npm run build` (frontend) → OK, 6 routes prérendues
- [x] Bundles JS construits référencent bien les 5 endpoints `/api/auth/*`

### Non vérifié dans cet environnement

- Interaction réelle au clavier/souris dans le navigateur (pas de navigateur headless
  disponible ici) — le contrat API est testé de bout en bout, mais l'ergonomie du formulaire
  (validation en temps réel, aperçu du logo) est à confirmer visuellement via `npm run dev`.

### Dette technique notée pour l'étape 12 (audit sécurité)

- Vulnérabilité modérée transitive `qs` (via la branche 4.x d'Express) — correctif nécessite
  une montée de version majeure d'Express, à traiter lors de l'audit de sécurité.
- CSRF : mitigation actuelle = cookie `SameSite=Lax` + CORS à origine explicite + scope de
  cookie restreint à `/api/auth`. Un jeton CSRF explicite pourra être ajouté à l'étape 12 si
  le modèle de menace le justifie.

### Hors périmètre (étapes ultérieures)

Création de comptes employés, permissions par rôle, changement de mot de passe obligatoire
à la première connexion (étape 3).

---

## Étape 3 — Gestion des employés & rôles

**Objectif** : écran « Gestion des employés », création/modification/désactivation de comptes,
attribution des rôles et permissions, changement de mot de passe obligatoire à la première
connexion (section 5).

**Critère de validation** : le DG crée un compte agent et un compte comptable, chacun ne voit
que ce qui lui est autorisé.

### Schéma de données (`002_employees.sql`)

- `users` : + `must_change_password` (forcé à 1 à la création par le DG), + `status`
  (`active`/`disabled`).
- `user_permissions` (user_id, permission_key) : accès par module, ajustables par le DG.
  Le DG lui-même n'y figure jamais — son accès total vient uniquement de `role = 'dg'`.

### Catalogue de permissions (`constants/permissions.js`)

`locataires`, `proprietaires`, `etats_des_lieux`, `plaintes`, `comptabilite`, `charges`,
`documents_juridiques` — la plupart de ces modules arrivent aux étapes 4+ ; assigner une
permission aujourd'hui prépare simplement les accès de l'employé. Défauts pré-cochés par
rôle : agent → locataires/plaintes/états des lieux ; comptable → comptabilité/charges.

### Backend

- `middleware/auth.js` : `requireRole(...)` (contrôle par rôle) et `requirePermission(key)`
  (contrôle par module, DG toujours autorisé) — cette dernière est prête pour les routeurs
  métier à partir de l'étape 4 (aucune route ne l'utilise encore, aucun module n'existe).
- `POST /api/employees` : mot de passe temporaire saisi par le DG ou généré automatiquement
  (12 caractères, sans caractères ambigus 0/O/1/l/I), `must_change_password=1`.
- `GET /api/employees`, `GET /:id`, `PATCH /:id`, `DELETE /:id` — toutes isolées par
  `tenant_id` ; le DG ne peut ni modifier ni supprimer son propre compte via cet écran.
- Désactiver un employé (`status=disabled`) révoque immédiatement ses refresh tokens en
  cours ; la connexion d'un compte désactivé est bloquée (403).
- `POST /api/auth/change-password` : vérifie le mot de passe actuel, remet
  `must_change_password` à 0. Sert à la fois au changement obligatoire et à un usage
  auto-service futur.
- `mustChangePassword` porté dans le payload JWT (access + refresh) pour rester disponible
  même après un rafraîchissement de session.

### Frontend

- `RequireAuth` étendu : redirige vers `/changer-mot-de-passe` tant que
  `mustChangePassword` est vrai (avant tout autre contenu protégé) ; accepte `roles` pour
  un accès refusé explicite (« Vous n'avez pas accès à cette page ») plutôt qu'une
  redirection silencieuse.
- `app/espace/employes` : liste (tableau, badges de statut/permissions) — visible uniquement
  par le DG (`RequireAuth roles={["dg"]}`), 403 explicite pour agent/comptable.
- `app/espace/employes/nouveau` : création avec sélecteur de permissions pré-rempli selon
  le rôle ; le mot de passe temporaire généré est affiché **une seule fois** avec bouton copier.
- `app/espace/employes/[id]` : modification (identité, rôle, statut, permissions),
  suppression avec confirmation à deux temps.
- `app/changer-mot-de-passe` : formulaire dédié, volontairement hors de `RequireAuth`
  (éviterait une boucle de redirection tant que le flag est vrai).
- `/espace` : la carte « Ajouter mon premier employé » devient un lien fonctionnel vers
  l'écran réel (au lieu d'un badge « à venir ») ; un employé non-DG voit désormais ses
  propres accès listés.
- Chaque route protégée refactorée en `page.tsx` (métadonnées serveur) + `*-view.tsx`
  (logique cliente), même pattern que inscription/connexion (étape 2).

### Tests effectués (backend, bout en bout contre la vraie base MySQL — 24 scénarios)

- [x] Inscription DG puis catalogue de permissions accessible (DG uniquement, 401 sans auth)
- [x] Création d'un agent (mot de passe généré) et d'un comptable (mot de passe fourni),
  permissions par défaut correctement appliquées selon le rôle
- [x] Connexion de l'agent avec le mot de passe temporaire → `mustChangePassword: true`,
  permissions renvoyées
- [x] Agent bloqué sur `/api/employees` → 403 (réservé DG)
- [x] Changement de mot de passe par l'agent → 204 ; ancien mot de passe rejeté (401) ;
  nouveau mot de passe accepté avec `mustChangePassword: false`
- [x] Doublon téléphone → 409 ; tentative de créer un rôle `dg` via cet écran → 400
- [x] DG ne peut pas modifier/désactiver son propre compte via `/api/employees` → 400
- [x] Modification des permissions + désactivation d'un employé → 200 ; connexion ensuite
  bloquée → 403
- [x] **Isolation multi-tenant** : une deuxième entreprise inscrite ne peut ni lire (`GET /:id`),
  ni modifier, ni supprimer l'employé d'une autre entreprise → 404 partout ; sa propre liste
  reste vide
- [x] Suppression réelle d'un employé → 204, absent de la liste ensuite
- [x] `GET /:id` avec identifiant non numérique → 400 ; permission hors catalogue → 400
- [x] `npm run lint` / `npm run build` (frontend) → OK, 9 routes construites
- [x] Bundles JS construits référencent bien `/api/employees`, `/api/employees/permissions`
  et `/api/auth/change-password`
- [x] Titres de page dédiés vérifiés sur les 9 routes (`curl` + build de production)

### Non vérifié dans cet environnement

- Interaction réelle au clavier/souris dans le navigateur (toujours pas de navigateur
  headless disponible) — contrat API et rendu HTML vérifiés de bout en bout ; ergonomie
  des formulaires (sélecteur de permissions, panneau de mot de passe temporaire) à
  confirmer visuellement via `npm run dev`.

### Hors périmètre (étapes ultérieures)

Modules métier eux-mêmes (locataires, propriétaires, comptabilité…) — seules les
permissions qui y donneront accès existent pour l'instant. Journal d'activité détaillé des
actions de gestion des employés (mentionné en section 5) : les créations/modifications sont
déjà journalisées via le logger applicatif, mais l'écran de journal d'activité dédié est
prévu à l'étape 10.

### Ajustement — double porte de connexion + identifiant unique

Sur retour, le flux de connexion a été revu :

- **Identifiant unique** : `users.identifier` (ex. `7F3K-9QXM`, alphabet sans caractères
  ambigus), généré automatiquement à la création d'un employé — plus de saisie manuelle du
  mot de passe par le DG, tout est généré serveur (migration `003_employee_identifier.sql`).
- **Deux portes de connexion** sur `/connexion` (onglets) :
  - **Direction** (`POST /api/auth/login`) : numéro de téléphone + mot de passe, réservé au
    rôle `dg` (un compte employé qui essaie cette porte est explicitement redirigé vers
    « Connexion employé »).
  - **Employé** (`POST /api/auth/login-employee`) : identifiant + poste (sélecteur fermé
    Agent/Comptable, donc toujours conforme) + mot de passe ; le poste choisi doit
    correspondre au rôle réel du compte, sinon message générique (n'indique pas laquelle
    des trois informations est fautive).
- **Envoi immédiat des identifiants** : à la création d'un employé, un panneau affiche
  l'identifiant et le mot de passe temporaire (une seule fois) avec des boutons « Envoyer
  par WhatsApp » (lien `wa.me` pré-rempli vers le numéro de contact) et « Envoyer par
  email » (`mailto:` si un email a été renseigné).

Tests (contre le serveur de dev déjà actif, sans purger les données de l'utilisateur) :
- [x] Création d'employé → réponse contient toujours `identifier` + `temporaryPassword`
- [x] Porte Direction avec le téléphone d'un compte employé → 401 (message de redirection)
- [x] Porte Employé avec le mauvais poste → 401 (message générique)
- [x] Porte Employé avec le bon identifiant/poste/mot de passe → 200, session valide
- [x] Porte Direction avec le DG → 200, `role: "dg"`
- [x] `npm run lint` / `npm run build` → OK, 9 routes
- [x] Vérifié en direct sur le serveur de dev de l'utilisateur (nodemon a rechargé le
  backend automatiquement) : `/connexion` affiche bien les deux onglets « Direction » /
  « Employé »

### Bug UX trouvé et corrigé — carte « Gestion des employés » visible par un comptable

Signalé par l'utilisateur : un comptable connecté voyait sur son tableau de bord
(`/espace`) une carte « Gestion des employés » (grisée, non cliquable), alors que ce module
est réservé au DG. Le backend était déjà correctement verrouillé
(`requireRole('dg')` sur tout `routes/employees.js`) — c'était un bug d'affichage seul :
`app/espace/espace-view.tsx` remplaçait la carte « Ajouter mon premier employé » par une
carte de substitution nommant explicitement la fonctionnalité (« Réservée à la direction
générale ») au lieu de ne rien afficher, contrairement à tous les autres points d'entrée
DG-only de l'application (`espace-header.tsx` : les liens « Employés » et « Paramètres »
utilisent `isDg && (...)`, donc disparaissent entièrement plutôt que d'apparaître grisés).
Corrigé en appliquant le même principe : rien n'est affiché à la place, jamais un nom de
fonctionnalité révélé à un rôle qui n'y a pas droit.
Testé en navigateur (Firefox headless, cabinet jetable, compte comptable réel créé et
connecté) : carte absente, aucun vide dans la grille, la carte « Enregistrer un paiement »
(module réellement autorisé) s'affiche normalement à sa place. `tsc`/`lint` propres.

---

## Étape 4 — Module Gestion des locataires

**Objectif** : fiche locataire, registre de paiement, suivi, quittances, lettres, relances,
états des lieux, caution, historique des contrats.

**Critère de validation** : cycle complet testable — créer un locataire, enregistrer un
paiement, générer une quittance, relancer un locataire en retard.

### Schéma de données (`004_renters.sql`)

Nommage anglais (`renters`/`leases`/`properties`) pour ne jamais entrer en collision avec
`tenants` (les entreprises clientes de la plateforme, sans rapport avec les locataires).

- `properties` (biens) : désignation, adresse, type, loyer, statut occupé/vacant. Créés
  en même temps qu'un locataire ou qu'un renouvellement de bail — pas d'écran « Biens »
  séparé pour l'instant (arrive avec les propriétaires à l'étape 5).
- `renters` (locataires) : identité, contact, profession, notes.
- `leases` (baux) : loyer, caution (montant + statut conservée/restituée), jour d'échéance,
  dates, statut actif/terminé. Un locataire peut avoir plusieurs baux (historique).
- `rent_payments` (paiements) : mois couvert, montant, mode, date, saisi par.
- `receipts` (quittances) : une par paiement, numérotée `QT-{année}-{séquence}`.
- `move_in_reports` (états des lieux d'entrée) : checklist JSON (9 postes standards),
  notes générales — un seul par bail. *(Refondu en zones/éléments personnalisables +
  brouillon/signatures à l'étape 15 — la grille plate à 9 postes ci-dessous ne décrit plus
  le comportement actuel, gardée comme trace historique.)*

### Backend

- `services/rentTracking.js` : calcule le mois payé jusqu'à, la prochaine échéance et le
  retard en jours à partir de la date de début du bail et des paiements enregistrés.
- `services/pdf.js` (`pdfkit`) : quittance de loyer et attestation de loyer (« lettre »),
  avec logo de l'entreprise si présent. **Bug corrigé pendant les tests** : le séparateur
  de milliers de `toLocaleString('fr-FR')` (espace fine insécable, U+202F) n'est pas géré
  par la police PDF standard Helvetica et s'affichait comme un artefact — remplacé par un
  formatage manuel en espace ASCII normale.
- `routes/renters.js` : liste (avec bail actif + statut de retard), fiche complète
  (baux + paiements + quittances + état des lieux), création (locataire + bien + bail en
  une transaction), modification, nouveau bail (renouvellement → historique des contrats),
  attestation de loyer PDF.
- `routes/leases.js` : fin de bail (libère le bien), registre des paiements, enregistrement
  d'un paiement (génère la quittance dans la même transaction), PDF de quittance, état des
  lieux d'entrée (lecture/création, un seul par bail).
- Permissions distinctes exercées pour la première fois : `locataires` (tout sauf l'état
  des lieux) et `etats_des_lieux` (spécifiquement les routes `/move-in-report`) — valide
  concrètement l'infrastructure `requirePermission` posée à l'étape 3.
- Isolation stricte par `tenant_id` sur toutes les tables (properties/renters/leases/
  rent_payments/receipts/move_in_reports portent chacune `tenant_id`, pas seulement via
  jointure).

### Frontend

- `lib/api/renters.ts`, `lib/constants/inspection.ts`.
- `RequireAuth` étendu avec une prop `permission` (en plus de `roles`) : accès refusé si
  l'utilisateur n'a ni le rôle DG ni la permission requise.
- `openAuthenticatedPdf` (`lib/api/client.ts`) : récupère un PDF protégé par Bearer token
  et l'ouvre dans un nouvel onglet (un `<a href>` ne peut pas porter l'en-tête Authorization).
- `/espace/locataires` : liste avec badge de statut (à jour / en retard Xj).
- `/espace/locataires/nouveau` : création locataire + bien + bail en un formulaire.
- `/espace/locataires/[id]` : fiche complète — bail actif (loyer, caution, échéance),
  bouton **Relancer sur WhatsApp** (actif uniquement si en retard, message pré-rempli),
  bouton **Attestation de loyer**, registre des paiements avec formulaire d'enregistrement
  et liens vers les quittances PDF, historique des contrats, accès à l'état des lieux,
  fin de bail avec confirmation.
- `/espace/locataires/[id]/etat-des-lieux` : formulaire checklist (9 postes, bon/moyen/
  mauvais + commentaire) ou consultation en lecture seule si déjà réalisé.
- `/espace` : la carte « Ajouter mon premier bien/locataire » devient un lien fonctionnel.

### Tests effectués (backend, bout en bout contre la vraie base — 23 scénarios)

- [x] Création locataire + bien + bail en une transaction → 201
- [x] Fiche complète : bail actif, retard calculé correctement (95 j sans paiement depuis
  juin, vérifié à la main)
- [x] Enregistrement d'un paiement → quittance générée automatiquement (`QT-2026-0001`),
  échéance suivante recalculée (juillet après paiement de juin)
- [x] **PDF quittance et attestation de loyer** : générés (200, `application/pdf`), relus
  et inspectés visuellement — bugs « Bien loué undefined » et montant mal formaté détectés
  puis corrigés, PDF régénérés et revérifiés propres
- [x] État des lieux d'entrée : création → 201 ; doublon sur le même bail → 409
- [x] Nouveau bail (renouvellement) pour un locataire existant → historique de 2 baux ;
  fin du premier bail → bien repasse « vacant », second bail actif
- [x] **Permissions granulaires** : employé sans `locataires` → 403 sur `/api/renters` ;
  employé avec `locataires` mais sans `etats_des_lieux` → 200 sur les locataires, 403 sur
  l'état des lieux
- [x] **Isolation multi-tenant** : une entreprise tierce ne peut lire/modifier ni le
  locataire, ni le bail, ni encaisser un paiement, ni récupérer la quittance d'une autre
  entreprise → 404 partout ; sa propre liste reste vide
- [x] Validations : mois au mauvais format, montant négatif, loyer à 0 → 400
- [x] `npm run lint` et `npx tsc --noEmit` (sans toucher `.next`, serveur de dev de
  l'utilisateur laissé intact) → OK
- [x] Les 4 nouvelles routes compilent et répondent 200 sur le serveur de dev déjà actif
  de l'utilisateur
- [x] Données de test nettoyées après coup (tenants de test uniquement — aucune donnée de
  l'utilisateur touchée, vérifié avant et après)

### Non vérifié dans cet environnement

Interaction réelle clavier/souris dans le navigateur (formulaire de paiement, sélection des
conditions d'état des lieux, ouverture des PDF dans un nouvel onglet) — à confirmer via
`npm run dev`, déjà actif côté utilisateur.

### Hors périmètre (étapes ultérieures)

Sélection d'un bien existant à la création d'un bail (toujours créé nouveau pour l'instant) ;
retour de caution et checklist de sortie complète (étape 6) ; lettres formelles au-delà de
l'attestation de loyer (mise en demeure automatisée liée aux relances viendra avec les
notifications automatiques de l'étape 10) ; gestion des propriétaires (étape 5, qui viendra
compléter `properties` avec un `owner_id`).

### Ajustement — menu Paramètres : contrat personnalisé, cachet, signature

Sur retour, ajout d'un menu **Paramètres** (DG uniquement, icône ⚙ dans l'en-tête de
l'espace) pour personnaliser l'attestation de loyer :

- **Migration `005_tenant_settings.sql`** : `tenants.contract_template` (texte), `stamp_path`,
  `signature_path`.
- **Modèle de contrat** : texte libre avec placeholders (`{{locataire}}`, `{{bien}}`,
  `{{loyer}}`, `{{date_entree}}`, `{{entreprise}}`, `{{rccm}}`, `{{ifu}}`, `{{signataire}}`,
  `{{date}}`) — même moteur de substitution (`constants/contract.js`) que le modèle par
  défaut intégré, donc un seul chemin de code. Champ vide = réinitialisation au modèle
  par défaut.
- **Cachet et signature** : upload PNG/JPEG/WEBP (2 Mo max), stockés sous
  `uploads/tenants/<id>/` comme le logo. Apposés automatiquement sur le PDF généré
  (signature ~130×45 px près de « Pour le cabinet, », cachet ~90×90 px en surimpression
  légère à 90 % d'opacité) — repli sur la ligne à signer vierge si aucune signature.
- **Date toujours automatique** : `{{date}}` et la ligne « Fait à Cotonou, le… » utilisent
  systématiquement la date du jour de génération ; aucun champ de date manuel nulle part.
- Écran `/espace/parametres` : textarea + catalogue de placeholders, aperçu du cachet/de la
  signature actuels, remplacement par upload.
- `GET/PATCH /api/settings` : réservés au DG (`requireRole('dg')`), comme la gestion des
  employés.

**Tests** (contre la vraie base, données de test nettoyées ensuite) :
- [x] Paramètres par défaut d'un nouveau cabinet → `contractTemplate: null`, URLs `null`
- [x] Employé (non DG) → 403 sur `GET /api/settings`
- [x] Upload cachet + signature + modèle personnalisé → 200 ; PDF attestation régénéré et
  **inspecté visuellement** : texte personnalisé rendu, signature et cachet correctement
  positionnés, date toujours automatique
- [x] Modèle trop long (>4000 car.) → 400 ; fichier non-image pour le cachet → 400
- [x] **Isolation** : un deuxième cabinet obtient des paramètres vides (pas de fuite du
  modèle/cachet/signature du premier)
- [x] `npm run lint` et `npx tsc --noEmit` → OK ; route `/espace/parametres` vérifiée à 200
  sur le serveur de dev déjà actif de l'utilisateur

### Ajustement demandé après validation — vrai contrat rejeté « invalide » (2026-09-12)

L'utilisateur a rédigé un vrai contrat de bail complet (11 articles) et l'a collé dans le
champ. Enregistrement refusé avec un simple « Formulaire invalide », sans dire pourquoi.
Deux bugs distincts trouvés en creusant :

1. **Texte trop long** : la limite de 4000 caractères (pensée pour le court paragraphe du
   modèle par défaut) est bien trop basse pour un contrat complet à plusieurs articles — le
   texte de l'utilisateur faisait 4340 caractères. Relevée à 20 000 (`validators/settings.js`),
   large marge pour n'importe quel contrat rédigé à la main ; la colonne `tenants.contract_template`
   est un `TEXT` (jusqu'à 65 535 caractères), aucune migration nécessaire.
2. **Placeholders en MAJUSCULES ignorés silencieusement** : l'utilisateur avait écrit
   `{{RCCM}}`, `{{LOCATAIRE}}`, `{{SIGNATAIRE}}`, `{{TELEPHONE}}`, `{{DATE_ENTREE}}`,
   `{{LOYER}}` (au lieu de `{{rccm}}`, `{{locataire}}`… en minuscules) — la substitution
   (`constants/contract.js`) est sensible à la casse : ces jetons seraient restés vides sur
   l'attestation générée, sans erreur ni avertissement. Rendue insensible à la casse.
3. **Message d'erreur inexploitable** : `app/espace/parametres/parametres-view.tsx`
   n'affichait que le message générique de l'API (« Formulaire invalide »), jamais le détail
   du champ concerné (`err.details`) — corrigé : affiche maintenant le détail précis quand il
   existe (ex. « Trop long (20 000 caractères max) »).
- Ajouté un compteur de caractères en direct sous le champ (rouge au-delà de la limite) pour
  voir le problème avant même d'enregistrer, et agrandi la zone de saisie (7 → 18 lignes,
  police à chasse fixe) pour un contrat de cette longueur.
- Testé avec le contrat réel de l'utilisateur sur le tenant réel KIko Store : enregistrement
  → 200, attestation régénérée pour un vrai bail (Pélagie ZINSOU) → PDF de 3 pages, tous les
  placeholders (y compris ceux en majuscules) correctement remplis, signature/cachet/pied de
  page bien positionnés en fin de document. `tsc --noEmit`/`next lint` propres.
- Signalé à l'utilisateur (pas corrigé automatiquement, c'est son texte) : son article 3 écrit
  « {{LOYER}} francs CFA », or `{{loyer}}` est déjà rendu avec le suffixe (« 160 000 FCFA ») —
  ça donne « 160 000 FCFA francs CFA » à la génération ; à corriger dans son propre texte en
  retirant « francs CFA » après le placeholder.

### Ajustement demandé après validation — cachet trop petit sur l'attestation (2026-09-12)

`services/pdf.js` (`streamCertificatePdf`) : cachet agrandi de 90×90 à 140×140 px (repositionné
en conséquence, `x: 200` au lieu de 210, `signY - 15` au lieu de `signY - 10`, pour rester bien
aligné avec la signature sans la chevaucher). Seul endroit du code où le cachet est dessiné
(les quittances, le PV de sortie et le relevé propriétaire n'en affichent pas). Revérifié sur
le vrai contrat de l'utilisateur (KIko Store, Pélagie ZINSOU) : cachet nettement plus visible,
toujours bien positionné, aucun chevauchement avec le pied de page.

### Ajustement demandé après validation — le même souci de format pour N'IMPORTE QUELLE entreprise (2026-09-12)

Question de l'utilisateur, après avoir confirmé que le cachet notarial était juste une image
de test : et si une AUTRE entreprise cliente veut un jour rédiger son propre contrat, elle va
retomber sur la même erreur de format ? La limite de 20 000 caractères posée juste avant
restait un plafond arbitraire, pas une vraie garantie que ça ne se reproduirait jamais.

- **Migration `024_contract_template_mediumtext.sql`** : `tenants.contract_template` passe de
  `TEXT` (64 Ko max, la vraie contrainte technique qui aurait fini par resurgir) à
  `MEDIUMTEXT` (16 Mo) — la limite applicative reste la seule qui compte désormais.
- `validators/settings.js` : plafond relevé à 50 000 caractères (large marge au-delà de
  n'importe quel contrat de bail réaliste), message d'erreur mis à jour ; compteur de
  caractères du frontend (`parametres-view.tsx`) aligné sur la même valeur.
- Testé sur cabinet jetable : un contrat de 48 462 caractères (placeholders en casse variée,
  guillemets français, tiret moyen, ligature « œ ») enregistré (200) puis utilisé pour générer
  une vraie attestation → PDF de 16 pages, tous les placeholders correctement remplis ; un
  contrat de 76 162 caractères refusé proprement avec un message clair (« Trop long (50 000
  caractères max) ») plutôt qu'une erreur générique. Cabinet de test supprimé après coup ;
  contrat réel de KIko Store (4 595 caractères) vérifié intact.

### Bug trouvé et corrigé — caractère « Ð » parasite après chaque ligne du contrat (2026-09-12)

L'utilisateur a collé le texte de son attestation générée : un « Ð » apparaissait après
littéralement chaque ligne du contrat. Cause : son texte, collé depuis Word ou tapé sous
Windows, contenait des fins de ligne `\r\n` (confirmé en base : 84 occurrences dans son
`contract_template` réel) — **PDFKit ne traite pas `\r` comme un simple retour à la ligne**,
il le dessine comme un glyphe visible, rendu « Ð » avec les polices standard (Helvetica).

- `services/pdf.js` : nouvelle fonction `normalizeLineBreaks()` (`\r\n`/`\r` isolé → `\n`),
  appliquée à tout texte libre saisi par un utilisateur et rendu dans un PDF : le corps du
  contrat (`streamCertificatePdf`), les commentaires par poste et les notes générales du PV de
  sortie (`streamMoveOutPdf`) — les seuls autres champs multi-lignes issus d'une saisie libre
  rendus en PDF dans ce fichier.
- `validators/settings.js` : `contractTemplate` normalisé aussi à l'enregistrement (même
  remplacement), pour que la valeur stockée soit déjà propre, pas seulement corrigée à
  l'affichage.
- Le contrat déjà enregistré de KIko Store (84 `\r\n`) corrigé directement en base par la même
  normalisation, puis l'attestation régénérée et vérifiée : plus aucun « Ð » dans le texte
  extrait du PDF.

### Ajustement demandé après validation — valeurs substituées en gras sur l'attestation (2026-09-12)

- `constants/contract.js` : nouvelle `renderContractTemplateSegments()`, miroir de
  `renderContractTemplate` mais renvoyant une liste de segments `{ text, bold }` (texte fixe
  vs. valeur substituée) plutôt qu'une chaîne à plat.
- `services/pdf.js` : nouvelle fonction `drawRichText()` — enchaîne les segments avec l'API
  « continued » de PDFKit (gras pour les valeurs, normal pour le texte juridique autour), en
  les découpant d'abord par ligne. Nécessaire car PDFKit ne repositionne PAS correctement un
  retour à la ligne EXPLICITE (`\n`) à l'intérieur d'un enchaînement « continued » (le texte
  qui suit hérite du décalage horizontal du segment précédent au lieu de revenir à la marge)
  — seul le retour à la ligne automatique (mot trop long) s'y positionne bien. Bug trouvé en
  testant : les paragraphes qui suivaient une valeur en gras se retrouvaient fortement
  décalés vers la droite ; corrigé en refermant l'enchaînement à chaque ligne du texte
  source, qui repart alors bien de la marge de gauche.
- **Second bug trouvé au même endroit** : le bloc « Fait à…/Pour le cabinet/signature/cachet »
  pouvait se couper entre deux pages (signature sur une page, cachet loin en dessous sur la
  suivante) si peu de place restait en bas de la page — pas causé par le gras en soi, mais
  révélé par le léger changement de gabarit du texte (le gras est plus large). Corrigé en
  forçant une nouvelle page à l'avance dès qu'il ne reste pas assez de place pour tout le
  bloc signature d'un coup (`SIGNATURE_BLOCK_HEIGHT`).
- Testé sur le vrai contrat de KIko Store (valeurs bien en gras, paragraphes bien alignés à
  la marge, bloc signature/cachet regroupé) et sur un contrat synthétique de 15 articles à
  fort retour à la ligne automatique + placeholders répétés (tenant jetable) : toujours
  aligné correctement, aucun « Ð », PDF généré avec succès. Cabinet de test supprimé après
  coup.

### Ajustement — refonte Bien / Unité locative

Sur retour détaillé, le modèle « bien » de l'étape 4 a été restructuré en deux entités
distinctes, plus fidèle à la réalité du terrain (un immeuble R+1 = plusieurs appartements
distincts avec chacun son statut et ses compteurs).

- **Migration `006_property_units.sql`** : nouvelle table `property_units` (l'Unité louée) ;
  `properties` devient le **Bien** (bâtiment) avec `code` auto (`BIEN-001`), `owner_name`
  (obligatoire), `owner_phone`, `address`, `property_type` (villa/duplex/immeuble/maison
  simple/autre), `levels`, `photo_paths`. **Les données déjà saisies ont été converties, pas
  effacées** : chaque Bien existant devient un Bien + une Unité unique reprenant loyer,
  statut et libellé (sauvegarde `mysqldump` prise avant migration par précaution).
  Un premier essai de la migration a échoué (syntaxe MySQL 8 refusée pour l'affectation de
  plusieurs variables dans `UPDATE...SET`) — DDL déjà exécuté annulé manuellement (MySQL ne
  révoque pas les DDL au ROLLBACK), migration corrigée avec `ROW_NUMBER() OVER (...)`, puis
  rejouée avec succès.
- **Unités locatives** : désignation standardisée (Studio, Chambre salon, Chambre salon +
  sanitaire + cuisine, Appartement 2 ch., Appartement 3 ch., Autre + champ libre), statut
  Libre/Loué/Réservé, loyer propre, compteurs SONEB/SBEE, meublé. Code auto
  (`BIEN-001-U01`, `-U02`…). Le statut « Loué » ne peut être forcé manuellement sans bail
  actif (400) ; « Réservé »/« Libre » restent ajustables librement par le DG.
- **Workflow de location revu** : `POST /api/renters` prend désormais un `unitId` (unité
  libre existante) au lieu de créer un bien à la volée ; à la validation, l'unité passe
  automatiquement à « Loué » (et repasse « Libre » à la fin du bail). Tentative de louer une
  unité déjà occupée → 409.
- **Recherche/autocomplétion** : `GET /api/properties?q=` (nom du propriétaire ou code).
- **Nouveau menu « Nos biens »** : `/espace/biens` (liste + recherche), `/espace/biens/nouveau`
  (création avec jusqu'à 5 photos), `/espace/biens/:id` (fiche + tableau des unités +
  ajout d'unité). `/espace/locataires/nouveau` utilise désormais un sélecteur Bien → Unité
  (`PropertyUnitPicker`) au lieu de champs de bien saisis à la volée.
- Navigation ajoutée dans l'en-tête de l'espace (Biens/Locataires/Employés) — nécessaire
  maintenant que plusieurs modules coexistent.
- **Bug PDF corrigé en cours de route** : le libellé du bien loué passant sur 2 lignes
  chevauchait la ligne suivante sur la quittance (espacement fixe) — `drawRow()` calcule
  désormais la hauteur réelle du texte et avance en conséquence.

**Tests** (19 scénarios bout en bout, données de test nettoyées ensuite) :
- [x] Création d'un Bien (villa, +photo) + 2 unités → codes `BIEN-001`, `-U01`, `-U02`
- [x] Autocomplétion par nom de propriétaire et par code → résultats corrects
- [x] Création de locataire via sélection d'unité → unité passe à « loué » automatiquement
- [x] Re-location de la même unité déjà louée → 409
- [x] Paiement + quittance + attestation régénérés avec la nouvelle structure imbriquée
  (`lease.unit.property`) → PDF inspectés visuellement, corrects
- [x] Fin de bail → unité repasse « libre »
- [x] Isolation multi-tenant sur `/api/properties` (404 + liste vide pour un tiers)
- [x] Validations : bien sans propriétaire → 400 ; désignation « autre » sans champ libre →
  400 ; statut « loué » forcé sans bail → 400 ; statut « réservé » → 200 (autorisé)
- [x] **Données réelles de l'utilisateur (tenant `KIko Store`) vérifiées intactes et bien
  structurées après migration** — `owner_name` placé à « Propriétaire à renseigner » en
  attente de saisie par le DG sur la fiche du bien `BIEN-001`
- [x] `npm run lint` et `npx tsc --noEmit` → OK ; toutes les nouvelles routes vérifiées à 200
  sur le serveur de dev déjà actif de l'utilisateur

### Hors périmètre (encore)

Sélecteur de bien existant pour un renouvellement de bail depuis la fiche locataire (le
bouton n'est pas encore câblé côté UI, seul l'endpoint backend existe) ; suppression/retrait
de photos déjà téléversées ; entité Propriétaire formelle avec relevés et historique de
versements (étape 5, qui viendra remplacer `owner_name`/`owner_phone` par une vraie relation).

### Ajustement — libérer une unité quand le locataire part

Nouvelle action explicite pour notifier qu'une unité redevient disponible, accessible
directement depuis la fiche du bien (pas besoin de retrouver le locataire) :

- `POST /api/properties/:id/units/:unitId/release` : termine le bail actif de l'unité s'il y
  en a un (statut → terminé, date de fin = aujourd'hui) puis remet l'unité à « Libre ». Une
  unité déjà libre → 400. Isolation par tenant vérifiée (404 pour un autre cabinet).
- `/espace/biens/:id` : bouton « Locataire parti — libérer » sur chaque unité non libre
  (confirmation à deux temps), avec bannière de confirmation « L'unité BIEN-001-U01 est
  maintenant libre. » après l'action.
- `/espace/locataires/:id` : le bouton « Terminer le bail » est reformulé en « Locataire
  parti — libérer l'unité » et affiche désormais la même confirmation explicite une fois le
  bail terminé (au lieu de disparaître silencieusement).

**Tests** : libérer une unité déjà libre → 400 ; cycle complet (louer → vérifier « loué » →
libérer depuis la fiche du bien → bail terminé + unité « libre » + locataire actuel effacé)
→ tout correct ; isolation multi-tenant → 404. Lint et types OK, routes vérifiées sur le
serveur de dev déjà actif de l'utilisateur.

### Ajustement — rendre agent et comptable réellement fonctionnels

Constat : le comptable (permissions par défaut `comptabilite`/`charges`) n'avait accès à
**aucun** écran fonctionnel, ces modules n'existant pas encore (étapes 8/9). Le cahier des
charges précise pourtant explicitement (section 5) que le comptable doit avoir accès aux
« paiements, factures ». Correction sans anticiper la Comptabilité complète :

- `middleware/auth.js` : nouveau `requireAnyPermission(...)` (accès dès qu'une des
  permissions listées est présente ; DG toujours autorisé).
- `routes/renters.js` : lecture (liste + fiche) ouverte à `locataires` **ou**
  `comptabilite` ; création/modification/nouveau bail restent réservées à `locataires`.
- `routes/leases.js` : paiements + quittances (`GET/POST /payments`, `receipt.pdf`) ouverts
  à `locataires` **ou** `comptabilite` ; fin de bail et état des lieux restent
  `locataires`/`etats_des_lieux` uniquement.
- `RequireAuth` (frontend) accepte désormais `permission` sous forme de tableau (accès dès
  qu'une des permissions correspond).
- `/espace/locataires` et `/espace/locataires/:id` accessibles au comptable ; actions
  réservées à l'agent/DG masquées pour un comptable pur (créer/modifier un locataire,
  relance WhatsApp, attestation, état des lieux, fin de bail) — seul le **registre des
  paiements** (enregistrer + télécharger les quittances) reste visible et fonctionnel pour
  les deux.
- En-tête et page d'accueil : lien « Locataires » et carte « Enregistrer un paiement »
  visibles pour le comptable.

**Tests** (16 scénarios, comptes agent/comptable réels avec changement de mot de passe) :
- [x] **Agent** : liste locataires/biens, création de locataire, unité, état des lieux,
  paiement → tous 201/200 ; accès employés → 403
- [x] **Comptable** : liste et fiche locataire → 200 ; enregistrement de paiement → 201 ;
  téléchargement de quittance → 200 (PDF valide) ; création de locataire, gestion des biens,
  fin de bail, état des lieux, employés → 403 partout (bien restreint à sa mission)
- [x] `npm run lint` / `npx tsc --noEmit` → OK ; routes vérifiées sur le serveur de dev de
  l'utilisateur

### Ajustement — attestation de loyer ouverte au comptable + confirmation agent

- `GET /api/renters/:id/certificate.pdf` ouvert à `locataires` **ou** `comptabilite`
  (document financier). Testé : comptable → 200, PDF valide.
- **Audit complet du rôle agent** (10 scénarios, cycle réel de bout en bout) après les
  ajustements de permissions du comptable, pour vérifier l'absence de régression : création
  de bien, ajout d'unité, fiche du bien, création de locataire, état des lieux, paiement,
  quittance, attestation, calcul de retard (34 j vérifié à la main), libération d'unité →
  tout à 201/200. Accès employés/paramètres toujours bloqué (403). Toutes les routes
  frontend concernées vérifiées à 200 sur le serveur de dev de l'utilisateur.

### Correctif final — attribuer une nouvelle unité à un locataire sans bail actif

Remonté par l'utilisateur sur ses vraies données (« Kiko Store ») : deux locataires
libérés (fonctionnalité précédente) affichaient bien « Sans bail actif », mais **aucun
moyen dans l'interface** ne permettait de leur attribuer une nouvelle unité — cul-de-sac
pour le comptable comme pour l'agent. La route backend `POST /api/renters/:id/leases`
existait déjà (étape 4) mais n'était jamais appelée depuis le front.

- Ajout de `NewLeaseCard` sur la fiche locataire (`locataire-view.tsx`) : visible quand il
  n'y a pas de bail actif et que l'utilisateur a la permission `locataires` — même
  sélecteur Bien → Unité que la création, avec loyer/caution/échéance/date d'entrée.
- Vérifié en lecture seule sur les vraies données du tenant avant toute conclusion (aucune
  donnée modifiée) : les deux baux étaient bien `status='ended'` en base, confirmant que
  l'interface reflétait fidèlement la BDD — le vrai bug était l'absence de suite possible,
  pas un défaut d'affichage.

### Ajustement demandé après validation — paiement multi-mois automatique (2026-09-10)

Sur retour de l'utilisateur (« si le loyer est 5 000 et qu'il donne 15 000, on doit savoir
qu'il a payé 3 mois et les 3 paiements sont créés »). Le formulaire ne prenait qu'un mois
à la fois.

- **Backend** (`services/rentTracking.js` → `allocateRentPayment`, `routes/leases.js` POST
  `/payments`) : le montant peut dépasser un mois de loyer. Le serveur le **répartit sur des
  mois consécutifs** à partir du prochain mois dû — autant de mois complets que possible,
  puis le **reste en paiement partiel** sur le mois suivant (décision produit : « mois
  entiers + reste en partiel »). **Une écriture + une quittance `QT-…` par mois**, le tout
  dans une seule transaction. `coversMonth` devient facultatif (mois de départ auto).
  Garde anti-doublon revue : rejet 409 si un enregistrement récent (< 2 min, même bail,
  même date, même mode) cumule **exactement** le même montant (double-clic) — un montant
  différent le même jour reste permis.
- **Frontend** (`lib/utils.ts` → `previewRentAllocation`/`monthLabelFr`, `lib/api/renters.ts`,
  `PaymentRegister` dans `locataire-view.tsx`) : champ « Mois concerné » supprimé (auto).
  Aperçu en direct sous le montant : « 3 mois : avril, mai, juin 2026 — 3 quittances » ou
  « 2 mois complets + 30 000 FCFA d'avance sur… ». Après enregistrement, bandeau
  « N paiements enregistrés — N quittances générées ». Retour multi-mois propagé à la file
  hors-ligne (corps sans `coversMonth`).
- **Tests** (API, sur les vrais baux KIko Store) : 85 000 pour un loyer de 85 000 → 1 mois
  (inchangé) ; 30 000 → 1 paiement partiel ; 255 000 → 3 mois (3 quittances consécutives) ;
  180 000 puis 90 000 sur un loyer de 60 000 → 3 mois puis 1 mois + 30 000 partiel ;
  double-envoi identique < 2 min → 409, rien créé. Parcours navigateur : aperçu correct,
  bandeau et 3 lignes de quittances affichés, prochaine échéance recalculée. `tsc`/`lint`
  frontend OK.
- **Reste connu** (limite préexistante, non aggravée) : un mois avec un paiement partiel est
  considéré « couvert » par le calcul de retard (basé sur la présence d'une ligne, pas sur
  la somme) — le prochain mois dû saute au mois suivant. Le complément d'un partiel se fait
  donc en ciblant ce mois manuellement (hors périmètre de cet ajustement).

### Remise à zéro comptable KIko Store (2026-09-10)

À la demande de l'utilisateur (blocages accidentels) : périodes `2026-09` et `2026-04`
**dé-clôturées** (`DELETE FROM accounting_periods`), `accounting_start_date` **retirée**
(`NULL`). La clôture reste disponible dans l'appli mais n'est jamais obligatoire : les mois
avancent seuls, on saisit à n'importe quelle date réelle. Sauvegarde `mysqldump` prise avant
toute écriture.

---

## Étape 5 — Module Gestion des propriétaires

**Objectif** : le propriétaire devient une fiche à part entière (au lieu d'un texte libre
porté par le Bien), avec son patrimoine géré et l'historique des versements du cabinet
vers lui. Périmètre réduit par rapport à la maquette Stitch (mandat de gérance, RIB,
taux de commission, rapprochement bancaire) : validé explicitement avec l'utilisateur —
MVP fiche + versements manuels, sans mandat ni intégration bancaire.

**Critère de validation** : un propriétaire peut être créé (seul ou à la volée pendant la
création d'un Bien), consulté avec son patrimoine et ses locataires en place, et recevoir
un versement dont l'historique alimente un relevé PDF généré à la demande.

### Schéma de données (`007_owners.sql`, `008_owners_fk_fix.sql`)

- `owners` (tenant_id, name, phone, email, address, notes) — remplace les colonnes texte
  `owner_name`/`owner_phone` de `properties` (migration de reprise : un propriétaire par
  couple (tenant, nom, téléphone) distinct, sans perte de données).
- `properties.owner_id` (FK vers `owners`, `ON DELETE CASCADE`) remplace les deux colonnes texte.
- `owner_payouts` (tenant_id, owner_id, amount, period_label, paid_at, payment_method,
  notes, recorded_by) — versements saisis manuellement, pas de génération automatique
  depuis les loyers encaissés (hors périmètre MVP).
- Correctif `008` : `fk_properties_owner` n'avait pas `ON DELETE CASCADE` à sa création,
  ce qui aurait bloqué la suppression d'un tenant (les suppressions en cascade de
  `properties` et `owners` depuis `tenants` se font en parallèle ; sans CASCADE sur
  `owner_id`, MySQL refuse de supprimer un `owner` encore référencé). Détecté en testant
  le nettoyage d'un tenant jetable, corrigé avant tout usage réel.

### Backend

- `validators/owners.js`, `routes/owners.js` monté sur `/api/owners` :
  `GET /` (répertoire, recherche par nom), `GET /:id` (fiche + biens/unités + versements),
  `POST /`, `PATCH /:id`, `POST /:id/payouts`, `GET /:id/statement.pdf`.
- Permissions (`requireAnyPermission`) calées pour ne pas casser la création de Bien
  existante : lecture et création/modification de fiche ouvertes à `locataires` **en plus**
  de `proprietaires` (créer un Bien implique de choisir/créer son propriétaire) ; les
  versements restent réservés à `proprietaires`/`comptabilite` (action financière, pas une
  action « Biens »).
- `routes/properties.js`, `routes/renters.js` : remplacement des colonnes texte par une
  jointure sur `owners` (`toPublicProperty`/`toPublicUnitSummary` exposent désormais
  `owner: { id, name, phone }`).
- `services/pdf.js` : nouvelle fonction `streamOwnerStatementPdf` (identité, patrimoine
  géré, historique des versements) — même moteur que les quittances/attestations
  (date toujours celle du jour, jamais stockée).

### Frontend

- `lib/api/owners.ts`, `components/properties/owner-picker.tsx` (recherche + création
  rapide d'un propriétaire, utilisé dans le formulaire « Nouveau bien » à la place des
  champs texte libres).
- `app/espace/proprietaires/` : répertoire (recherche, patrimoine résumé par propriétaire),
  `nouveau/` (création autonome), `[id]/` (fiche : patrimoine détaillé par bien/unité,
  registre des versements avec formulaire d'enregistrement, bouton « Générer le relevé »).
- Navigation (`espace-header.tsx`) : lien « Propriétaires » ajouté, visible aux mêmes
  rôles que la lecture (agent dédié, DG, comptable).

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Migration appliquée puis vérifiée : le tenant réel (Kiko Store, id 8) conserve
  exactement ses deux propriétaires et l'association à ses deux biens après migration.
- [x] Création bien → propriétaire inexistant d'un autre tenant → 404 (isolation confirmée).
- [x] Cycle complet : créer propriétaire → créer bien avec cet `ownerId` → créer unité →
  créer locataire dessus → répertoire propriétaires reflète patrimoine/loyers à jour →
  enregistrer un versement → relevé PDF généré et vérifié **visuellement** (lecture du PDF,
  pas seulement code HTTP) : aucun chevauchement, montants FCFA correctement formatés.
- [x] Matrice de permissions vérifiée avec agent (`locataires` par défaut) et comptable
  (`comptabilite` par défaut) réels : agent → lecture/création de propriétaire OK (201),
  versement → 403 ; comptable → lecture OK, création de propriétaire → 403, versement OK.
- [x] Nettoyage du tenant de test (`DELETE FROM tenants`, cascade) puis re-vérification que
  le tenant réel (id 8) est strictement inchangé.
- [x] `npm run lint` / `npx tsc --noEmit -p .` → aucune erreur ; nouvelles routes
  (`/espace/proprietaires`, `/espace/proprietaires/nouveau`) vérifiées à 200 sur le
  serveur de dev de l'utilisateur.

### Hors périmètre (reporté, décision explicite de l'utilisateur)

Mandat de gérance (numéro d'acte, taux de commission, échéance), RIB bancaire, calcul
automatique du net à reverser depuis les loyers encaissés, rapprochement bancaire,
bordereau PDF, notification WhatsApp au propriétaire. Le versement reste une saisie
manuelle du comptable/DG tant que l'étape 8 (Comptabilité) n'est pas construite.

### Ajustement demandé après validation — taux de commission & recette par Bien (2026-09-11)

Reprise partielle du « taux de commission » explicitement écarté ci-dessus : cahier des
charges détaillé fourni par l'utilisateur (entités Proprietaire/Maison/Unite/Paiement/
Depense/TauxCommissionHistorique). Toujours **pas de mandat de gérance ni de RIB** — mappé
sur le schéma déjà en place (`owners`/`properties`/`property_units`/`rent_payments`) plutôt
que dupliqué en tables parallèles, conformément à la contrainte explicite du cahier des
charges (« respecte la structure de code déjà existante »).

- **Migration `021_owner_commission.sql`** : nouvelle table `owner_commission_rates`
  (tenant_id, owner_id, rate DECIMAL(5,2), starts_on, ends_on NULL = actif, set_by) — jamais
  d'UPDATE du taux, seulement une clôture (`ends_on`) + une nouvelle ligne. `expenses` reçoit
  deux colonnes **nullables** `property_id`/`unit_id` (dépense rattachable à un Bien et,
  en option, à une Unité précise) — les dépenses de fonctionnement du cabinet déjà saisies
  (loyer bureau, salaires…) restent `NULL`, comportement inchangé.
- **`services/commission.js`** (nouveau, documenté fonction par fonction) :
  `getRecetteNetteMaison` (paiements de toutes les unités du Bien − dépenses qui lui sont
  rattachées, pour un mois — deux agrégations SQL strictement séparées, jamais de JOIN entre
  paiements et dépenses), `getTauxCommissionActif`/`getActiveCommissionRate` (le taux
  réellement en vigueur à une date passée, pas le taux courant), `getRecetteProprietaire`
  (recette nette, taux appliqué, commission cabinet, part propriétaire). **Convention actée**
  pour un taux qui change en cours de mois : le taux retenu pour tout le mois est celui en
  vigueur à son **dernier jour**. Sans taux défini pour le propriétaire, commission à 0 %
  (`rateDefined: false` exposé, jamais une erreur).
- **Endpoints** : `GET /api/properties/:id/recette?mois=AAAA-MM` (lecture, réservé
  proprietaires/comptabilite) ; `PUT /api/owners/:id/commission-rate` (DG uniquement,
  transaction clôture-l'ancien + insère-le-nouveau, refuse une nouvelle date ≤ début du taux
  actif) ; `GET /api/owners/:id` étendu avec `activeCommissionRate`/`commissionRates` ;
  `POST /api/accounting/expenses` accepte désormais `propertyId`/`unitId` optionnels (validés
  contre le tenant). Chaque changement de taux apparaît dans le journal d'activité existant
  (`services/activity.js`, nouveau type `commission_rate_changed`) — aucune table d'audit
  séparée, comme le reste du journal.
- **Frontend** : fiche propriétaire → carte « Commission du cabinet » (taux actif,
  modification DG avec écran de vérification avant confirmation — même schéma que le
  versement, historique complet en tableau) ; fiche Bien → carte « Recette du mois »
  (sélecteur de mois, loyers encaissés / dépenses rattachées / recette nette / commission
  cabinet / part propriétaire en `StatCard`, lien vers la fiche propriétaire si aucun taux
  n'est défini). Visible à proprietaires/comptabilite/DG, pas à un agent `locataires` seul.
- **Tests unitaires** (`backend/scripts/test-commission.js`, cabinet jetable, 22 cas) :
  plusieurs unités d'un même Bien, dépense niveau Bien vs niveau Unité (les deux comptent,
  sans doublon), dépense d'un autre Bien ou dépense cabinet non comptée, aucun taux défini,
  changement de taux entre deux mois consécutifs (chaque mois garde le taux qui était
  réellement actif), mois sans aucune activité → 22/22 OK.
- **Vérifié sur les vraies données (KIko Store)** : taux 10 % puis 15 % (à partir du
  2026-10-01) posés sur GBAGUIDI Rodrigue, une dépense de 15 000 FCFA rattachée à BIEN-004 —
  recette de juillet (10 %) et d'octobre (15 %) vérifiées au navigateur, montants exacts.

---

## Étape 6 — Module Sorties de locataires

**Objectif** : formaliser le départ d'un locataire — jusqu'ici possible uniquement via
« libérer l'unité » (étape 4), qui terminait le bail sans état des lieux ni décompte de
caution. Périmètre réduit par rapport à la maquette Stitch (signature OTP, RIB,
émargement électronique, galerie photo horodatée/géolocalisée, PV OHADA) : même principe
de simplification que les étapes 5 et 4bis — état des lieux de sortie + décompte de
caution chiffré, sans les couches contractuelles/bancaires avancées.

**Critère de validation** : depuis la fiche d'un locataire avec bail actif, un agent (ou
le DG) peut réaliser un état des lieux de sortie chiffrant les retenues, obtenir
automatiquement le net à restituer, et le bail se termine avec l'unité libérée en une
seule opération — avec un PV téléchargeable a posteriori.

### Schéma de données (`009_move_out.sql`)

- `move_out_reports` (tenant_id, lease_id UNIQUE, conducted_at, items JSON, general_notes,
  other_deductions_amount, other_deductions_note, deposit_amount, total_deductions,
  net_refund, conducted_by) — même grille que `move_in_reports` (9 postes standard :
  murs/peinture, sol, plafond, plomberie, électricité, portes/fenêtres, cuisine,
  sanitaires, serrures), avec en plus une retenue chiffrée par poste. Montants figés au
  moment de la sortie (caution, retenues, net) : comme les quittances, ils ne doivent pas
  bouger rétroactivement si le bail est modifié plus tard. *(Refondu en zones/éléments à
  l'étape 15 : `status`/`finalized_at`/signatures ajoutés, montants désormais figés à la
  **finalisation** plutôt qu'à la création du brouillon — la grille à 9 postes ci-dessus ne
  décrit plus le comportement actuel.)*
- Retenue libre optionnelle (« Autres retenues », ex. arriérés de loyer, facture
  SONEB/SBEE résiduelle) distincte de la grille d'état des lieux, qui ne porte que sur
  l'état physique du bien.

### Backend

- `validators/renters.js` : `createMoveOutReportSchema` (grille + retenue libre).
- `routes/leases.js` : `GET /:leaseId/move-out-report` (rapport existant + arriérés en
  cours si le bail est encore actif, pour aider à chiffrer les retenues),
  `POST /:leaseId/move-out-report` (calcule `totalDeductions`/`netRefund`, insère le
  rapport, termine le bail, passe `deposit_status` à `returned`, libère l'unité — tout
  dans une transaction), `GET /:leaseId/move-out-report.pdf`. Permission `etats_des_lieux`
  (déjà libellée « États des lieux **& sorties** » dans le catalogue de permissions —
  aucun changement de permission nécessaire, l'étape rentre dans le périmètre prévu).
- `services/pdf.js` : `streamMoveOutPdf` — PV de sortie & décompte de caution (grille des
  retenues, encart caution initiale/retenues/net à restituer). Même moteur que les
  quittances/attestations/relevés (montants stockés, jamais recalculés à l'affichage).
- `routes/renters.js` : la fiche d'un locataire (`GET /:id`) expose désormais
  `lease.moveOutReport` pour chaque bail (comme `moveInReport`), utilisé pour l'historique.

### Frontend

- `app/espace/locataires/[id]/sortie/` : nouvelle page — formulaire (grille de 9 postes
  avec état + commentaire + retenue chiffrée, retenue libre optionnelle, bannière
  d'arriérés si le bail est en retard) avec décompte calculé en direct (caution → retenues
  → net à restituer) ; bascule en lecture seule avec bouton de téléchargement du PV une
  fois la sortie réalisée.
- `locataire-view.tsx` : le bouton « Locataire parti — libérer l'unité » (raccourci direct
  sans état des lieux, source de confusion constatée avec l'utilisateur en fin d'étape 4)
  est remplacé par un lien « Locataire quitte le logement » vers la nouvelle page — la
  sortie passe désormais toujours par l'état des lieux et le décompte. L'historique des
  baux affiche un bouton « PV de sortie » quand un rapport existe.
- Le raccourci de libération rapide côté fiche du Bien (`/espace/biens/[id]`, ajouté à
  l'étape 4) reste inchangé : conservé comme correctif administratif pour les cas où un
  départ a déjà eu lieu sans passer par ce module (ex. données historiques).

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Cycle complet : bail actif avec loyer impayé (247 j de retard, vérifié) → consultation
  du formulaire (arriérés affichés) → soumission avec dégradations chiffrées (25 000 FCFA)
  + retenue libre (5 000 FCFA, facture SONEB) → calcul vérifié (caution 200 000 − 30 000 =
  net 170 000) → bail `ended`, `deposit_status='returned'`, unité `libre` en une seule
  transaction.
- [x] Nouvelle tentative de sortie sur le même bail → rejetée (bail déjà terminé).
- [x] PDF du PV généré et vérifié **visuellement** (lecture du PDF, pas seulement le code
  HTTP) : grille des retenues lisible, encart de synthèse correct, aucun chevauchement.
- [x] Fiche locataire (`GET /api/renters/:id`) expose bien `moveOutReport` sur le bail concerné.
- [x] Permissions vérifiées avec agent (`etats_des_lieux` par défaut → 200) et comptable
  (`comptabilite`/`charges` par défaut → 403, comme attendu : ce module reste hors de son
  périmètre).
- [x] Nettoyage du tenant de test puis re-vérification que le tenant réel (Kiko Store, id 8)
  est strictement inchangé.
- [x] `npm run lint` / `npx tsc --noEmit -p .` → aucune erreur ; nouvelle route
  (`/espace/locataires/[id]/sortie`) vérifiée à 200 sur le serveur de dev.

### Hors périmètre (reporté)

Signature électronique/OTP, galerie photo horodatée/géolocalisée, génération automatique
d'un ordre de virement bancaire pour la restitution de caution, notification WhatsApp
automatique au locataire sortant, conformité documentaire OHADA formalisée (juste un PV
PDF simple pour l'instant).

### Ajustements demandés après validation (transversaux, sans nouvelle étape)

- Menus renommés : « Propriétaires » → **Gestion Propriétaires**, « Locataires » →
  **Gestion Locataires** (nav, titres de page, onglets navigateur).
- Versement propriétaire : confirmation en deux temps avant tout enregistrement (écran
  de vérification affichant le nom du bénéficiaire en toutes lettres, montant, période,
  mode, date), avec un bouton de confirmation reprenant le nom du propriétaire.
- Tableaux (`components/ui/table.tsx`, partagé par tous les écrans) : lignes zébrées pour
  la lisibilité.
- Modification possible de la fiche propriétaire (nom, téléphone, email, adresse, notes)
  et de la fiche locataire (prénom, nom, email, profession, notes — téléphone non
  modifiable, il sert d'identifiant) depuis un bouton crayon sur chaque fiche. Bug trouvé
  et corrigé pendant les tests : effacer un champ optionnel envoyait `null`, rejeté par le
  schéma serveur qui n'accepte qu'une chaîne vide à cet endroit — corrigé et revérifié.

---

## Étape 7 — Module Plaintes & réclamations

**Objectif** : permettre à l'agent (ou au DG) de déclarer, suivre et clore les incidents
signalés par les locataires (plomberie, électricité, serrurerie, climatisation…).
Périmètre réduit par rapport à la maquette Stitch (annuaire d'artisans agréés, devis
contradictoires, imputabilité juridique bailleur/locataire selon la loi béninoise,
déduction automatique sur le relevé propriétaire, déclaration d'assurance) : même
principe de simplification que les étapes précédentes — un dossier avec catégorie,
priorité, statut, photos et note de résolution, sans les couches contractuelles/
financières avancées (reportées à l'étape 8/9 si besoin).

**Critère de validation** : depuis la fiche d'un locataire (ou depuis un formulaire
autonome), un agent peut déclarer un incident avec photos, le faire progresser
(ouverte → en cours → résolue → fermée) avec note de résolution obligatoire, et
consulter le registre complet avec filtres par statut.

### Schéma de données (`010_complaints.sql`)

- `complaints` (tenant_id, lease_id, code UNIQUE par tenant, category, title, description,
  priority, status, photo_paths JSON, resolution_note, resolved_at, reported_at,
  created_by). Rattachée au **bail** (pas directement au locataire ni à l'unité) : le
  locataire, l'unité et le bien s'en déduisent par jointure, comme pour les paiements et
  états des lieux — cohérent avec le reste du modèle, sans duplication.
- Code auto-généré `INC-{année}-{séquence}` par entreprise, même mécanique que les
  quittances (`QT-{année}-{séquence}`).

### Backend

- `constants/complaints.js` : catégories (plomberie/électricité/serrurerie/climatisation/
  maçonnerie/autre), priorités (normale/urgente), statuts (ouverte/en_cours/résolue/fermée).
- `validators/complaints.js` : création (bail + catégorie + titre + priorité), modification
  (catégorie/titre/description/priorité), changement de statut — **note de résolution
  obligatoire** pour passer en « Résolue » (refus 400 sinon, vérifié).
- `routes/complaints.js`, monté sur `/api/complaints`, permission `plaintes` (déjà dans le
  catalogue depuis l'étape 3, déjà par défaut pour l'agent — aucun changement de
  permission nécessaire) : `GET /` (registre, filtres statut/recherche/bail),
  `GET /:id`, `POST /` (multipart, jusqu'à 4 photos PNG/JPEG/WEBP 3 Mo, même garde-fou que
  les photos de Bien), `PATCH /:id` (corrections), `PATCH /:id/status`.
- Une plainte ne peut être déclarée que sur un **bail actif** (400 explicite sinon).

### Frontend

- `lib/api/complaints.ts`, `lib/constants/complaints.ts`, `components/complaints/
  renter-lease-picker.tsx` (recherche d'un locataire avec bail actif, filtrage côté client).
- `app/espace/plaintes/` : registre (onglets par statut, recherche, badges priorité/statut),
  `nouveau/` (formulaire complet, ou pré-rempli et verrouillé sur un locataire quand on
  arrive depuis sa fiche via `?renterId=`), `[id]/` (dossier complet : contexte, photos,
  actions de suivi contextuelles selon le statut, modification a posteriori).
- `locataire-view.tsx` : nouvelle section « Plaintes & incidents » sur la fiche du bail
  actif (liste + bouton « Signaler un incident ») — visible uniquement si l'utilisateur a
  la permission `plaintes` (distincte de `locataires` : un agent peut gérer les baux sans
  ce module, et inversement), pas seulement `canManage`.
- Navigation : lien « Plaintes » ajouté, gated sur la permission dédiée.

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Cycle complet : création avec photo (code `INC-2026-0001` généré) → photo servie et
  accessible (200) → tentative de résolution sans note → rejetée (400) → passage
  ouverte → en_cours → résolue avec note → `resolved_at` auto-rempli.
- [x] Permissions vérifiées avec agent (`plaintes` par défaut → 200) et comptable
  (`comptabilite`/`charges` par défaut → 403, module hors de son périmètre, cohérent avec
  le catalogue de permissions existant).
- [x] Nettoyage du tenant de test (dossier d'upload compris) puis re-vérification que le
  tenant réel (Kiko Store, id 8) est strictement inchangé.
- [x] `npm run lint` / `npx tsc --noEmit -p .` → aucune erreur ; nouvelles routes
  (`/espace/plaintes`, `/espace/plaintes/nouveau`, `/espace/plaintes/[id]`) vérifiées à
  200 sur le serveur de dev.

### Hors périmètre (reporté)

Annuaire d'artisans agréés, devis contradictoires avec validation DG, imputabilité
juridique bailleur/locataire et déduction automatique sur le relevé propriétaire (étape 5),
déclaration d'assurance, fil de traçabilité horodaté détaillé, notification WhatsApp
automatique au locataire à chaque changement de statut.

---

## Étape 8 — Module Comptabilité & finances

**Objectif** : donner au comptable/DG une vue consolidée des flux d'argent du cabinet et
un journal de ses dépenses de fonctionnement. Périmètre choisi explicitement avec
l'utilisateur (question posée : la maquette Stitch propose un système bien plus lourd —
comptes séquestres par mandat, rapprochement bancaire multi-comptes BOA/Ecobank/MoMo,
lettrage automatique par IA, grand livre et balance SYSCOHADA, honoraires de gérance) :
**journal de dépenses + tableau de bord des flux**, sans banque ni comptabilité en partie
double. Les entrées (loyers encaissés) et sorties vers les propriétaires (versements)
existaient déjà depuis les étapes 4 et 5 ; la brique manquante était les dépenses de
fonctionnement du cabinet lui-même (loyer du bureau, salaires, fournitures…).

**Critère de validation** : le comptable (ou le DG) peut enregistrer une dépense avec
justificatif, et consulter pour n'importe quel mois un tableau de bord affichant loyers
encaissés, versé aux propriétaires, dépenses et solde net, avec le détail des dépenses par
catégorie.

### Schéma de données (`011_expenses.sql`)

- `expenses` (tenant_id, category, label, amount, expense_date, payment_method, notes,
  receipt_path, recorded_by). Aucune nouvelle table pour les entrées/sorties déjà
  existantes (`rent_payments`, `owner_payouts`) — le tableau de bord les agrège
  directement par requête, sans duplication.

### Backend

- `constants/expenses.js` : 9 catégories de dépense de cabinet (loyer du bureau,
  salaires, fournitures, entretien, transport, communication, marketing, taxes, autre).
- `validators/expenses.js`, `routes/accounting.js` monté sur `/api/accounting`,
  permission `comptabilite` stricte sur tout le router (pas d'élargissement aux agents,
  contrairement à locataires/propriétaires où le comptable est invité — ici c'est
  l'inverse : module réservé, cohérent avec le catalogue de permissions) :
  `GET /meta`, `GET /expenses` (filtres période/catégorie/recherche), `POST /expenses`
  (multipart, justificatif optionnel — **image OU PDF**, contrairement aux photos de
  Bien/plaintes qui n'acceptent que des images, une facture étant souvent un PDF),
  `PATCH /expenses/:id`, `DELETE /expenses/:id` (une dépense mal saisie peut être
  supprimée — contrairement aux paiements/versements, registres financiers immuables),
  `GET /dashboard?from=&to=` (agrège `rent_payments` + `owner_payouts` + `expenses` sur
  la période : total encaissé, total reversé, total dépenses, solde net, répartition des
  dépenses par catégorie).

### Frontend

- `lib/api/accounting.ts`, `lib/constants/expenses.ts`.
- `app/espace/comptabilite/` : sélecteur de mois (`<input type="month">`), quatre cartes
  de synthèse (loyers encaissés, versé aux propriétaires, dépenses, solde net — coloré
  positif/négatif), répartition par catégorie, journal des dépenses avec formulaire
  d'ajout, édition en ligne et suppression à confirmation (deux temps, comme la libération
  d'unité), lien vers le justificatif quand il existe.
- Navigation : lien « Comptabilité » ajouté, réservé à la permission dédiée.

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Dépense avec justificatif PDF créée → fichier servi (200) → dépense sans
  justificatif créée → liste correcte.
- [x] Cycle complet : loyer encaissé (60 000) + versement propriétaire (54 000) +
  2 dépenses (25 000 + 150 000) → tableau de bord : solde net = -169 000, vérifié à la main.
- [x] Modification et suppression d'une dépense vérifiées (la dépense supprimée
  disparaît bien de la liste).
- [x] Permissions vérifiées avec agent (`comptabilite` absente par défaut → 403) et
  comptable (`comptabilite` par défaut → 200 sur dépenses et tableau de bord).
- [x] Nettoyage du tenant de test (dossier d'upload compris) puis re-vérification que le
  tenant réel (Kiko Store, id 8) est strictement inchangé.
- [x] `npm run lint` / `npx tsc --noEmit -p .` → aucune erreur ; route `/espace/comptabilite`
  vérifiée à 200 sur le serveur de dev.

### Hors périmètre (reporté, décision explicite de l'utilisateur)

Comptes séquestres par mandat, rapprochement bancaire (import de relevé, pointage,
lettrage automatique), grand livre et balance SYSCOHADA, calcul d'honoraires de gérance,
TVA, export PDF/Excel du registre. Le module « Charges & redevances (SONEB/SBEE) » —
distinct, propre aux unités locatives — reste l'étape 9.

### Ajustement demandé après validation — traçabilité « qui a fait quoi »

Demande transversale (pas une nouvelle étape) : chaque opération doit indiquer son auteur
et son rôle (DG, comptable ou agent), pas seulement son nom.

- `constants/roles.js` (+ miroir frontend `lib/constants/roles.ts`), `utils/actor.js`
  (`toActor(prénom, nom, rôle)` → `{ name, role, roleLabel }` ou `null`) : helper réutilisé
  partout, pour ne jamais dupliquer le libellé des rôles.
- Migration `012_actor_tracking.sql` : ajout de `created_by` (nullable) sur `properties`,
  `property_units`, `owners`, `renters`, `leases` — non tracé jusqu'ici — et de
  `resolved_by` sur `complaints` (qui a résolu le dossier, distinct de qui l'a déclaré).
  Colonnes nullables : les enregistrements déjà existants gardent `createdBy: null` plutôt
  qu'une attribution inventée (vérifié sur les biens/propriétaires réels de Kiko Store).
- Attribution exposée et affichée (composant partagé `components/ui/attribution.tsx`) sur :
  création de Bien/Unité/Propriétaire/Locataire/Bail, paiement de loyer (nouvelle colonne
  « Enregistré par » sur le registre des paiements), état des lieux d'entrée et de sortie
  (« réalisé par »), versement propriétaire, déclaration **et** résolution d'une plainte
  (deux auteurs distincts possibles), dépense comptable (nouvelle colonne).
- Testé avec les trois rôles sur un tenant jetable : Bien/Unité/Propriétaire/Locataire créés
  par un **agent**, paiement + versement + dépense enregistrés par une **comptable**, plainte
  déclarée par l'agent et résolue par le **DG** — chaque attribution vérifiée exacte via
  l'API avant tout affichage. Nettoyage puis re-vérification que Kiko Store est inchangé.
- Hors périmètre : historique des modifications (qui a édité quoi, quand) — seuls les
  moments de création/action sont tracés, pas les corrections ultérieures.

### Ajustement demandé après validation — séparer dépenses du cabinet et travaux facturés aux Biens (2026-09-12)

Remarque de l'utilisateur : « il y a une différence entre les dépenses de l'entreprise et
les dépenses effectuées pour réparations de maison » — les travaux sur un Bien doivent être
déduits de la recette du **propriétaire**, les dépenses de fonctionnement de celle du
**cabinet**, jamais les deux confondues.

Le calculateur de recette par Bien (Étape 5, `services/commission.js`) faisait déjà cette
distinction correctement. Le bug était dans le tableau de bord **Comptabilité** (Étape 8,
`GET /api/accounting/dashboard`) : ses totaux « Dépenses » et « Solde net » sommaient TOUTES
les dépenses de la période — y compris les travaux rattachés à un Bien (`property_id` non
nul) — alors que la charte du module dit explicitement « dépenses de fonctionnement du
cabinet ». Un travaux facturé au propriétaire finissait donc compté deux fois : une fois
(à raison) contre sa propre recette, une fois (à tort) contre le solde du cabinet.

- `routes/accounting.js` (`GET /dashboard`) : les requêtes `expenses`/`expensesByCategory`
  filtrent maintenant `property_id IS NULL` (cabinet uniquement) ; nouvelle requête
  informative `propertyExpenses`/`propertyExpensesCount` (travaux facturés aux Biens sur la
  période, exclus de `expenses` et de `netCashFlow` — juste affichés à part, rien ne
  « disparaît » du suivi).
- `routes/accounting.js` (`GET /expenses`, le journal commun) : jointure `properties` pour
  exposer `propertyCode` (ex. "BIEN-004") sur chaque dépense — le journal reste unique
  (cabinet + Biens mélangés, historique inchangé) mais chaque ligne rattachée à un Bien est
  maintenant identifiable.
- Frontend (`app/espace/comptabilite/comptabilite-view.tsx`) : carte « Dépenses » renommée
  « Dépenses du cabinet », nouvelle carte « Travaux facturés aux biens » (teinte `info`,
  « à la charge des propriétaires »), badge du code du Bien sur chaque ligne concernée du
  journal, description du journal explicitée.
- Testé sur les vraies données Kiko Store (tenant 8) : les 3 dépenses réellement rattachées
  à BIEN-004/BIEN-005 (15 000 + 22 000 + 4 500 FCFA) désormais exclues de « Dépenses du
  cabinet »/« Solde net » et comptées à part dans « Travaux facturés aux biens » ; badges
  BIEN-004/BIEN-005 vérifiés visibles dans le journal (navigateur). Aucune régression sur
  la recette par Bien (calculateur non touché).

### Ajustement demandé après validation — expliquer clairement l'ouverture/la clôture d'un mois (2026-09-12)

Demande de l'utilisateur : « il faut bien expliquer comment faire l'ouverture d'un mois et
comment le fermer ». La mécanique existait déjà (date de démarrage + clôture par mois) mais
les deux notions n'étaient jamais mises en relation à l'écran — pas de bug, un manque
d'explication.

- `app/espace/comptabilite/comptabilite-view.tsx` : nouvelle carte repliable « Comment
  fonctionne l'ouverture et la clôture d'un mois ? », affichée en haut de la page (dépliée
  par défaut), juste au-dessus de la carte de date de démarrage. Explique en clair :
  - **Ouvrir** : rien à faire, un mois est ouvert par défaut ; seules la date de démarrage
    (si définie) ou une clôture déjà passée peuvent l'en empêcher.
  - **Fermer** : verrouillage définitif (aucune réouverture possible dans l'app), condition
    de clôturabilité (échéances de loyer du mois passées + marge de sécurité), clôture
    anticipée forcée par le DG (tracée), réservé au DG.
- Aucun changement de logique métier — uniquement de la pédagogie, purement additive.
- Vérifié en navigateur (Firefox headless, tenant réel) : carte dépliée à l'ouverture, se
  replie/déplie correctement au clic. `tsc --noEmit`/`next lint` propres.

### Ajustements demandés après validation — texte trop long/tirets, fonds des registres (2026-09-12)

- Carte « Comment fonctionne l'ouverture et la clôture d'un mois ? » réécrite plus courte,
  sans tirets moyens (« — ») dans le texte visible, avec un exemple concret chiffré (date de
  clôture, mois suivant déjà ouvert). Tous les autres textes visibles de la page
  (descriptions de cartes, bannière de clôture, résumé de la date de démarrage) débarrassés
  de la même ponctuation, remplacée par des points ou virgules. Les tirets utilisés comme
  simple symbole « valeur absente » dans les tableaux (ex. auteur inconnu) sont conservés,
  autre convention.
- Les trois registres qui se suivent à l'écran (Paiements des locataires, Versements aux
  propriétaires, Journal des dépenses) se ressemblaient trop (tous blancs) — chacun a
  maintenant un fond teinté distinct cohérent avec la sémantique déjà en place (vert =
  encaissé, bleu = reversé, orange = dépensé, mêmes tons que les cartes de synthèse
  au-dessus).
- Vérifié en navigateur (Firefox headless, tenant réel). `tsc --noEmit`/`next lint` propres.

### Bug-fix (2026-09-14) : clutter DG-only retiré de la vue comptable/agent

Demande directe de l'utilisateur (« supprime tous ça au niveau de la comptabilité et agent »),
en collant le texte visible sur la page — qui correspondait exactement à trois blocs
informatifs affichés à TOUT LE MONDE sans condition de rôle : la carte « Comment fonctionne
l'ouverture et la clôture d'un mois ? » (`HowMonthsWorkCard`), la carte de date de démarrage
(`StartDateCard`, y compris sa ligne « Aucune date de démarrage définie... »), et la bannière
« Mois X ouvert, clôturable à partir du... Seul l'Admin peut clôturer un mois. » de
`ClotureBanner` (déjà une branche dédiée non-DG, mais purement informative). Ces trois blocs
expliquent une action que seul le DG peut faire — inutile, voire confus, pour un comptable ou
un agent qui ne peut pas clôturer de toute façon.
- `comptabilite-view.tsx` : les deux premières cartes désormais dans `{isDg && (...)}`.
- `ClotureBanner` : sa branche `!isDg` (mois OUVERT) renvoie maintenant `null` — retiré
  entièrement pour le comptable/agent. Sa branche « mois CLÔTURÉ » reste affichée à tous les
  rôles (information opérationnelle nécessaire : explique pourquoi une saisie est refusée).
- Le sélecteur de période et le bouton « Rapport mensuel » (étape 18) restent inchangés pour
  tous les rôles — ce sont des contrôles fonctionnels, pas du texte explicatif.
Vérifié en navigateur (Firefox headless, cabinet jetable) : un comptable ne voit plus aucun
des trois blocs (page directement du sélecteur de période aux cartes chiffrées) ; le DG,
lui, voit toujours exactement les trois blocs comme avant (aucune régression). `tsc --noEmit`/
`next lint` propres. Cabinet de test supprimé après coup, KIko Store (14 baux) inchangé.

---

## Étape 9 — Module Charges & redevances (SONEB/SBEE)

**Objectif** : suivre les factures d'eau (SONEB) et d'électricité (SBEE) à la charge du
locataire, distinctes du loyer. Aucune maquette dédiée dans le cahier des charges — le
périmètre a été calé explicitement avec l'utilisateur : un registre par locataire (relevés
ou montant direct, statut payée/impayée), sur le même principe que le registre des
paiements de loyer, mais pour les fluides.

**Critère de validation** : depuis la fiche d'un locataire (ou un formulaire autonome), on
peut enregistrer une facture SONEB ou SBEE (avec index de relevé optionnels ou montant
direct), la marquer réglée avec confirmation, et consulter le registre complet filtrable
par statut/fluide.

### Schéma de données (`013_utility_charges.sql`)

- `utility_charges` (tenant_id, lease_id, utility_type `soneb`/`sbee`, period_label,
  reading_start/reading_end **nullables et purement informatifs**, amount, billed_at,
  status `impayee`/`payee`, paid_at, payment_method, recorded_by, paid_recorded_by).
  Rattachée au **bail** comme les paiements et plaintes (locataire/unité/bien s'en
  déduisent). Aucun calcul de tarif par tranche : le montant est toujours saisi
  directement d'après la facture réelle — aucun barème SONEB/SBEE fiable à coder en dur,
  la consommation affichée (index fin − index début) reste indicative.

### Backend

- `constants/charges.js`, `validators/charges.js`.
- `routes/charges.js` monté sur `/api/charges`, permission `charges` **stricte**
  (catalogue de permissions de l'étape 3, par défaut comptable — vérifié : agent → 403,
  comptable → 200) : `GET /meta`, `GET /` (registre, filtres statut/fluide/bail/recherche),
  `POST /` (bail actif requis), `PATCH /:id` (correction), `PATCH /:id/pay` (règlement —
  refuse une double confirmation sur une facture déjà payée), `DELETE /:id`.
- Traçabilité « qui a fait quoi » (étape 8) appliquée dès la construction : `recordedBy`
  (qui a enregistré la facture) et `paidRecordedBy` (qui a confirmé le règlement, parfois
  une personne différente) exposés séparément.

### Frontend

- `lib/api/charges.ts`, `lib/constants/charges.ts`.
- `app/espace/charges/` : registre (onglets par statut, filtre fluide, recherche, total
  impayé affiché), édition et suppression en ligne, **confirmation en deux temps avant
  règlement** (même rigueur que les versements propriétaires) affichant locataire et
  montant avant validation ; `nouveau/` (formulaire, réutilise le sélecteur de locataire
  des plaintes, pré-rempli et verrouillé depuis la fiche d'un locataire via `?renterId=`).
- `locataire-view.tsx` : nouvelle section « Charges SONEB & SBEE » sur le bail actif,
  visible uniquement avec la permission `charges` (ni `locataires` ni `comptabilite` ne
  suffisent — cohérent avec le catalogue de permissions existant).
- Navigation : lien « Charges » ajouté, gated sur la permission dédiée.

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Facture SONEB avec relevés (100 → 115) → consommation calculée automatiquement (15),
  vérifiée exacte. Facture SBEE sans relevé (montant direct) → acceptée.
- [x] Règlement enregistré → statut `payee`, `paidRecordedBy` renseigné ; nouvelle tentative
  de règlement sur la même facture → rejetée (400, déjà payée).
- [x] Permissions vérifiées : agent (`charges` absente par défaut) → 403 ; comptable
  (`charges` par défaut) → 200 — cohérent avec le catalogue de permissions de l'étape 3.
- [x] Nettoyage du tenant de test puis re-vérification que le tenant réel (Kiko Store, id 8)
  est strictement inchangé.
- [x] `npm run lint` / `npx tsc --noEmit -p .` → aucune erreur ; routes `/espace/charges`,
  `/espace/charges/nouveau` vérifiées à 200 sur le serveur de dev.

### Hors périmètre (reporté, décision explicite de l'utilisateur)

Calcul automatique de tarif par tranche de consommation, répartition de charges communes
entre plusieurs locataires d'un même bien, rappel automatique avant échéance, intégration
directe avec SONEB/SBEE (aucune API publique disponible).

### Ajustement demandé après validation — calcul automatique du montant

Le montant ne devait plus être saisi à la main : `montant = (index fin − index début) ×
prix unitaire`, avec index de relevé obligatoires et période en intervalle de dates
(calendrier) plutôt qu'un libellé libre.

- Migration `014_utility_charges_pricing.sql` : `reading_start`/`reading_end` passent en
  `NOT NULL`, `period_label` remplacé par `period_start`/`period_end` (DATE), nouvelle
  colonne `unit_price`. Une ligne de test existait déjà sur le tenant réel (période
  invalide « 31 Aout -31 sept », montant 300 FCFA sans rapport avec un vrai tarif) :
  supprimée plutôt que de lui fabriquer rétroactivement des dates/un prix — signalé à
  l'utilisateur avant d'agir.
- `POST /api/charges` et `PATCH /api/charges/:id` calculent désormais le montant
  côté serveur (jamais transmis par le client) ; la modification recalcule dès que l'un
  des trois facteurs (index début, index fin, prix unitaire) change, en combinant les
  nouvelles valeurs avec celles déjà en base.
- Formulaire de création et édition en ligne : deux sélecteurs de date (calendrier) pour
  la période, index obligatoires, prix unitaire, montant affiché en aperçu live (jamais
  éditable directement).
- Testé : 46 unités × 209,5 FCFA → 9 637 FCFA (arrondi) vérifié exact ; recalcul après
  modification d'un index vérifié ; validations (index manquants, fin de période avant
  début, index fin < index début) toutes rejetées en 400. Tenant de test nettoyé, tenant
  réel revérifié sans la ligne de test.

### Ajustement demandé après validation — consultation sans permission (Locataires & Propriétaires)

Jusqu'ici, un agent sans la permission `locataires` (ou `proprietaires`) n'avait *aucun*
accès aux modules Locataires/Propriétaires — ni pour gérer, ni même pour consulter.
Demande : un agent doit toujours pouvoir **consulter** l'annuaire (liste, coordonnées,
statut) même si le DG ne lui a pas assigné la permission ; seule la **gestion**
(créer/modifier/agir) doit rester réservée à qui a la permission.

- `routes/renters.js`, `routes/owners.js` : la lecture (`GET` liste/fiche) n'exige plus
  `locataires`/`proprietaires`/`comptabilite` — `requireAuth` (déjà appliqué à tout le
  router) suffit, ouvrant l'annuaire à tout employé de l'entreprise. La gestion
  (`POST`/`PATCH`) reste inchangée. Les documents générés à la demande (attestation de
  loyer, relevé propriétaire) restent réservés à `locataires`/`comptabilite` (et
  `proprietaires` pour le relevé) : consulter une fiche n'inclut pas générer un document
  officiel.
- Pages `locataires-view.tsx`, `locataire-view.tsx`, `proprietaires-view.tsx`,
  `proprietaire-view.tsx` : le garde `RequireAuth permission={...}` qui bloquait l'accès
  à la page elle-même est retiré (remplacé par une simple authentification) ; les boutons
  de gestion (Nouveau locataire/propriétaire, modifier, attribuer un bail) restent gardés
  par un `canManage` local, inchangé.
- **Bugs latents corrigés au passage**, révélés par cette ouverture (des boutons visibles
  mais qui échouaient en 403 au clic pour un agent sans la bonne permission — un agent
  avec `plaintes` mais pas `locataires` ne pouvait déjà pas utiliser le sélecteur de
  locataire dans « Nouvelle plainte » avant même ce changement) : le bouton « Attestation
  de loyer », le bouton « Générer le relevé » propriétaire, le téléchargement d'un « PV de
  sortie », et le registre des paiements (bouton « Enregistrer un paiement » + téléchargement
  de quittance) sont maintenant gardés côté client par les mêmes permissions que le serveur
  exige réellement, au lieu d'être affichés sans condition.
- Testé sur tenant jetable avec un agent **sans aucune permission assignée** : liste et
  fiche locataire/propriétaire → 200 ; création de locataire/propriétaire → 403 ;
  génération de documents (attestation, relevé) → 403 ; enregistrement d'un paiement →
  403 (inchangé). Non-régression vérifiée pour le DG et un comptable. Tenant nettoyé,
  tenant réel revérifié inchangé.

### Bug trouvé et corrigé — les permissions décochées à la création n'étaient pas respectées

En vérifiant que « le bouton Nouveau locataire ne doit pas apparaître pour un agent sans
la permission », un vrai bug est apparu dans `routes/employees.js` (création d'employé,
`POST /api/employees`) : si le DG décochait **toutes** les cases de permission avant de
créer un employé (voulant délibérément zéro accès), le serveur ignorait ce choix et
réappliquait silencieusement les permissions par défaut du rôle — pour un agent, cela
incluait toujours `locataires`. Le bouton restait donc visible malgré le choix du DG.

- Cause : `const permissions = data.permissions.length > 0 ? data.permissions :
  DEFAULT_PERMISSIONS_BY_ROLE[data.role]` — un tableau vide était traité comme « non
  renseigné » plutôt que comme un choix explicite. La route de modification
  (`PATCH /api/employees/:id`) n'avait pas ce défaut : seule la création était touchée.
- Corrigé : la création respecte désormais exactement le tableau envoyé, y compris vide —
  cohérent avec le formulaire, qui pré-coche déjà les valeurs par défaut du rôle et ne
  fait que refléter les cases réellement cochées par le DG.
- Vérifié : création avec `permissions: []` explicite → employé créé avec zéro permission
  (vérifié aussi en connexion réelle) ; création normale avec les permissions par défaut du
  rôle → inchangée. Tenant de test nettoyé.
- Vérification (lecture seule) sur les vrais employés de Kiko Store : aucune anomalie
  visible dans les permissions actuelles, mais si un employé a été créé par le passé en
  décochant tout, ses permissions peuvent avoir été silencieusement réinitialisées aux
  valeurs par défaut du rôle — à vérifier/resaisir via la page de modification de
  l'employé (`PATCH`, non affectée par ce bug) si besoin.

### Ajustement demandé après validation — classification par nature + clôture mensuelle

Demande en trois volets : (1) classer la comptabilité par nature (dépenses, impayés
SONEB/SBEE, paiements locataires, versements propriétaires), (2) une clôture mensuelle
définie par le DG — une fois un mois clôturé, plus personne ne peut y écrire, pour la
traçabilité, (3) les arriérés doivent être additionnés automatiquement par le système
quand ils existent, pas saisis à la main.

- Migration `015_accounting_periods.sql` : table `accounting_periods` (tenant_id, period
  `AAAA-MM`, closed_by). `services/accountingPeriods.js` : `assertPeriodOpen(tenantId,
  date)` — lève une 403 explicite si le mois de cette date est clôturé. Appelé avant
  toute création/modification/suppression sur les 4 registres financiers : paiements de
  loyer (`leases.js`), versements propriétaires (`owners.js`), dépenses et charges
  SONEB/SBEE (`accounting.js`, `charges.js`) — y compris marquer une charge payée. Une
  modification qui changerait la date elle-même est aussi bloquée si la nouvelle date
  tombe dans un mois clôturé.
- `POST /api/accounting/periods` (clôturer) : **DG uniquement** (`requireRole('dg')`),
  vérifié refusé pour un comptable. Volontairement **sans réouverture** : une clôture est
  définitive, cohérent avec la demande de traçabilité — si un besoin de correction après
  clôture apparaît, ce sera une décision explicite à ajouter, pas un défaut.
- `GET /api/accounting/dashboard` étendu : en plus des 3 totaux existants, calcule
  désormais **charges SONEB/SBEE impayées** (toutes, sans filtre de période — un impayé
  reste dû) et **impayés locataires estimés** (baux actifs en retard : jours de retard,
  mois dus, montant dû = mois dus × loyer — calculé automatiquement à partir de
  `computeArrears`, jamais saisi). Nouvelles routes `GET /rent-payments` et
  `GET /owner-payouts` (classification détaillée, liste ligne par ligne).
- Permissions de `routes/accounting.js` restructurées : `GET /periods` (lecture du
  statut de clôture) ouvert à `comptabilite` **ou** `charges` — sans ça, un employé
  n'ayant que `charges` n'aurait pas pu savoir si un mois est clôturé en utilisant son
  propre module. Toutes les autres routes restent strictement `comptabilite`.
- Frontend : `/espace/comptabilite` réorganisé — bandeau de clôture (statut + bouton DG
  avec confirmation en deux temps rappelant l'irréversibilité), 6 cartes de synthèse,
  sections « Paiements des locataires », « Versements aux propriétaires », « Impayés
  locataires » (liste + total auto-additionné), « Journal des dépenses » (désactivé si le
  mois est clôturé), « Charges impayées » (lien vers le registre dédié), historique des
  clôtures. `/espace/charges` : chaque facture dont le mois de facturation est clôturé
  affiche un badge « Clôturé » à la place des actions, au lieu de boutons qui
  échoueraient silencieusement.
- Testé sur tenant jetable : clôture par comptable → 403 ; par DG → 201 ; nouvelle
  écriture (paiement/versement/dépense/charge) datée dans le mois clôturé → 403 sur
  chacun des 4 registres ; modification/suppression/règlement d'une charge déjà
  existante dans ce mois → 403 ; même action sur un mois encore ouvert → toujours
  acceptée. `isClosed`/`closedInfo` vérifiés exacts après clôture. Permission croisée
  vérifiée : agent avec seulement `charges` → lit `GET /periods` (200) mais pas le
  tableau de bord comptable (403). Tenant nettoyé, tenant réel revérifié inchangé.

### Ajustement demandé après validation — suppression logique (traçabilité) + journal DG

Demande : quand un comptable ou un agent supprime une dépense ou une charge SONEB/SBEE,
la trace ne doit jamais disparaître — la suppression doit exiger une justification
obligatoire, rester visible du DG, mais le montant doit sortir des totaux/recettes.

- Migration `016_soft_delete_audit.sql` : ajoute `deleted_at`, `deleted_by` (FK vers
  `users`, `ON DELETE RESTRICT`), `deleted_reason` sur `expenses` et `utility_charges` —
  les deux seules tables exposant un `DELETE` jusqu'ici. Aucune autre table n'a de
  suppression physique ni logique dans l'application.
- `validators/expenses.js` et `validators/charges.js` : nouveau `deleteReasonSchema`
  (`reason` : 5 à 255 caractères, obligatoire) — appliqué au corps de la requête `DELETE`,
  quel que soit le rôle de qui supprime (comptable ou agent avec la permission `charges`).
- `routes/accounting.js` (`DELETE /expenses/:id`) et `routes/charges.js` (`DELETE /:id`) :
  le `DELETE FROM ...` physique est remplacé par un `UPDATE ... SET deleted_at = NOW(),
  deleted_by = :by, deleted_reason = :reason`. La vérification `assertPeriodOpen` reste en
  place avant — un mois clôturé bloque toujours la suppression, logique comme physique.
- `loadExpense`/`loadCharge` (helpers internes) et toutes les requêtes de liste/tableau de
  bord touchant ces deux tables (`GET /expenses`, `GET /dashboard` — total dépenses, répar-
  tition par catégorie, charges impayées et répartition par fluide — et `GET /api/charges`)
  filtrent désormais systématiquement `deleted_at IS NULL` : un enregistrement supprimé
  redevient introuvable pour toute lecture/modification normale et disparaît de tous les
  totaux, exactement comme s'il n'avait jamais existé pour la comptabilité courante.
- Nouvelle route `GET /api/accounting/deleted-entries` (**DG uniquement**,
  `requireRole('dg')`) : unifie dépenses et charges supprimées en un seul journal
  chronologique — libellé, montant, auteur de la création (`Actor`), auteur de la
  suppression (`Actor`), date de suppression, justification. Refusée à un comptable
  (403), même avec la permission `comptabilite`.
- Frontend : `deleteExpense`/`deleteCharge` (`lib/api/accounting.ts`, `lib/api/charges.ts`)
  prennent désormais un paramètre `reason` obligatoire envoyé en JSON. Les lignes de
  suppression (`ExpenseRow`, `ChargeRow`) affichent un formulaire de confirmation avec un
  champ de justification (5 caractères minimum) — le bouton de confirmation reste désactivé
  tant que la justification est trop courte. Nouvelle section « Journal des suppressions »
  sur `/espace/comptabilite`, visible uniquement du DG (`isDg`), listant chaque suppression
  avec créateur, suppresseur, date et motif.
- Testé sur tenant jetable : suppression sans justification → 400 ; justification trop
  courte (< 5 car.) → 400 ; suppression valide → 204, montant absent du tableau de bord et
  de la liste juste après (dépense 15 000 FCFA et charge SONEB 15 000 FCFA vérifiées
  disparues des totaux et des listes) ; tentative de modifier l'enregistrement supprimé →
  404 (introuvable, comme prévu) ; comptable sur `/deleted-entries` → 403 ; DG sur
  `/deleted-entries` → 200 avec les deux entrées, auteur et justification exacts. Combiné
  avec la clôture mensuelle : mois clôturé → suppression bloquée par `assertPeriodOpen`
  (403) avant même d'atteindre la logique de suppression logique. Tenant nettoyé, tenant
  réel (`KIko Store`, id 8) revérifié inchangé — 3 dépenses et 2 charges, aucune marquée
  supprimée.

### Ajustement demandé après validation — date de démarrage de la comptabilité (DG, modifiable)

Demande : « l'ouverture de la date de la période doit être par l'admin DG et il peut
modifier cela » + « à chaque fois on peut accéder à une période ancienne pour voir ».
Clarifié via question explicite (option retenue) : le DG définit une date de démarrage
de la comptabilité pour son entreprise — avant cette date, aucune écriture financière ne
peut être créée — et peut la modifier à tout moment, contrairement à la clôture d'un mois
qui reste définitive. La consultation (lecture) des périodes anciennes n'a jamais été
concernée par cette restriction.

- Migration `017_accounting_start_date.sql` : ajoute `accounting_start_date` (DATE
  NULL = pas de restriction), `accounting_start_date_set_by`, `accounting_start_date_set_at`
  sur `tenants` (un seul paramètre par entreprise, pas une table à part).
- `services/accountingPeriods.js` : nouvelle `getAccountingStartDate(tenantId)` ; la
  fonction déjà partagée `assertPeriodOpen(tenantId, dateStr)` vérifie désormais **aussi**
  cette borne basse (en plus de la clôture existante) — donc les 4 points d'écriture
  financière (paiements de loyer, versements propriétaires, dépenses, charges SONEB/SBEE)
  en héritent automatiquement, sans modification de leurs routes.
- `GET /api/accounting/start-date` (lecture : `comptabilite` **ou** `charges`, même
  logique que `/periods`) et `PATCH /api/accounting/start-date` (**DG uniquement**,
  `startDate: null` retire la restriction) dans `routes/accounting.js`.
- Frontend : `getAccountingStartDate`/`setAccountingStartDate` (`lib/api/accounting.ts`).
  Nouvelle carte sur `/espace/comptabilite` (au-dessus du bandeau de clôture) : pour le DG,
  date affichée + bouton « Modifier » (champ date, vide = pas de restriction) ; pour les
  autres, affichage en lecture seule de la date et de qui l'a définie.
- Bug trouvé et corrigé **avant** validation finale, via le nettoyage obligatoire du tenant
  jetable : `accounting_start_date_set_by` vivant directement sur `tenants` (pas sur une
  table fille) avec `ON DELETE RESTRICT` créait un cycle tenants → users → tenants,
  identique dans son mécanisme au bug `fk_properties_owner` de l'étape 5 — `DELETE FROM
  tenants` échouait avec `ER_ROW_IS_REFERENCED_2` (la cascade vers `users` se heurtait à la
  ligne `tenants` qui les référence encore). Corrigé par `018_accounting_start_date_fk_fix.sql`
  : `ON DELETE SET NULL` au lieu de `RESTRICT` — acceptable ici car le champ vit sur une
  ligne unique par entreprise (contrairement à `deleted_by`/`closed_by`, sur des tables
  filles, qui n'ont jamais ce problème).
- Testé sur tenant jetable : lecture ouverte à `comptabilite`/`charges`, écriture refusée à
  un comptable (403, DG uniquement) ; dépense datée avant la date de démarrage → 403 avec
  message explicite ; datée après → acceptée ; DG modifie la date vers une date antérieure
  → la même dépense (précédemment refusée) devient acceptée immédiatement (donc bien
  modifiable, pas définitif comme une clôture) ; DG retire la restriction (`null`) → une
  date très ancienne (2020) devient acceptable ; consultation du tableau de bord et de la
  liste des dépenses pour une période antérieure à la date de démarrage → toujours 200,
  jamais bloquée ; combiné avec un mois clôturé → la lecture du mois clôturé reste 200,
  seule l'écriture est refusée (403, avec le bon message selon la cause). Tenant nettoyé
  (après correctif de la FK), tenant réel (`KIko Store`, id 8) revérifié inchangé —
  `accounting_start_date` toujours NULL, 3 dépenses et 2 charges intactes.

### Bug signalé et corrigé — impossible d'ajouter une unité / de créer un propriétaire « complet »

Signalé par l'utilisateur : « impossible d'ajouter les unités » et « impossible de créer un
propriétaire complet ». Reproduit sur tenant jetable : un employé n'ayant que la permission
`proprietaires` (pas `locataires`) peut créer une fiche propriétaire seule (`POST
/api/owners`, 201) mais se voit refuser (403 « Vous n'avez pas accès à ce module ») toute
tentative de lui rattacher un Bien ou d'ajouter une Unité — parce que **tout** le routeur
`routes/properties.js` (Biens + Unités) était encore gardé par `requirePermission('locataires')`
seul, un reliquat de l'étape 4 (avant que l'étape 5 ne sépare `proprietaires` en permission à
part entière). Un employé géreant des propriétaires ne peut alors jamais rendre leur fiche
« complète » (biens + unités rattachés) sans qu'on lui ajoute aussi `locataires` — une
permission qui n'a pourtant rien à voir avec son rôle.

Confirmé en clair sur les données réelles (lecture seule, aucune modification) : le
comptable réel du tenant (Laurent FATOKOU, id 8) a exactement cette combinaison —
`proprietaires` sans `locataires` — expliquant directement le signalement.

- `routes/properties.js` : gate du routeur changée de `requirePermission('locataires')` à
  `requireAnyPermission('locataires', 'proprietaires')` — cohérent avec `routes/owners.js`
  qui anticipait déjà l'inverse (création à la volée d'un propriétaire depuis le formulaire
  Bien, permission `locataires` OU `proprietaires`).
- Frontend : `permission="locataires"` → `permission={["locataires", "proprietaires"]}` sur
  les 3 pages Biens (`biens-view.tsx`, `[id]/bien-view.tsx`, `nouveau/nouveau-view.tsx`).
  Lien de navigation « Nos biens » (`espace-header.tsx`) affiché désormais dès que
  `locataires` **ou** `proprietaires` est présent (il ne dépendait que de `locataires`).
- Testé sur tenant jetable : agent avec seulement `proprietaires` → création de Bien (201) et
  d'Unité (201), avant échouaient (403) ; agent avec seulement `locataires` → toujours 201
  (non régressé) ; agent sans aucune des deux (`plaintes` uniquement) → toujours 403 (pas
  d'ouverture excessive). Tenant nettoyé, tenant réel (`KIko Store`, id 8) revérifié
  inchangé — 2 biens, 2 unités, 4 propriétaires intacts. Aucune donnée réelle modifiée : le
  bug était uniquement dans le code de permission, pas dans les données de Laurent FATOKOU.

### Ajustement demandé après validation — période choisie dans un calendrier, nouvelles écritures ancrées sur aujourd'hui

Deux demandes : (1) « la période est une date à sélectionner et non à saisir » — repéré : la
« Période » d'un versement propriétaire (`period_label`) était un champ texte libre (hint
« Ex. Juin 2026 »), seul endroit de l'appli où une période s'entrait encore à la main ; les
données réelles du tenant confirmaient le risque (`"6 Juin 2026"`, `"7 Aout 2026"` — format
déjà incohérent). (2) Clarifié via question explicite : quand on ouvre un formulaire de
nouvelle écriture (dépense...) en consultant un ancien mois via le sélecteur de période de
`/espace/comptabilite`, la date proposée par défaut doit toujours être aujourd'hui (le mois
actuellement ouvert), jamais le mois historique affiché à l'écran — les plaintes ne sont pas
concernées, n'étant rattachées à aucun mois comptable.

- `lib/utils.ts` : nouvelle `formatMonthLabel(yearMonth)` — dérive un libellé français
  (« Juin 2026 ») depuis une valeur `AAAA-MM` de sélecteur mensuel natif.
- `proprietaire-view.tsx` (formulaire de versement) : le champ « Période » devient un
  `<input type="month">` (calendrier mois/année) ; le libellé envoyé au backend
  (`periodLabel`) est désormais **dérivé automatiquement** de cette sélection via
  `formatMonthLabel`, jamais tapé. Schéma/route backend inchangés (toujours une chaîne
  libre côté stockage) — les anciens libellés existants restent affichés tels quels.
- `comptabilite-view.tsx` : `ExpenseForm` ne reçoit plus `defaultDate` calculé depuis la
  période consultée (`to`, fin du mois affiché — y compris pour le mois courant, où `to`
  valait le dernier jour du mois, pas la date du jour) ; la date de la nouvelle dépense
  s'initialise désormais systématiquement à `todayIso()` (aujourd'hui), indépendamment du
  mois actuellement consulté dans le sélecteur de période.
- Audité le reste de l'application (paiements de loyer, versements propriétaires, charges
  SONEB/SBEE) : tous leurs formulaires de création dataient déjà par défaut sur
  `new Date().toISOString().slice(0, 10)` (aujourd'hui) de façon indépendante, sans lien
  avec un état de période consultée — seul `ExpenseForm` avait ce défaut. Les champs
  période de début/fin d'une charge SONEB/SBEE restent volontairement vides par défaut
  (ce n'est pas « aujourd'hui » qui a un sens ici, mais la période de relevé réelle,
  toujours choisie explicitement dans un calendrier).
- Vérifié : `npx tsc --noEmit` et `next lint` propres après chaque changement ; les deux
  serveurs de dev restent opérationnels (200 sur `/` et `/api/health`) après les éditions.

### Correction immédiate — le jour est primordial dans une date

Retour utilisateur juste après le point précédent : « le jour doit être dans la date, c'est
primordial ». Le sélecteur de « Période » du versement propriétaire venait d'être converti
en `<input type="month">` (année + mois seulement) — trop réducteur : les valeurs réelles
existantes (`"6 Juin 2026"`, `"7 Aout 2026"`) montraient que le jour exact fait partie de
l'information attendue, pas une erreur de saisie comme supposé.

- `lib/utils.ts` : `formatMonthLabel(yearMonth)` remplacée par `formatDateLabel(isoDate)` —
  dérive un libellé français **avec le jour** (« 6 juin 2026 ») depuis une date complète
  `AAAA-MM-JJ`.
- `proprietaire-view.tsx` (formulaire de versement) : le champ « Période » repasse en
  `<input type="date">` (calendrier complet, jour inclus) au lieu de `type="month"` — reste
  un calendrier à sélectionner (jamais de saisie libre), mais capture désormais le jour.
- Vérifié qu'aucun autre endroit de l'app n'a ce défaut : seul `type="month"` restant dans
  tout le frontend est le sélecteur de période du tableau de bord comptable/clôture
  mensuelle (`comptabilite-view.tsx`), volontairement à la granularité du mois — établi
  explicitement plus tôt (recettes et clôture définies **par mois** par le DG), donc non
  concerné par cette remarque. `tsc`/`lint` propres.

### Ajustement demandé après validation — relevé de compteurs par immeuble

Sur retour (capture d'un tableur du cabinet), le vrai processus SONEB/SBEE est un **relevé
de compteurs divisionnaires par immeuble** : un compteur principal (l'abonnement de la
régie), un décompteur par unité, un tarif unique appliqué à tous, et une **réconciliation**
« Total décompteur vs Compteur principal vs Différence » (parties communes / fuites / usage
bailleur). Le module Charges ne modélisait que la ligne par locataire.

**Décisions cadrées avec l'utilisateur** : différence **affichée avec notification** (jamais
refacturée automatiquement) ; sous-comptage **configurable par bien et par fluide** ;
réalisé maintenant, avant de finir l'étape 12.

**Schéma (`020_utility_readings.sql`)**
- `properties` + `{soneb,sbee}_submetered`, `{soneb,sbee}_unit_price`,
  `{soneb,sbee}_main_meter_number`, `{soneb,sbee}_account_number`.
- `utility_reading_batches` : un relevé = (immeuble, fluide, période). Porte l'index
  début/fin du **compteur principal**, le **montant de la facture** reçue, le `unit_price`
  figé à la création, statut `brouillon`/`valide`.
- `utility_readings` : une ligne par unité — index début (auto = fin du relevé validé
  précédent) / fin → consommation et montant calculés ; `lease_id` et `charge_id` figés à
  la validation.
- Les n° de décompteurs réutilisent `property_units.{soneb,sbee}_meter_number` (déjà là
  depuis 006) : une unité entre dans le relevé dès qu'elle a un n° pour ce fluide.

**Backend** — nouveau `routes/utilityReadings.js` (permission `charges`), monté à la racine
de `/api` :
- `PATCH /api/properties/:id/utility-config` (activation + tarif + compteur principal).
- `GET/POST /api/properties/:id/utility-batches`, `GET/PATCH/DELETE /api/utility-batches/:id`.
- `POST /api/utility-batches/:id/validate` : dans une transaction, génère une `utility_charge`
  (impayée) pour chaque unité **avec bail actif et montant > 0** ; verrouille le relevé. Les
  unités vacantes / sans compteur sont relevées mais non facturées (elles comptent dans le
  Total décompteur). Respecte la clôture comptable (`assertPeriodOpen`).
- `POST /api/utility-batches/:id/reopen` : supprime les factures générées **non payées** et
  repasse en brouillon ; refusé si une facture est payée ou si le mois est clôturé.
- Différence = `Compteur principal − Σ décompteurs` (unités **et** FCFA), jamais stockée ;
  alerte `high` si > 15 % (`DIFFERENCE_ALERT_PCT`), `negative` si Σ décompteurs > principal.
- `toPublicProperty` (properties.js) expose `utilityConfig`.

**Frontend**
- Fiche du Bien : carte **« Compteurs & fluides »** (activer SONEB/SBEE, tarif au m³/kWh,
  n° compteur principal, n° abonnement).
- `/espace/charges` → bouton **« Relevés par immeuble »** → `/espace/charges/releves`
  (choix de l'immeuble sous-compté + liste des relevés + « Nouveau relevé »).
- `/espace/charges/releve/[id]` : **grille type tableur** — ancien / nouvel index par unité
  (index précédent reporté automatiquement), conso + montant en direct, ligne **Compteur
  principal** (index + montant facture), pied **Total décompteur / Compteur / Différence**
  + bannière d'alerte. « Enregistrer le brouillon » / « Valider le relevé » (confirmation) /
  « Rouvrir » / « Supprimer ».
- L'ancien formulaire « Nouvelle charge » reste la voie normale pour un bien non sous-compté.

**Tests** (`backend/scripts/test-releve.js`, cabinets jetables — **38 OK / 0 KO**) :
- [x] Config SONEB (tarif 225) ; activer un fluide sans tarif → 400.
- [x] Création du relevé → lignes créées pour les 2 unités avec compteur (occupée + vacante),
  pas pour celle sans compteur ; index précédent = 0 ; tarif figé. Doublon période → 409.
- [x] Grille : U01 305→349 = 44 unités / 9900 FCFA ; U02 100→111 = 2475 ; **Total décompteur
  55 / 12 375**, **Compteur principal 1070 / 240 750**, **Différence 1015 / 228 375**,
  alerte `high`. Décompteurs > principal → alerte `negative`.
- [x] Validation → **1 facture générée** (U01 occupée), U02 vacante non facturée ; facture
  visible au registre des charges (impayée, 9900). Re-validation / modification d'un relevé
  validé → 409.
- [x] Réouverture → facture non payée supprimée, retour brouillon. Après paiement de la
  facture, réouverture → **409**.
- [x] Isolation multi-tenant : un autre cabinet ne peut ni lire le relevé, ni modifier la
  config, ni créer un relevé sur le bien → **404** partout.
- [x] `tsc --noEmit` et `npm run lint` (frontend, Next 15) → 0 erreur ; routes
  `/espace/charges/releves`, `/espace/charges/releve/:id`, fiche du bien → 200 sur le serveur
  de dev.

**Non vérifié dans cet environnement** : usage réel de la grille au navigateur (saisie des
index, recalcul en direct, bannière d'alerte, validation → factures) — à confirmer via
`npm run dev`.

---

## Étape 10 — Fonctionnalités transversales

**Objectif** : fonctionnalités qui traversent tous les modules métier plutôt que d'en
ajouter un nouveau — vue d'ensemble pour le DG, relance des impayés à l'échelle du
portefeuille, traçabilité globale des actions.

**Cadrage** : les maquettes de référence (`tableau_de_bord_dg`, `module_relances_whatsapp_impayes`)
prévoient une automatisation lourde et coûteuse (API WhatsApp Cloud payante, passerelle SMS
Bénin, moteur de règles d'automatisation, sommations huissier, simulateur de conversation).
Sur confirmation explicite de l'utilisateur (question posée, option MVP retenue), le
périmètre réel exclut toute intégration payante et se limite à trois briques, chacune
construite à partir des données déjà en base — sans nouvelle table pour le tableau de bord
ni le journal d'activité :

1. **Tableau de bord DG** — vue d'ensemble multi-modules (occupation du parc, plaintes en
   cours), composée avec les chiffres financiers déjà exposés par
   `GET /api/accounting/dashboard` (étape 8), sans dupliquer ce calcul.
2. **Centre de relance groupée** — tous les locataires en retard de loyer sur l'ensemble du
   portefeuille en une seule vue, avec un lien WhatsApp pré-rempli par dossier (généralise
   le bouton individuel de l'étape 4) — reste manuel, un clic par envoi, aucune API payante.
3. **Journal d'activité (DG)** — généralise le « Journal des suppressions » de l'étape 8 à
   toutes les actions tracées à travers les modules (créations, paiements, versements,
   plaintes, clôtures...).

### Backend

- **`services/rentTracking.js`** étendu : `monthsBetweenInclusive` (déplacée depuis
  `routes/accounting.js`) et nouvelle `listPortfolioArrears(tenantId)` — factorise la
  boucle de calcul des impayés locataires (bail par bail, via `computeArrears`) qui vivait
  seulement dans `GET /api/accounting/dashboard` ; retourne désormais aussi le téléphone et
  le bien/unité de chaque locataire en retard, nécessaires au centre de relance. Une seule
  source de vérité pour ce calcul, réutilisée par les deux endpoints ci-dessous.
- **`services/activity.js`** (nouveau) : `listDeletedEntries(tenantId)` — la logique du
  « Journal des suppressions » de l'étape 8, déplacée telle quelle depuis `routes/accounting.js`
  (`GET /deleted-entries` en devient un simple appelant) ; `listRecentActivity(tenantId, limit)`
  — interroge indépendamment (avec `LIMIT`, pas d'UNION SQL géant) les créations de
  locataires, propriétaires, biens, unités, baux, les paiements de loyer, versements
  propriétaires, dépenses, charges SONEB/SBEE, les plaintes signalées/résolues, les états
  des lieux d'entrée/sortie, les clôtures de mois, et les suppressions logiques
  (`listDeletedEntries`) — fusionne et trie tout par horodatage, tronque à `limit`.
- **`routes/accounting.js`** : nouvelle route `GET /arrears` (portefeuille complet des
  impayés — téléphone/bien/unité inclus), ouverte à `locataires` **ou** `comptabilite`
  (contrairement au reste du module, strictement `comptabilite`) — le centre de relance doit
  rester utilisable par un agent qui gère les locataires sans avoir accès à la comptabilité.
- **`routes/dashboard.js`** (nouveau, monté sur `/api/dashboard`) : **strictement DG**
  (`requireRole('dg')`, cohérent avec le cadrage « Supervision DG » de la maquette) —
  `GET /overview` (occupation du parc par statut d'unité, compteurs biens/propriétaires/
  locataires/baux actifs, plaintes ouvertes + 5 plus urgentes) et `GET /activity?limit=`
  (journal d'activité unifié).

### Frontend

- `lib/api/dashboard.ts` (nouveau) : `getDashboardOverview`, `listActivity`.
- `lib/api/accounting.ts` : `listPortfolioArrears` + type `PortfolioArrearsEntry`.
- `lib/validation/auth.ts` : `buildWhatsAppHref(phone, message)` extrait (était dupliqué
  inline dans `locataire-view.tsx`) ; `lib/utils.ts` : `buildRentReminderMessage(...)`
  extrait pour la même raison — même formulation de relance partout dans l'application,
  plus de risque de divergence entre la fiche locataire et le centre de relance groupée.
- `/espace/tableau-de-bord` (DG uniquement, `roles={["dg"]}`) : cartes de synthèse
  (occupation, baux actifs, portefeuille, loyers encaissés/impayés locataires/impayés
  SONEB-SBEE/solde net du mois en cours), plaintes en cours (5 plus urgentes, lien vers
  `/espace/plaintes`), accès rapides vers les deux autres briques et la comptabilité.
- `/espace/relances` (permission `locataires` **ou** `comptabilite`) : liste des locataires
  en retard, triable par la vue elle-même, bouton WhatsApp par ligne.
- `/espace/journal` (DG uniquement) : flux chronologique de l'activité, icône par type
  d'action, auteur et horodatage — pas de pagination serveur pour l'instant (limite à 100).
- `espace-header.tsx` : liens de navigation ajoutés — « Tableau de bord » et « Journal
  d'activité » (DG uniquement), « Relances » (`locataires` ou `comptabilite`).

### Hors périmètre (décision explicite de l'utilisateur)

API WhatsApp Cloud (envoi automatique sans action humaine), passerelle SMS Bénin, moteur de
règles d'automatisation (relance à J+3, alerte DG si silence...), sommations par huissier,
export de rapport mensuel PDF, filtres/tri/pagination avancés sur le journal d'activité et
le centre de relance (listes actuellement complètes, sans souci de volumétrie à ce stade).

### Tests effectués (tenant jetable, jamais sur les vraies données)

- [x] Jeu de données complet créé (propriétaire, bien, 2 unités, 2 locataires — un en
  retard de 4 mois/96 jours sans aucun paiement, un à jour du mois en cours —, dépense,
  plainte urgente, versement propriétaire) pour exercer les trois briques simultanément.
- [x] `GET /api/dashboard/overview` : occupation 100 % (2/2 unités louées), compteurs
  exacts (1 bien, 1 propriétaire, 2 locataires, 2 baux actifs), 1 plainte ouverte listée.
- [x] `GET /api/dashboard/activity` : les 12 actions créées apparaissent, triées du plus
  récent au plus ancien, chacune avec le bon type/libellé/auteur.
- [x] `GET /api/accounting/arrears` : locataire en retard correctement isolé (96 jours,
  4 mois dus, 160 000 FCFA = 4 × 40 000), locataire à jour correctement absent ; total
  exactement identique à `tenantArrears` de `GET /api/accounting/dashboard` (non-régression
  du refactor de `listPortfolioArrears`).
- [x] Permissions vérifiées : `/api/dashboard/*` → 403 pour un comptable et un agent (DG
  uniquement) ; `/api/accounting/arrears` → 200 pour un comptable et un agent `locataires`,
  403 pour un agent `charges` seul.
- [x] Suppression d'une dépense avec justification → apparaît immédiatement dans
  `deleted-entries` **et** dans le journal d'activité unifié comme `expense_deleted`, même
  source de données (`listDeletedEntries`), pas de divergence.
- [x] Résolution d'une plainte → apparaît comme `complaint_resolved` dans le journal
  d'activité, et `openCount` de `/overview` repasse de 1 à 0.
- [x] Non-régression : `GET /api/accounting/dashboard` (étape 8) revérifié après le
  refactor de la boucle d'impayés — totaux et détail `tenantArrears` strictement identiques
  à avant, `GET /api/accounting/deleted-entries` (étape 8) revérifié après son déplacement
  vers `services/activity.js` — réponse identique.
- [x] `npx tsc --noEmit -p .` et `npm run lint` (frontend) → aucune erreur ; les deux
  serveurs de dev restent opérationnels après chaque étape.
- [x] Tenant nettoyé ; tenant réel (`KIko Store`, id 8) revérifié après coup : compteurs
  identiques à la baseline (aucune ligne de test n'a fui dessus), aucune régression.

### Ajustement demandé après validation — responsive du site + tableaux de bord « marquants »

Deux demandes : (1) mettre en place le responsive de l'application, (2) rendre les
tableaux de bord plus visuellement marquants — chaque carte chiffrée importante doit
porter une couleur qui change selon que sa valeur est favorable ou défavorable.

**Audit responsive** : les grilles/formulaires de l'application suivaient déjà
systématiquement le patron `grid-cols-1` en base + `sm:`/`lg:` pour élargir (marketing,
comptabilité, charges, plaintes, formulaires...), et `Table` encapsule déjà chaque tableau
dans un conteneur `overflow-x-auto` (défilement horizontal automatique, sans changement).
Le point de rupture réel, sévère et confirmé : **`EspaceHeader`** (en-tête de tout l'espace
connecté) cachait entièrement sa navigation sous `md` (768px) — `hidden md:flex` — sans
aucun repli mobile. Sous cette largeur, un utilisateur ne pouvait littéralement naviguer
nulle part (seuls le logo et « Se déconnecter » restaient accessibles). Avec l'ajout de 3
liens à l'étape 10 (jusqu'à 10 liens pour un DG), le seuil `md` devenait de toute façon trop
étroit pour un affichage en ligne.

- `components/espace/espace-header.tsx` réécrit : navigation en ligne repoussée à `lg`
  (1024px) ; en dessous, tiroir mobile (bouton hamburger, `Menu`/`X`) sur le même gabarit
  que `SiteHeader` (marketing, déjà existant et déjà responsive) — liens de nav, badge de
  rôle, réglages (DG) et déconnexion y basculent tous. Seuls logo + indicateur de connexion
  permanent (exigence de l'étape 0) restent visibles dans la barre compacte à toute largeur.
  Tiroir scrollable (`max-h-[calc(100dvh-topbar)]`) pour rester utilisable même avec 10 liens
  sur un petit écran en hauteur.
- Vérifié qu'aucune autre page ne partage ce défaut : marketing (landing) déjà entièrement
  responsive (grilles + `SiteHeader` avec tiroir), tableaux déjà protégés par `Table`,
  formulaires déjà en `grid-cols-1 sm:grid-cols-2`.

**Tableaux de bord marquants** : `components/ui/stat-card.tsx` étendu — `tone` ne colore
plus seulement le chiffre mais toute la carte (fond + bordure + puce d'icône, tokens
`success`/`warning`/`danger`/`info` de la charte, toujours combinés à icône + libellé,
jamais la couleur seule). Appliqué aux deux tableaux de bord existants avec une logique de
positivité propre à chaque indicateur (pas un simple seuil générique) :

- `/espace/comptabilite` (`DashboardCards`) : loyers encaissés = succès si > 0 ; versé aux
  propriétaires = info (ni bon ni mauvais, un flux normal) ; dépenses = attention si > 0 ;
  impayés SONEB/SBEE et impayés locataires = danger si count > 0, sinon succès (tout est à
  jour) ; solde net = succès/danger selon le signe.
- `/espace/tableau-de-bord` (DG) : taux d'occupation = succès ≥ 85 %, attention 50-84 %,
  danger en-deçà ; baux actifs = succès si > 0 sinon attention ; portefeuille = info
  (décompte, sans jugement de valeur) ; mêmes règles qu'en comptabilité pour les indicateurs
  financiers du mois. La carte « Plaintes en cours » (liste, pas une tuile chiffrée) reprend
  aussi la teinte de son statut (bordure + icône + badge danger/succès) sans teinter tout le
  fond, pour garder la liste interne lisible.

### Hors périmètre (limites de cet environnement)

Vérification visuelle réelle (aucun navigateur headless disponible dans cet environnement,
comme noté depuis l'étape 0) — à confirmer par l'utilisateur via `npm run dev` en
redimensionnant la fenêtre, notamment le tiroir mobile de `EspaceHeader` et le rendu des
teintes de `StatCard` en clair. `tsc`/`lint` propres, toutes les pages sondées répondent 200
après les changements.

### Ajustement demandé après validation — clôture guidée par les échéances de loyer

Demande précise, en deux notions à ne pas confondre : (1) l'échéance de loyer d'un
locataire (`rent_due_day`, propre à chaque bail) sert **uniquement** à calculer son propre
retard — rien à voir avec la période comptable. (2) La clôture d'un mois ne doit plus être
une date choisie à l'aveugle : le système regarde automatiquement l'échéance la plus
tardive des baux actifs de ce mois, y ajoute une marge de sécurité, et ne propose la
clôture comme sûre qu'à partir de là. Trois états : **Ouverte** (trop tôt), **Clôturable**
(toutes les échéances connues sont passées), **Clôturée** (verrouillée, comme avant). Le DG
garde la possibilité de clôturer plus tôt (gestion humaine réelle) — le système ne bloque
pas, mais avertit clairement et trace que la clôture a été forcée. Les dépenses (y compris
les aménagements) ne changent pas : chaque écriture reste rattachée à la période où elle
est réellement enregistrée, exactement comme avant — aucune complexité ajoutée là.

- Migration `019_period_closability.sql` : `accounting_periods.forced` (BOOLEAN, défaut
  faux) — la seule donnée à stocker ; la clôturabilité elle-même n'est jamais stockée,
  seulement calculée à la demande à partir des baux (rien à tenir à jour).
- `services/accountingPeriods.js` : nouvelle `getPeriodClosability(tenantId, period)` —
  sélectionne les baux qui chevauchent le mois (`start_date <= fin de mois` ET (`end_date`
  NULL ou `>= début de mois`), pas seulement les baux actifs aujourd'hui, pour aussi
  couvrir la clôture d'un mois passé), prend le `MAX(rent_due_day)`, ajoute une marge fixe
  de 5 jours (`CLOSABLE_MARGIN_DAYS`, non exposée en réglage pour l'instant) pour obtenir
  `closableFrom`, et liste séparément les baux dont l'échéance de ce mois précis n'est pas
  encore passée (`pendingLeases`, sans la marge — sert à l'avertissement). Sans bail
  chevauchant le mois, rien ne bloque : clôturable dès le premier jour.
- `routes/accounting.js` :
  - `GET /dashboard` étendu : `closedInfo.forced` (mois déjà clôturé) et, pour un mois pas
    encore clôturé, `closability: { status: 'open'|'closable', closableFrom, maxDueDay,
    pendingLeases }`.
  - `GET /periods` (historique) : chaque entrée porte désormais `forced`.
  - `POST /periods` : `force` optionnel (`closePeriodSchema`). Si le mois n'est pas encore
    clôturable et `force` absent → **409** explicite avec le détail nécessaire à
    l'avertissement (`closableFrom`, `maxDueDay`, `pendingLeases`) — la clôture anticipée
    n'est donc jamais silencieuse. Avec `force: true`, la clôture est acceptée et
    enregistrée avec `forced = 1`. Toujours strictement DG (`requireRole('dg')`, inchangé).
- Frontend : `ClotureBanner` (`comptabilite-view.tsx`) entièrement revu — trois rendus
  distincts : mois clôturé (badge « Clôture anticipée » si `forced`), mois clôturable
  (flux de confirmation en deux temps inchangé, sans `force`), mois pas encore clôturable
  (carte teintée `warning`, explique l'échéance la plus tardive et la date de clôturabilité,
  liste les locataires en attente s'il y en a, bouton distinct « Forcer la clôture
  maintenant » avec sa propre confirmation). Historique des clôtures : badge « Clôture
  anticipée » sur les entrées `forced`. Lecture seule (non-DG) : message adapté selon le
  statut. `lib/api/accounting.ts` : nouveau type `PeriodClosability`, `closePeriod` accepte
  un paramètre `force` optionnel, `AccountingPeriod`/`closedInfo` portent `forced`.
- Testé sur tenant jetable : un même bail (échéance le 10, actif depuis juin) donne
  correctement deux statuts différents selon le mois observé — septembre (mois courant) →
  `open`, clôturable à partir du 15, ce locataire listé en attente ; août (entièrement
  passé) → `closable`, aucun locataire en attente. Clôture de septembre sans `force` → 409
  avec le détail exact ; avec `force: true` → 201 `{forced: true}`, visible ensuite dans
  `GET /periods` et dans `closedInfo.forced` du tableau de bord. Clôture normale d'août
  (clôturable) → 201 `{forced: false}`. Non-régression : le blocage des écritures sur un
  mois déjà clôturé fonctionne identiquement qu'il ait été forcé ou non. Permissions
  inchangées : un comptable ne peut toujours pas clôturer, même avec `force: true` (403).
  Double clôture d'un mois déjà clôturé → toujours 409 « déjà clôturé ». Mois sans aucun
  bail chevauchant (2020-01) → immédiatement clôturable. Tenant nettoyé ; tenant réel
  (`KIko Store`, id 8) revérifié inchangé — sa clôture réelle de septembre, déjà posée
  avant cette fonctionnalité, porte bien `forced = 0` par défaut (rétrocompatibilité de la
  migration confirmée).

### Ajustement demandé après validation — palette du tableau de bord

Retour utilisateur sur le rendu des `StatCard` : couleurs plus frappantes mais
professionnelles, strictement vert/jaune/rouge (pas de bleu), opacité réduite.

- `components/ui/stat-card.tsx` : le fond plein pastel (`bg-success-bg`...) remplacé par un
  fond à opacité réduite de la couleur du statut (`bg-success/10`, etc.) et la puce d'icône
  passe en plein contraste (`bg-success text-white`) — le point de « punch » de la carte,
  plutôt qu'un aplat qui devenait criard une fois 6 tuiles côte à côte.
- Les deux seuls usages de `tone="info"` (bleu) sur les tableaux de bord — « Versé aux
  propriétaires » et « Portefeuille », jusque-là neutres/informatifs — repassent en
  `success` (versement effectué / patrimoine géré = signe de bonne santé opérationnelle),
  pour que la palette des deux tableaux de bord reste strictement vert/jaune/rouge.
  `tone="info"` reste disponible dans le composant pour un usage hors dashboard.
  Cohérence appliquée aussi à la carte « Plaintes en cours » (DG) et aux encarts
  « Impayés locataires » / « Charges impayées » / bandeau de clôture (comptabilité) :
  même recette (fond à faible opacité + puce d'icône pleine couleur).
- `docs/charte-graphique.md` mis à jour avec la recette retenue.
- Vérifié : `tsc`/`lint` propres, les deux tableaux de bord répondent 200 après les
  changements.

---

## Étape 11 — Mode hors-ligne (lecture + file d'écriture limitée)

**Objectif** : le socle PWA (étape 0) annonçait déjà une vraie file de synchronisation
IndexedDB↔MySQL avec gestion des conflits. Pour une application qui touche à l'argent
(codes auto-générés côté serveur, clôture mensuelle, permissions), une synchronisation
bidirectionnelle complète est un chantier d'ampleur avec de vrais risques d'intégrité —
periode cadrée explicitement avec l'utilisateur (question posée, option retenue) :

1. **Lecture hors-ligne** : les pages déjà visitées (locataires, propriétaires, biens,
   tableaux de bord...) restent consultables sans connexion.
2. **File d'écriture limitée à une liste blanche explicite** : seuls le paiement de loyer
   et le signalement d'une plainte peuvent être mis en attente hors-ligne et rejoués
   automatiquement au retour du réseau — avec échec explicite (jamais de résolution
   automatique silencieuse) si le serveur les refuse ensuite (mois clôturé entre-temps,
   bail terminé...).
3. **Tout ce qui crée une entité à code auto-généré** (bien, locataire/bail, propriétaire,
   employé, charge SONEB/SBEE) **reste bloqué hors-ligne** : ces codes ne peuvent être
   attribués que par le serveur, impossible à faire sans risque de collision.

### Backend

Aucun changement — décision assumée : la file d'attente rejoue exactement les mêmes
requêtes que le flux en ligne (`POST /api/leases/:id/payments`, `POST /api/complaints`),
contre la même validation serveur (permissions, clôture de période...). Un échec au moment
du rejeu est donc un vrai refus serveur, pas un raccourci côté client.

### Frontend

- **`lib/offline/db.ts`** (nouveau) : petite couche IndexedDB sans dépendance externe (deux
  magasins — `getCache` pour les lectures, `mutationQueue` pour les écritures en attente) ;
  `clearOfflineData()` vide les deux à la déconnexion (poste potentiellement partagé entre
  employés — le cache n'est pas cloisonné par utilisateur, donc tout est effacé plutôt que
  risquer qu'il reste consultable par le suivant).
- **`lib/offline/queue.ts`** (nouveau) : moteur de synchronisation — `enqueueMutation`,
  `processQueue` (rejoue dans l'ordre, s'arrête au premier échec réseau, continue après un
  échec applicatif en le marquant `failed` avec le message exact du serveur),
  `retryQueueItem`/`discardQueueItem` (action manuelle sur un échec), `subscribeQueue`
  (pub/sub pour que l'UI reste réactive sans prop drilling), `startQueueAutoSync` (rejoue
  au retour de l'événement `online`).
- **`lib/api/client.ts`** (`apiFetch`) : chaque **lecture** (GET) réussie est mise en cache
  (IndexedDB, clé = URL complète) ; si le réseau est injoignable, sert la dernière réponse
  connue au lieu d'une page en erreur. Les écritures ne sont ni cachées ni rejouées ici —
  seule la liste blanche explicite passe par la file dédiée, à l'appel de chaque fonction
  concernée (pas un comportement générique pour toutes les mutations, décision de sécurité
  explicite).
- **`lib/api/renters.ts`** (`createPayment`) et **`lib/api/complaints.ts`**
  (`createComplaint`) : nouveau type de retour `{ queued: boolean, ... }` — en cas d'échec
  réseau (`isNetworkError`, jamais une vraie erreur applicative), la mutation part en file
  au lieu d'échouer, et la fonction renvoie `queued: true` avec des identifiants `null` (pas
  de quittance/code réel tant que ce n'est pas synchronisé). Les plaintes hors-ligne partent
  sans photo (pas de support de fichiers dans la file JSON) — à ajouter après coup si besoin.
- **`components/system/connection-indicator.tsx`** : l'indicateur permanent (étape 0)
  devient cliquable dès qu'il y a des éléments en file — panneau listant chaque action
  (type, résumé, statut), avec Réessayer/Abandonner sur les échecs et un bouton
  « Synchroniser maintenant ».
- **`components/system/offline-notice.tsx`** (nouveau) + **`lib/offline/use-online-status.ts`**
  (nouveau hook) : bandeau + désactivation du bouton d'envoi, appliqués aux 5 formulaires de
  création à code auto-généré (`biens/nouveau`, `locataires/nouveau`, `proprietaires/nouveau`,
  `employes/nouveau`, `charges/nouveau`).
- `PaymentRegister` (fiche locataire) et `plaintes/nouveau` : gèrent le retour `queued` —
  bandeau explicite (« sera synchronisé automatiquement... pas encore de quittance/dossier
  réel »), pas de tentative d'ouvrir un PDF ou de naviguer vers une fiche qui n'existe pas
  encore côté serveur.
- `EspaceHeader` : démarre `startQueueAutoSync` (un seul point d'entrée, monté sur toutes
  les pages connectées) ; la déconnexion avertit explicitement si des actions ne sont pas
  encore synchronisées (perdues sinon, puisque le cache est vidé) avant de continuer.
- `public/sw.js` : commentaires mis à jour (le service worker ne touche jamais aux données
  métier ni à la file — tout vit côté application dans `lib/offline/`, cohérent avec son
  rôle déjà limité au shell applicatif depuis l'étape 0).

### Hors périmètre (décision explicite de l'utilisateur)

Synchronisation bidirectionnelle complète (création de fiches hors-ligne), résolution
automatique de conflits, pièces jointes dans la file d'écriture, scission du cache par
utilisateur sur un poste partagé (le cache est entièrement vidé à la déconnexion à la
place), Background Sync API (rejeu uniquement sur l'événement `online` + au chargement).

### Tests effectués / limites de vérification

- [x] `npx tsc --noEmit -p .` et `npm run lint` → aucune erreur après chaque étape du
  chantier (couche IndexedDB, câblage `apiFetch`, 5 formulaires bloqués, indicateur revu).
- [x] Toutes les pages touchées répondent 200 sur le serveur de dev (`/espace/locataires/:id`,
  `/espace/plaintes`, `/espace/plaintes/nouveau`, les 5 pages `nouveau/`) — pas de crash
  serveur/hydratation après les changements.
- [x] Backend non modifié : les routes rejouées par la file (`POST .../payments`,
  `POST /api/complaints`) restent exactement celles déjà testées de bout en bout aux
  étapes 4 et 7 — aucune régression possible côté serveur par construction.
- [x] Relecture manuelle ligne à ligne des chemins critiques (ordre de rejeu FIFO, arrêt sur
  échec réseau vs poursuite sur échec applicatif, non-réentrance de `processQueue`, gel de
  la file en cas de coupure côté file d'attente déconnexion).
- [x] **Vérifié au navigateur (2026-09-10)** — voir « Validation navigateur » ci-dessous.

### Validation navigateur (2026-09-10)

Firefox 155 headless piloté par WebDriver (`selenium-webdriver` + `geckodriver`) — un
navigateur automatisable est enfin disponible dans l'environnement. Scénario de bout en
bout sur un **tenant jetable** créé via `/inscription` (1 bien / 1 unité / 1 locataire /
1 bail), supprimé en cascade à la fin ; **données réelles (`KIko Store`, tenant 8)
vérifiées strictement inchangées avant/après** (comptes de lignes identiques sur renters,
leases, rent_payments, receipts, complaints, properties, property_units, owners, users).
Coupure réseau simulée par interception de `window.fetch` vers l'API + `navigator.onLine`
+ événements `online`/`offline` — exerce exactement les mêmes chemins que le code
(`isNetworkError`, file IndexedDB, rejeu sur `online`). **34/34 vérifications** :

- [x] Inscription réelle (formulaire, Next 15) → redirection `/espace`.
- [x] Bascule hors-ligne : `navigator.onLine=false`, l'indicateur passe à « Hors-ligne ».
- [x] **Lecture hors-ligne** : `/espace/locataires` reste consultable sans réseau (cache
  IndexedDB des GET peuplé pendant la navigation en ligne).
- [x] **Paiement de loyer hors-ligne** : bandeau « enregistré hors-ligne… », badge
  « Hors-ligne · 1 en attente », entrée `pending` dans `mutationQueue`.
- [x] **Plainte hors-ligne** : bandeau dédié, badge « 2 en attente », panneau de la file
  (clic sur l'indicateur) listant paiement + plainte « En attente » avec leur résumé.
- [x] **Création à code auto-généré bloquée hors-ligne** : bandeau `OfflineNotice` +
  bouton d'envoi désactivé sur les 5 formulaires `nouveau/` (biens, propriétaires,
  employés, charges, locataires).
- [x] **Déconnexion avec file non vide** : `window.confirm` d'avertissement affiché
  (« … n'ont pas encore été synchronisées… »), refus ⇒ session conservée, file intacte.
- [x] **Retour du réseau** : `startQueueAutoSync` rejoue la file sur l'événement `online`,
  `mutationQueue` vidée, indicateur repassé à « En ligne ».
- [x] **Vérification serveur** : le paiement rejoué existe en base avec sa quittance
  (`QT-2026-0001`) ; la plainte rejouée existe avec son code auto (`INC-2026-0001`).

### Bug trouvé et corrigé pendant la validation — rejeu des plaintes hors-ligne (400)

Le rejeu d'une plainte mise en file échouait systématiquement (`400 Formulaire invalide`,
marquée `failed` dans le panneau, jamais synchronisée). Cause : `lib/api/complaints.ts`
mettait en file `description: rest.description ?? null` et `reportedAt: rest.reportedAt ?? null`,
or `createComplaintSchema` (serveur) n'accepte pour ces champs optionnels que `undefined`
ou `''` — **jamais `null`**. Le chemin en ligne (FormData) n'ajoute simplement pas les
champs vides, donc ne rencontrait pas le problème. Corrigé : le corps mis en file **omet**
les champs optionnels vides, exactement comme le POST en ligne. Re-testé de bout en bout
(paiement **et** plainte rejoués avec succès au retour du réseau). Le paiement de loyer,
lui, n'était pas affecté (`createPayment` met en file `input` tel quel, `notes` absent si
vide).

### Observation mineure (cosmétique, non bloquante)

À largeur ~1400 px, quand l'indicateur affiche « Hors-ligne · N en attente », le libellé
peut passer sur plusieurs lignes et déborder légèrement au-dessus de l'en-tête ; la barre
de navigation (10 liens) est par ailleurs tronquée à droite (déjà noté à l'étape 10 pour
le responsive). Sans effet fonctionnel — à traiter avec la passe responsive.

---

## Étape 12a — Sécurité & audit (durcissement)

**Objectif** : traiter les dettes de sécurité accumulées (notées aux étapes 2 et 12) et
durcir la configuration avant la mise en production. Ne touche pas au périmètre
fonctionnel — audit + configuration uniquement.

**Critère de validation** : `npm audit` propre des deux côtés, `tsc`/`lint`/`build`
frontend OK, parcours d'auth inchangé au navigateur, le durcissement (limiteurs, en-têtes)
n'empêche aucun usage légitime.

### Audit — état des lieux (constaté avant intervention)

- **Requêtes SQL** : 100 % paramétrées sur tous les routeurs. Les fragments dynamiques
  (`UPDATE … SET`, clauses `WHERE`) sont assemblés à partir de chaînes en dur + params
  nommés ; aucune donnée utilisateur n'atteint un identifiant SQL. **Aucune surface
  d'injection.**
- **Auth déjà solide** : bcrypt rounds 12, JWT access 15 min + refresh 7 j avec rotation
  et détection de rejeu, cookie refresh `httpOnly` + `secure` (prod) + `sameSite=lax` +
  `path=/api/auth`, messages génériques (pas d'énumération de comptes), compte désactivé
  bloqué à la connexion, isolation `tenant_id` sur chaque table **et** chaque requête.
- **CSRF** : toutes les mutations passent par l'en-tête `Authorization: Bearer` (jamais par
  un cookie) → non exploitables en CSRF. Seuls `/api/auth/refresh` (rotation +
  `sameSite=lax`) et `/logout` utilisent le cookie. **Mitigation jugée adéquate pour le
  modèle de menace — documentée et actée, pas de jeton CSRF ajouté.**

### Backend — corrections

- **Dépendances** : `qs` (transitif via Express 4) était en version vulnérable
  (2 CVE modérées). Résolu par un `overrides` `qs@^6.16.0` dans `package.json` — **sans
  monter Express en v5** (migration majeure reportée en tâche dédiée). `npm audit` →
  **0 vulnérabilité**.
- **Limiteurs d'authentification** (`routes/auth.js`) : l'unique `authLimiter` (20 req/
  15 min par IP, tous usages confondus, succès compris) est remplacé par des compteurs
  séparés :
  - `loginLimiter` (`/login`, `/login-employee`) : 10/15 min, **`skipSuccessfulRequests`**
    — seuls les échecs comptent. Un cabinet accède à Internet derrière **une seule IP
    publique** (NAT) : sans ça, plusieurs employés qui se connectent le matin épuisaient
    le quota.
  - `registerLimiter` (`/register`) : 10/heure.
  - `changePasswordLimiter` : 10/15 min, `skipSuccessfulRequests`.
  - `refreshLimiter` (`/refresh`) : 120/15 min (le SPA rafraîchit à chaque chargement et
    à chaque 401) — n'existait pas, `/refresh` n'était couvert que par le limiteur global.
- **Ralentisseur par compte** (`middleware/loginThrottle.js`, nouveau) : en plus du
  limiteur par IP, compte les échecs **par identifiant** (téléphone du DG / identifiant
  employé) ; au-delà de 8 échecs en 15 min, l'identifiant est bloqué 15 min (429). État en
  mémoire du process (remis à zéro au redéploiement, non partagé entre instances —
  suffisant pour le déploiement mono-instance de 12b ; version persistante sur `users` =
  évolution notée). Compromis assumé : un attaquant peut provoquer un blocage temporaire
  ciblé, mais 8 essais/15 min rend le brute-force d'un mot de passe conforme (10+ car.,
  4 classes) irréaliste.
- **Journal d'accès en production** (`app.js`) : `morgan` n'écrivait qu'en dev. Ajout d'un
  format `combined` routé vers le logger structuré en prod (capté sur stdout par
  Docker/agrégateur) — nécessaire à l'audit et au forensic.
- **HSTS explicite** (`middleware/security.js`) : `max-age` 2 ans + `includeSubDomains` +
  `preload` (au lieu du défaut helmet de 180 j sans preload). Sans effet en HTTP local,
  honoré dès le reverse-proxy TLS de 12b.
- **`/uploads`** (`app.js`) : en-tête `Cross-Origin-Resource-Policy: cross-origin` sur les
  fichiers statiques (logos, cachets, signatures) — chargés en `<img>` par le front,
  potentiellement depuis un autre sous-domaine (`app.` / `api.`) en prod.
- **Secret JWT** (`config/env.js`) : minimum relevé de 16 à **32 caractères** en prod
  (refus au démarrage sinon). `.env.example` mis à jour (secrets distincts, 32 car. min).

### Frontend — corrections

- **`next` 14.2.15 → 15.5.25** (React 18 conservé — `15.5` l'accepte encore). Motif : au
  10/09/2026, **toute la branche Next 14.x est vulnérable** (22 advisories dont 1 *critical*
  + 2 RCE — image AVIF, hôte Windows) ; aucun correctif hors `≥ 15.5.24` / `16.x`. Surface
  de migration réelle **minime** pour ce projet : aucun `next/headers`/`cookies()`/
  `headers()`, aucun `params`/`searchParams` lu côté serveur (hooks client partout), pas
  de `next/image`, pas de middleware, `viewport` et `next/font` déjà au format moderne.
- **`postcss`** : la copie vendue par Next (`8.4.31`, pin exact) restait vulnérable (4 CVE
  high, exploitation build-time sur CSS attaquant — pratiquement nul ici, mais signalé).
  Résolu par `overrides` `postcss@^8.5.28` + alignement de la dépendance directe.
  **`npm audit` frontend → 0 vulnérabilité.**
- **`eslint-config-next` 14.2.15 → 15.5.25** (aligné sur Next). `next lint` déprécié en 15,
  supprimé en 16 : migration vers l'ESLint CLI notée pour un futur passage à Next 16.
- **CSP** (`next.config.mjs`) : ajout d'une `Content-Security-Policy` **en production
  uniquement** (le rechargement à chaud et l'API http nu la casseraient en dev) —
  `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `object-src 'none'`, `img-src`/`connect-src` limités à `'self'` + l'origine de l'API
  (dérivée de `NEXT_PUBLIC_API_URL`), `upgrade-insecure-requests` **seulement si l'API est
  en `https://`** (sinon `next start` local contre une API `http://localhost` échouerait).
  `script-src`/`style-src` gardent `'unsafe-inline'` (Next injecte des scripts/styles
  inline sans nonce) — passage à une CSP à nonce noté comme évolution.
- **HSTS** ajouté aux en-têtes Next (mêmes valeurs que l'API).
- **`output: "standalone"` + `outputFileTracingRoot: __dirname`** (`next.config.mjs`) : le
  dépôt a plusieurs `package-lock.json` (racine + backend + frontend, + un
  `~/package-lock.json` parasite) et Next 15 remontait trop haut pour choisir la racine de
  traçage — fixée sur le dossier frontend (appli autonome). La sortie `standalone` alimente
  l'image Docker de 12b.
- **`tsconfig.json`** : `target: "ES2017"` ajouté (valeur recommandée par Next 15, pour le
  top-level await).

### Tests effectués

- [x] `npm audit` **backend → 0 vulnérabilité** ; **frontend → 0 vulnérabilité**.
- [x] Backend démarré sur un port jetable : `GET /api/health` → 200 ; 8 tentatives de
  connexion à mauvais mot de passe → 401, **9ᵉ → 429** (ralentisseur par compte armé),
  le `loginLimiter` prend le relais ensuite. Aucun plantage.
- [x] Serveur de dev de l'utilisateur (nodemon) rechargé automatiquement après les
  modifications backend : `GET /api/health` → 200, `POST /api/auth/refresh` sans cookie
  → 401 (limiteur `/refresh` ne bloque aucune requête légitime).
- [x] `npx tsc --noEmit -p .` (frontend, Next 15.5.25 + React 18) → **0 erreur**.
- [x] `npm run lint` (frontend) → **0 avertissement / erreur** (hors note de dépréciation
  `next lint`).
- [x] Les deux serveurs `next dev` ont rechargé sur `next-server v15.5.25` sans planter ;
  `/`, `/connexion`, `/inscription`, `/espace`, `/manifest.webmanifest`, `/sw.js` → 200,
  `/connexion` rend bien son contenu (pas d'« Application error »).

### Non vérifié dans cet environnement

- **`next build` de production** et **parcours réel au navigateur** après le passage à
  Next 15 (inscription, connexion DG + employé, changement de mot de passe forcé, ouverture
  des PDF, PWA/service worker, CSP prod). À confirmer par l'utilisateur : `npm run build`
  puis `npm start`, et un tour complet de l'application.
- Effet réel de la CSP de production (n'est émise que sous `NODE_ENV=production`).

### Test d'intrusion (batterie complète) — `backend/scripts/pentest.js`

Harnais automatisé (boîte grise, cabinets jetables supprimés après, données réelles jamais
touchées). Détail complet : `docs/AUDIT-INTRUSION.md`.

Initial : **167 OK · 2 FAIL · 4 WARN** → 6 trouvailles. Après corrections : **172 OK · 0 FAIL · 1 WARN**
(le WARN restant = #6, acceptée). Détail : `docs/AUDIT-INTRUSION.md` § « Corrections appliquées ».

| # | Sévérité | Trouvaille | État |
|---|---|---|---|
| 1 | 🟠 Moyenne | Cachet & signature (`/uploads/tenants/<id-séquentiel>/…`) accessibles **sans auth** — énumérables | ✅ noms de fichiers aléatoires (chemin prévisible → 404) |
| 2 | 🟡 Faible-moy. | Doublons de paiement de loyer possibles en concurrence | ✅ `SELECT … FOR UPDATE` + garde anti-doublon < 2 min (versements partiels préservés) |
| 3 | 🟡 Faible-moy. | Pas de borne haute sur les montants → `"1e12"` → **500** | ✅ `.max()` sur les 4 schémas de montant → 400 propre |
| 4 | 🟢 Faible | Upload validé sur le `Content-Type` client (pas d'octets magiques) | ✅ contrôle des octets magiques sur les 5 routes d'upload |
| 5 | 🟢 Faible | `jwt.verify` sans allowlist `algorithms` (HS512 accepté) | ✅ `algorithms: ['HS256']` |
| 6 | 🟢 Faible (accepté) | Access token valide ≤ 15 min après désactivation d'un employé | 📝 documenté comme risque assumé (refresh révoqué immédiatement) |

**Confirmé solide** : isolation multi-tenant (35+ IDOR → 404 partout), falsification JWT
(tous rejetés), autorisation par rôle/permission, injection SQL (paramétrage intégral),
traversée de chemin, prototype pollution, limites de corps/JSON/`qs`, CORS, rate-limiting,
clôture comptable, en-têtes, non-fuite de stack.

### Dette restante (tâches dédiées, hors 12)

- **Express 4 → 5** : `qs` est corrigé par override ; la montée d'Express reste à planifier
  (breaking changes de routage — aucun motif à risque dans le code actuel, mais à tester).
- **Next 15 → 16** : `next lint` à migrer vers l'ESLint CLI, React 19 à évaluer.
- **CSP à nonce** (retirer `'unsafe-inline'` de `script-src`/`style-src`).

---

## Étape 12b — Déploiement (VPS + Docker Compose)

**Objectif** : mise en production sur un VPS unique, tout en conteneurs, HTTPS automatique,
migrations jouées au démarrage, sauvegardes documentées. Option retenue explicitement avec
l'utilisateur (VPS + Docker Compose, plutôt que systemd nu ou PaaS).

**Critère de validation** : `docker compose -f compose.prod.yml up -d` sur un VPS avec DNS
configuré donne l'application accessible en HTTPS sur `app.` / `api.`, un compte entreprise
créable, et un redéploiement (`git pull` + `build` + `up -d`) qui rejoue les migrations
sans perte de données.

### Topologie

```
Internet ──443──▶ caddy ──▶ web:3000   (APP_DOMAIN)
                        └─▶ api:4000   (API_DOMAIN)
                                 └──▶ db:3306   (réseau interne `backend`, non exposé)
```

Seul `caddy` publie des ports (80/443). `db` n'a aucun `ports:` et vit sur un réseau
`internal: true` — inatteignable depuis l'hôte et depuis `caddy`.

### Fichiers ajoutés

- **`backend/Dockerfile`** : `node:20-alpine`, 2 étages (`npm ci --omit=dev` puis runtime),
  exécution **non-root** (`USER node`), `tini` en PID 1, `HEALTHCHECK` sur `/api/health`.
- **`backend/docker-entrypoint.sh`** : joue `node src/db/migrate.js up` (idempotent via la
  table `_migrations`) **avant** `node src/server.js`. Échec de migration ⇒ le conteneur ne
  démarre pas (pas d'appli contre un schéma incohérent).
- **`frontend/Dockerfile`** : 3 étages, build `next build` en **sortie `standalone`**, image
  runtime minimale (`server.js` + `.next/static` + `public`), non-root, `tini`, healthcheck.
  `NEXT_PUBLIC_API_URL` passée en **`--build-arg`** (figée dans le bundle client).
- **`compose.prod.yml`** : `db` (MySQL 8, volume `db_data`, healthcheck `mysqladmin ping`),
  `api` (`depends_on: db healthy`, volume `uploads`), `web` (build-arg URL API), `caddy`
  (image officielle, volumes `caddy_data`/`caddy_config`, Caddyfile monté en lecture seule).
  Réseaux `edge` (public) / `backend` (`internal`). Toutes les valeurs viennent d'un `.env`
  racine ; variables obligatoires marquées `${VAR:?}` (échec explicite si absente).
- **`deploy/Caddyfile`** : HTTPS auto (Let's Encrypt, ligne staging commentée pour les
  tests), en-têtes de sécurité, `request_body max_size`, **`/_next/image` → 404** (l'appli
  n'utilise pas l'optimiseur d'images — neutralise la classe de CVE correspondante côté
  proxy quelle que soit la version de Next).
- **`deploy/backup-db.sh`** : `mysqldump --single-transaction` compressé + horodaté dans
  `backups/` (dans `.gitignore`), rotation 14 j, vérification d'intégrité du dump. Cron hôte
  documenté.
- **`.env.prod.example`** : gabarit des variables (domaines, URLs publiques, creds MySQL,
  secrets JWT) avec les commandes `openssl rand` associées.
- **`backend/.dockerignore`, `frontend/.dockerignore`** : excluent `node_modules`, `.next`,
  `.env`, `uploads/*`, `.git`…
- **`docs/DEPLOIEMENT.md`** : runbook complet (prérequis DNS/ports, première install, mises
  à jour, sauvegarde/restauration, exploitation, rappels sécurité, dépannage).

### Décisions

- **Reverse-proxy = Caddy** (HTTPS automatique sans certbot ni cron de renouvellement) plutôt
  que nginx + Let's Encrypt.
- **Deux sous-domaines** (`app.` / `api.`) plutôt qu'un domaine unique avec routage par
  préfixe — cohérent avec la config CORS/CORP de 12a, `Authorization: Bearer` sans souci de
  cookie cross-path.
- **Migrations à l'entrypoint** (et non un service one-shot séparé) : suffisant en
  mono-instance ; à externaliser si l'API est un jour répliquée.
- **`uploads` sur volume nommé** : les logos/cachets/signatures survivent aux redéploiements.
- **Utilisateur MySQL applicatif** : l'image officielle ne lui accorde `ALL PRIVILEGES` que
  sur la base `lyko_system` (aucun privilège global) — moindre privilège respecté, la
  migration DDL reste possible dans sa propre base.

### Tests effectués

- [x] `docker compose -f compose.prod.yml config` : rendu complet sans erreur, toute
  l'interpolation `${...}` résolue, réseaux/volumes/`depends_on` bien formés.
- [x] `sh -n` / `bash -n` sur `docker-entrypoint.sh` et `backup-db.sh` → OK.
- [x] `migrate.js` : sortie 0 en succès (via `closePool` dans `finally`), `exitCode = 1` en
  échec → compatible `set -e` de l'entrypoint.

### Non vérifié dans cet environnement

- **`docker compose build` / `up`** : le compte courant n'a pas accès au démon Docker ici
  (`permission denied … /var/run/docker.sock`). À exécuter par l'utilisateur sur le VPS (ou
  en local dans le groupe `docker`) : build des deux images, `up -d`, obtention des
  certificats Caddy, création d'un compte entreprise, puis un cycle `git pull` + rebuild +
  `up -d` pour confirmer le rejeu des migrations.
- Disposition exacte de `.next/standalone` (dépend de `next build`, non exécutable ici avec
  les serveurs de dev actifs) — le `Dockerfile` suit la disposition standard d'une sortie
  standalone à racine unique (`outputFileTracingRoot` = dossier frontend).

## Étape 13 — Fonctionnalités additionnelles (post-lancement)

Le cahier des charges initial (étapes 0 à 12b) est entièrement codé. Cette étape regroupe
des idées nouvelles, proposées après une revue des manques et brainstorm à la demande de
l'utilisateur, ajoutées une par une — même règle : codée → testée → validée avant la
suivante. Retenues jusqu'ici, dans l'ordre choisi par l'utilisateur : idée n°2 (portail
locataire), n°1 (portail propriétaire), n°4 (alertes prédictives de retard), n°10 (carte du
portefeuille). Idées n°3 et 5 à 9 restent en attente, non commencées (voir la liste en fin
d'étape).

### Portail locataire minimal (idée n°2)

**Objectif** : donner à chaque locataire un accès en libre-service à sa propre situation
— sans créer un compte employé pour un tiers externe à l'entreprise. Portée retenue avec
l'utilisateur (les 4 cases) : consulter ses paiements et télécharger ses quittances,
signaler lui-même une plainte/un incident, voir son solde/retard, télécharger son
attestation de loyer.

**Authentification** : lien privé unique, sans mot de passe (option choisie explicitement
face à un compte avec mot de passe) — un token de 256 bits dans l'URL identifie le
locataire. Même principe que les refresh tokens : seule l'empreinte SHA-256 est stockée
(`renters.portal_token_hash`), jamais le token en clair ; un token invalide ou révoqué
rend un **404 générique** (« Lien invalide ou expiré »), sans jamais distinguer un token
inconnu d'un locataire supprimé (pas d'énumération).

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/022_renter_portal.sql`** : `renters.portal_token_hash`
  (unique, nullable) ; `complaints.created_by` rendu nullable + `complaints.reported_via_portal`
  (une plainte déposée par le portail n'a pas d'auteur employé).
- **`backend/src/utils/tokens.js`** : `generatePortalToken()` (32 octets aléatoires,
  base64url).
- **`backend/src/middleware/portalAuth.js`** : `requirePortalToken` — vérifie l'empreinte du
  token du chemin, attache `req.portalRenter`, jamais de `requireAuth` employé.
- **`backend/src/validators/portal.js`**, **`backend/src/routes/portal.js`** : tableau de
  bord (identité, bail actif, retard, paiements+quittances), téléchargement de sa quittance
  et de son attestation, dépôt d'une plainte — limiteur de débit dédié (120/15 min/IP, en
  plus du token de 256 bits qui rend déjà le brute-force impraticable). Volontairement
  limité au **bail actif** (v1 : pas d'historique de baux antérieurs via le portail).
- **`backend/src/routes/renters.js`** : `POST /:id/portal-link` (DG/agent gérant les
  locataires) — (re)génère le token, ne le renvoie qu'une fois ; `toPublicRenter` expose
  seulement `hasPortalLink` (jamais le token/hash).
- **`backend/src/routes/index.js`** : montage de `/portal` — voir bug ci-dessous.
- **`backend/src/app.js`** : le token du portail est **redacté dans les journaux d'accès**
  (`morgan.token('url', ...)`), même logique que ne jamais logguer un mot de passe.
- **`backend/src/routes/complaints.js`**, **`backend/src/services/activity.js`** : une
  plainte déposée depuis le portail est marquée et libellée distinctement dans le fil
  d'activité de l'entreprise (« signalée par le locataire (portail) »).
- **`frontend/lib/api/portal.ts`** (nouveau) : client sans `accessToken` — le token du lien
  authentifie déjà, via l'URL.
- **`frontend/app/portail/[token]/`** (nouveau) : page publique, sans `RequireAuth` ni
  `EspaceHeader` — en-tête minimal (logo/nom de l'entreprise), tableau de bord, formulaire
  de signalement inline.
- **`frontend/lib/api/renters.ts`**, **`frontend/app/espace/locataires/[id]/locataire-view.tsx`** :
  carte « Portail locataire » sur la fiche — bouton Générer/Régénérer, révélation unique du
  lien (même schéma que les identifiants d'un nouvel employé), envoi direct par WhatsApp,
  avertissement que régénérer invalide l'ancien lien.

### Bug trouvé et corrigé — routeur non préfixé qui interceptait tout ce qui le suit

`router.use(utilityReadingRoutes)` (étape 9bis) est monté **sans préfixe** dans
`routes/index.js` — il matche donc n'importe quel chemin `/api/...`. Or sa toute première
ligne est `router.use(requireAuth, requirePermission('charges'))`, elle aussi sans chemin :
appliquée à **toute** requête qui l'atteint, avant même de vérifier si une route interne
correspond. Comme `/portal` était monté **après** lui, chaque appel à
`/api/portal/:token` traversait d'abord ce garde-fou employé et échouait en 401
(« Authentification requise ») — jamais atteint par `requirePortalToken`. Confirmé par
l'en-tête `RateLimit-Limit` de la réponse : `1000` (limiteur global) et non `120` (limiteur
propre à `routes/portal.js`), preuve que la requête n'était jamais entrée dans ce routeur.
Corrigé en montant `/portal` **avant** `utilityReadingRoutes` dans `routes/index.js`, avec
un commentaire expliquant le piège pour éviter de le reproduire.

### Tests effectués (navigateur + API, tenant réel KIko Store, données de test nettoyées après coup)

- [x] Génération du lien depuis la fiche locataire (DG) → token affiché une seule fois,
  bouton « Régénérer le lien » après une première génération, avertissement d'invalidation,
  envoi WhatsApp pré-rempli.
- [x] `GET /api/portal/:token` → tableau de bord complet (identité, bail actif, retard,
  paiements + quittances) avec les vraies données de Pélagie ZINSOU.
- [x] Token invalide/inexistant → 404 générique, aucune distinction avec un token révoqué.
- [x] Téléchargement de la quittance d'un paiement et de l'attestation de loyer → PDF valides.
- [x] Paiement inexistant sur ce bail → 404 (pas d'accès à un paiement d'un autre locataire).
- [x] Dépôt d'une plainte depuis le portail → `created_by = NULL`, `reported_via_portal = 1`,
  visible dans le fil d'activité avec le libellé dédié ; formulaire invalide → 400 détaillé.
- [x] Page `/portail/:token` en navigateur (Firefox headless) : rendu, téléchargement,
  dépôt de plainte avec message de confirmation, page d'erreur pour un token invalide.
- [x] `tsc --noEmit` et `next lint` sans erreur sur tous les fichiers touchés.

### Ajustement demandé après validation — lien généré automatiquement à la création (2026-09-12)

Demande de l'utilisateur : le lien du portail ne doit pas dépendre d'une action manuelle
séparée (le bouton « Générer le lien ») — il doit exister dès la création du locataire.

- `routes/renters.js` (`POST /`) : génère et enregistre le token du portail dans la même
  transaction que la création du locataire/bail (avant le `COMMIT`) — jamais de locataire
  sans lien. Réponse enrichie d'un `portalLink: { token, path }`, renvoyé une seule fois
  (comme un mot de passe temporaire), au même titre que `POST /:id/portal-link` (qui reste
  disponible pour régénérer plus tard si le lien est perdu/compromis).
- Frontend (`app/espace/locataires/nouveau/`) : après création, un écran de succès (calqué
  sur celui de la création d'un employé) affiche le lien une seule fois — copie, envoi
  WhatsApp pré-rempli, ou passage direct à la fiche — au lieu d'une redirection immédiate.
- Testé : script bout-en-bout sur cabinet jetable (vraie API HTTP — connexion DG, création
  du locataire, `portalLink` présent dans la réponse, hash stocké en base, tableau de bord
  et dépôt de plainte fonctionnels immédiatement avec ce token) — 9/9 ; puis en navigateur
  (Firefox headless, cabinet jetable) : écran de succès affiché avec le lien réel. Cabinet
  de test supprimé après coup, KIko Store non touché.

### Portail propriétaire (idée n°1)

Demandée après une nouvelle session de réflexion sur « ce qui reste pour que le projet soit
vraiment innovant » — choisie en premier (meilleur rapport valeur/effort : le calculateur de
recette et le relevé PDF existaient déjà, seul le mécanisme d'accès manquait).

**Objectif** : donner à chaque propriétaire un accès en libre-service à sa recette du mois,
sa commission, sa part, son patrimoine géré et l'historique de ses versements, sans appeler
le cabinet — même mécanique que le portail locataire (lien secret, sans mot de passe, sans
compte).

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/025_owner_portal.sql`** : `owners.portal_token_hash`
  (unique, nullable), même schéma que `renters.portal_token_hash` (022).
- **`backend/src/middleware/portalAuth.js`** : nouvelle `requireOwnerPortalToken`
  (parallèle à `requirePortalToken`), attache `req.portalOwner`.
- **`backend/src/routes/ownerPortal.js`** (nouveau) : `GET /:token?mois=` (tableau de bord —
  patrimoine, recette nette/commission/part par Bien **et** total portefeuille si plusieurs
  Biens, réutilise directement `getRecetteProprietaire` du service de commission existant,
  étape 5), `GET /:token/statement.pdf` (réutilise `streamOwnerStatementPdf`, déjà existant).
  Limiteur de débit dédié (120/15 min), monté **avant** le routeur non préfixé des relevés de
  compteurs dans `routes/index.js` (piège déjà documenté lors du portail locataire).
- **`backend/src/routes/owners.js`** : `POST /:id/portal-link` (DG/gestion propriétaires,
  scope agent respecté), `toPublicOwner` expose `hasPortalLink`.
- **`backend/src/app.js`** : redaction du token étendue aux deux portails
  (`/api/portal/`, `/api/owner-portal/`) dans les journaux d'accès.
- **`frontend/lib/api/ownerPortal.ts`** (nouveau), **`frontend/app/portail/proprietaire/[token]/`**
  (nouveau, page publique sans `RequireAuth`/`EspaceHeader`) : sélecteur de mois, carte
  « Total du portefeuille » (si plusieurs Biens), recette détaillée par Bien, unités avec
  locataire en cours, historique des versements, téléchargement du relevé.
- **`frontend/lib/api/owners.ts`**, **`proprietaire-view.tsx`** : carte « Portail
  propriétaire » (génération/régénération, révélation unique, envoi WhatsApp — grisé si le
  propriétaire n'a pas de téléphone renseigné, seul le portail locataire pouvait supposer
  un téléphone toujours présent).

### Tests effectués (API + navigateur, tenant réel KIko Store)

- [x] Génération du lien depuis la fiche propriétaire (DG) → token affiché une seule fois,
  « Régénérer le lien » après une première génération.
- [x] `GET /api/owner-portal/:token` (GBAGUIDI Rodrigue, propriétaire réel) → patrimoine,
  recette du mois correcte, **taux de commission historique respecté** (10 % pour septembre,
  alors que le taux actif aujourd'hui est 15 % depuis octobre — le calculateur existant
  applique bien le taux en vigueur au mois affiché, pas le taux courant).
- [x] `?mois=2026-08` → dépense de 15 000 FCFA rattachée au Bien correctement déduite de la
  recette nette.
- [x] Propriétaire avec 3 Biens (dont 2 sans loyer ce mois) → carte « Total du portefeuille »
  correctement agrégée, chaque Bien détaillé séparément en dessous.
- [x] Token invalide → 404 générique ; relevé PDF téléchargeable ; limiteur de débit propre
  (120, pas celui de l'employé) confirmant que le routeur est bien atteint.
- [x] `tsc --noEmit` et `next lint` sans erreur sur tous les fichiers touchés.

### Alertes prédictives de retard

Choisie ensuite dans la même liste (idée n°4) : relancer un locataire AVANT qu'il ne soit en
retard, pas seulement après — en s'appuyant sur son propre historique de paiement.

**Règle retenue** (aucune ne s'imposait, décision produit) : un bail est signalé si (1) il est
actuellement **à jour** (jamais un doublon avec le centre de relance réactif), (2) son
échéance à venir tombe dans les **5 prochains jours**, et (3) au moins **2 de ses 3 derniers
mois réellement payés** ont été réglés après leur propre échéance. Il faut au moins 2
paiements dans l'historique pour se prononcer — jamais d'alerte sur un locataire trop récent
faute de recul.

### Fichiers ajoutés/modifiés

- **`backend/src/services/rentTracking.js`** : `isPaymentLate(coversMonth, rentDueDay,
  paidAt)` (un paiement est-il arrivé après l'échéance de son propre mois ?) et
  `listPredictiveLateAlerts(tenantId, scopeAgentId, daysAhead)` — même structure que
  `listPortfolioArrears` déjà existant (même portée agent, étape 14), résultats triés par
  échéance la plus proche.
- **`backend/src/routes/accounting.js`** : `GET /predictive-alerts`, même permission que
  `/arrears` (`locataires` ou `comptabilite`).
- **`frontend/lib/api/accounting.ts`** : `PredictiveAlertEntry`, `listPredictiveAlerts`.
- **`frontend/lib/utils.ts`** : `buildPredictiveReminderMessage` — ton différent du rappel de
  retard existant (une échéance à venir, jamais « en retard »).
- **`frontend/app/espace/relances/relances-view.tsx`** : nouvelle section « Alertes
  prédictives » sous le centre de relance réactif existant, teinte orange (à surveiller, pas
  rouge/déjà grave), bouton « Relancer » WhatsApp dédié.

### Tests effectués (API + navigateur, cabinet jetable)

- [x] Locataire à échéance dans 3 jours, 2/2 derniers paiements en retard → correctement
  signalé, avec le bon décompte et la bonne échéance.
- [x] Locataire à échéance tout aussi proche, mais bon payeur (0/2 en retard) → correctement
  **pas** signalé.
- [x] Aucun des deux n'apparaît dans `/arrears` (tous deux à jour) → confirme l'absence de
  doublon entre réactif et prédictif.
- [x] Vérifié sur le vrai portefeuille KIko Store : résultat vide actuellement, mais examen
  bail par bail confirmant que c'est correct (aucun bail à jour n'a une échéance à moins de
  5 jours en ce moment) — pas un faux négatif.
- [x] Rendu en navigateur (Firefox headless, cabinet jetable) : section bien affichée,
  distincte visuellement du centre de relance réactif. `tsc --noEmit`/`next lint` propres.
- Cabinet de test supprimé après coup.

### Carte du portefeuille (idée n°10)

Choisie ensuite (dernière de la liste initiale — signalée comme la plus lourde, faute de
géocodage fiable au Bénin où l'adresse est souvent un simple nom de quartier en texte libre).

**Décision retenue** : pas de géocodage automatique de l'adresse (imprécis/payant pour des
adresses informelles) — placement **manuel** du repère GPS par le DG/agent, en cliquant sur
une carte OpenStreetMap (Leaflet, gratuit, sans clé API). Un Bien sans repère placé reste
normalement visible en liste ; la vue Carte l'exclut simplement et l'indique en toutes
lettres (jamais silencieusement absent).

**Lacune trouvée en construisant la fonctionnalité** : aucune fiche d'édition d'un Bien
existant n'existait côté frontend (`updateProperty` était défini dans le client API mais
jamais appelé) — impossible pour le DG d'ajouter un repère à l'un des 5 Biens déjà créés
sans elle. Comblée par une carte « Localisation » dédiée sur la fiche du Bien (schéma
identique à la carte « Compteurs & fluides » déjà existante : bouton Configurer/Modifier,
enregistrement via `PATCH /api/properties/:id`), plutôt qu'un formulaire d'édition complet
du Bien — hors du périmètre demandé.

**Bug non trivial trouvé et corrigé en testant dans le navigateur** : `react-leaflet`
(`<MapContainer>`) lève `Map container is already initialized.` dès le premier affichage,
uniquement en dev sous Next.js (React 18 + `reactStrictMode: true`, déjà actif dans
`next.config.mjs` pour tout le projet). Cause : le `mapRef` interne de `react-leaflet` est un
`useCallback` à dépendances vides — sa fermeture capture `context` (`null`) une fois pour
toutes ; si React ré-invoque ce callback sur le même nœud DOM (monté/démonté deux fois par
StrictMode, comportement volontaire de React 18 pour détecter les effets impurs), la
vérification `context === null` reste vraie même après une première initialisation réelle,
et `new L.Map()` explose sur un conteneur qui porte déjà `_leaflet_id` (confirmé en lisant
`node_modules/leaflet/dist/leaflet-src.js`, `Map.prototype._initContainer`). Corrigé en
n'utilisant **pas** `<MapContainer>` : `location-picker.tsx` et `portfolio-map.tsx` pilotent
Leaflet à la main dans un `useEffect` classique (`L.map()` au montage, `map.remove()` au
nettoyage) — un double montage/démontage StrictMode s'y comporte correctement puisque
`map.remove()` efface bien `_leaflet_id` avant le remontage suivant. `react-leaflet` retiré
des dépendances (devenu inutile).

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/026_property_coordinates.sql`** : `properties.latitude`
  (`DECIMAL(10,7)`), `properties.longitude` — nullables, jamais renseignées automatiquement.
- **`backend/src/validators/properties.js`** : `latitude`/`longitude` optionnelles sur
  création et modification, bornées (`[-90, 90]` / `[-180, 180]`), et un `refine` imposant
  qu'elles soient renseignées **ensemble** (jamais l'une sans l'autre).
- **`backend/src/routes/properties.js`** : `toPublicProperty` expose `latitude`/`longitude` ;
  `POST`/`PATCH /api/properties/:id` les acceptent (mêmes règles de portée agent que le reste
  du Bien).
- **`frontend/lib/map-icon.ts`** (nouveau) : repère en forme de goutte en CSS pur
  (`L.divIcon`) — évite de dépendre des images `marker-icon.png`/`marker-shadow.png` par
  défaut de Leaflet, dont l'URL ne se résout pas correctement une fois passées par le
  bundler de Next.js.
- **`frontend/components/properties/location-picker.tsx`** (nouveau) : carte cliquable pour
  placer/déplacer un repère (Leaflet impératif, voir le bug ci-dessus) — un seul marqueur,
  jamais dupliqué au clic suivant.
- **`frontend/components/properties/portfolio-map.tsx`** (nouveau) : un repère par Bien
  localisé, popup (code, propriétaire, adresse, lien vers la fiche) construit **via le DOM**
  (`createElement`/`textContent`, jamais une chaîne HTML interpolée) pour ne jamais injecter
  du HTML à partir d'un champ texte libre (adresse, nom du propriétaire).
- **`frontend/app/espace/biens/nouveau/nouveau-view.tsx`** : section « Localisation sur la
  carte (optionnel) » — bouton Placer/Modifier, carte affichée à la demande seulement (jamais
  chargée si le DG ne l'ouvre pas).
- **`frontend/app/espace/biens/[id]/bien-view.tsx`** : nouvelle carte « Localisation »
  (voir la lacune ci-dessus), même schéma d'édition que « Compteurs & fluides ».
- **`frontend/app/espace/biens/biens-view.tsx`** : bascule Liste/Carte ; la vue Carte indique
  en toutes lettres le nombre de Biens sans coordonnées (jamais silencieusement absents).
- Les trois composants important Leaflet sont chargés via `next/dynamic(..., { ssr: false })`
  (Leaflet accède à `window` au chargement du module — incompatible avec le rendu serveur).
- `frontend/package.json` : `leaflet` + `@types/leaflet` ; `react-leaflet` installé puis
  retiré (voir le bug ci-dessus).

### Tests effectués (API + navigateur, cabinet jetable)

- [x] Script API bout-en-bout : création d'un Bien avec coordonnées, création d'un second
  sans coordonnées puis `PATCH` pour les ajouter après coup, les deux bien exposés par
  `GET /api/properties` ensuite.
- [x] Validateur : latitude hors `[-90, 90]` → 400 ; latitude fournie sans longitude → 400
  (jamais l'une sans l'autre).
- [x] Navigateur (Firefox headless) : vue Carte affiche les repères réels avec tuiles
  OpenStreetMap chargées, popup correct au clic (code, propriétaire, adresse, lien) ;
  formulaire de création — ouverture de la carte, clic pour placer un repère (exactement un
  marqueur), second clic ailleurs (le repère se déplace, n'en crée pas un second), création
  du Bien de bout en bout jusqu'à la fiche affichant la carte « Localisation ».
- [x] `tsc --noEmit` et `next lint` sans erreur sur tous les fichiers touchés.
- Cabinets de test supprimés après coup ; les 7 Biens réels de KIko Store non touchés.

### Reste à faire (idées n°3, 5 à 9)

Non commencées, à la demande explicite (une idée à la fois) : assistant de clôture
mensuelle, score de fiabilité locataire, relances WhatsApp automatiques, envoi automatique
des quittances, fiche de vacance/relocation, vérification d'authenticité des attestations
(QR code), rappel de renouvellement de bail, carnet d'entretien préventif.

---

## Étape 14 — Attribution de Biens à un agent (portefeuille restreint)

Demande directe de l'utilisateur (pas une idée du brainstorm de l'étape 13) : « ajouter un
nombre donné de Biens à un agent pour la gestion ». Distincte des idées d'innovation
ci-dessus, donc sa propre étape plutôt qu'une sous-section de plus — c'est ainsi qu'elle est
nommée dans tout le code (`services/scope.js` et partout où la portée est appliquée).

**Objectif** : un agent peut être restreint à un sous-ensemble du portefeuille (les seuls
Biens qui lui sont attribués), en cascade sur tout ce qui en dépend — unités, locataires,
baux, paiements, plaintes, propriétaires.

**Décisions prises avec l'utilisateur avant codage** (question posée, car structurante) :
l'attribution **restreint réellement l'accès** de l'agent (pas juste une étiquette
informative) ; un agent **sans aucune attribution garde un accès complet** au portefeuille
(comportement historique inchangé par défaut — ne jamais couper l'accès existant d'un agent
réel du jour au lendemain) ; **un seul agent à la fois par Bien** (réattribuer en retire
silencieusement un autre).

### Fichiers ajoutés/modifiés

- Migration `023_property_agent.sql` : `properties.agent_id` (nullable, FK `users`,
  `ON DELETE SET NULL` — supprimer un employé libère simplement ses Biens, jamais de
  suppression en cascade).
- `services/scope.js` (nouveau) : `resolvePropertyScope(user)` — renvoie `null` (accès
  complet : DG, comptable, ou agent sans aucune attribution) ou l'id de l'agent (portée
  restreinte) ; `assertRenterInScope`/`assertLeaseInScope` (locataire/bail rattaché à un Bien
  hors de la portée → 404, jamais 403, même principe de non-énumération que le reste de
  l'application).
- Backend, portée appliquée en cascade partout où un Bien est la racine de l'accès :
  `routes/properties.js` (liste, fiche, unités, recette — un agent restreint qui crée un
  nouveau Bien se l'auto-attribue, sinon il disparaîtrait aussitôt de sa propre vue),
  `routes/renters.js` (liste, fiche, création, nouveau bail, attestation, lien portail),
  `routes/leases.js` (paiements, quittances, états des lieux — un seul point d'entrée
  `loadLease` déjà partagé par les 9 routes du fichier, il a suffi de le rendre conscient de
  la portée), `routes/complaints.js` (liste, fiche, déclaration), `routes/owners.js`
  (répertoire et fiche limités aux propriétaires ayant au moins un Bien dans la portée, et
  au patrimoine affiché limité à ces Biens-là si le propriétaire est partagé entre agents),
  `routes/utilityReadings.js` (relevés SONEB/SBEE par Bien), `services/rentTracking.js`
  (`listPortfolioArrears`, utilisé par le tableau de bord comptable et le centre de relance).
  Le tableau de bord DG (`routes/dashboard.js`) est réservé au DG seul, donc hors sujet.
- `routes/employees.js` : `GET /:id` renvoie désormais `managedProperties` ; nouveaux
  `POST /:id/properties` (attribution groupée, DG uniquement) et
  `DELETE /:id/properties/:propertyId` (retrait, redevient non attribué).
- Frontend : carte « Biens gérés » sur la fiche d'un agent (recherche + sélection multiple,
  un seul appel d'attribution, retrait par Bien) ; badge « Géré par… » sur la fiche du Bien
  (lecture seule — l'attribution se pilote depuis la fiche employé).

### Bug UX trouvé et corrigé en testant

La liste déroulante de résultats de recherche (position absolue) recouvrait le bouton
« Attribuer », le rendant incliquable une fois un résultat sélectionné. Corrigé en plaçant
les puces sélectionnées + le bouton **au-dessus** du champ de recherche plutôt qu'en dessous.

### Tests effectués

Script bout-en-bout sur cabinet jetable (2 agents, 3 Biens, 1 propriétaire) — 25/25
(visibilité avant/après attribution, 404 hors portée sur Biens/locataires/baux/plaintes,
création de locataire refusée hors portée puis acceptée dans la portée, paiement de loyer
refusé/accepté selon la portée, fiche propriétaire filtrée, réattribution qui bascule la
portée d'un agent à l'autre, DG toujours complet) ; navigateur (Firefox headless, tenant
réel KIko Store, aucune attribution laissée après coup) pour la carte « Biens gérés ».

---

## Étape 15 — État des lieux par zones (refonte)

Demande directe de l'utilisateur (pas une idée du brainstorm de l'étape 13) : remplacer la
grille plate à 9 postes fixes (bon/moyen/mauvais) de l'étape 4/6 par une fiche organisée en
zones, avec éléments personnalisables, photo par élément, verrouillage à la signature, et
comparaison automatique entrée/sortie. Spécification très détaillée fournie par
l'utilisateur (zones et éléments prédéfinis exacts, états BE/ME/SR) ; deux points
réellement ouverts (non déductibles de la spec) tranchés avec l'utilisateur avant codage :
**signature dessinée à l'écran** (plutôt qu'un nom tapé) à la finalisation, et une **échelle
ordonnée BE > SR > ME** pour détecter une dégradation entre l'entrée et la sortie (SR n'est
ni clairement meilleur ni pire que ME dans l'énoncé — l'utilisateur a confirmé cette lecture).

**Zones/éléments standards** : Devanture (8), Chambre (12), Salon (7), Cuisine (8),
Douche/Salle de bain (8) — voir `constants/inspection.js` pour la liste exacte. L'utilisateur
peut ajouter un élément personnalisé dans une zone existante, ou une zone entièrement
nouvelle (garage, cour, couloir…) — ad hoc, propres à ce Bien, jamais mémorisées comme
catalogue réutilisable sur un autre Bien (hors périmètre demandé).

**Cycle de vie** (nouveau — l'ancien système était un envoi unique, immédiatement figé) :
brouillon (créé, modifiable zone par zone, photo par élément) → finalisation (exige un état
renseigné sur CHAQUE élément + les deux signatures ; verrouille définitivement, aucune route
de modification n'existe une fois finalisée). Pour la sortie, c'est la finalisation — pas la
création du brouillon — qui termine le bail et libère l'unité, pour ne jamais impacter le
bail tant que la fiche n'est pas réellement complète et signée.

**Lacune trouvée en construisant la comparaison** : pour que les postes de l'entrée et de la
sortie se correspondent élément par élément (y compris les zones/éléments personnalisés),
le brouillon de sortie est amorcé en **copiant la structure de la fiche d'entrée** (mêmes
`key` de zone/élément, état remis à zéro) plutôt que de repartir du modèle standard — sinon
un élément personnalisé ajouté à l'entrée n'aurait eu aucun équivalent à comparer à la
sortie. À défaut de fiche d'entrée, la sortie repart du modèle standard (comportement de
repli, pas d'erreur).

**Compatibilité avec les fiches déjà existantes** (2 états des lieux d'entrée + 1 de sortie
réels chez KIko Store, ancien format) : la colonne `items` change de FORME (nouvel objet
`{zones:[...]}`) mais pas de TYPE (toujours JSON) — aucune migration de données. Les fiches
anciennes sont normalisées à l'AFFICHAGE seulement (`services/inspection.js`,
`normalizeStoredItems`), regroupées dans une zone synthétique « Éléments vérifiés (ancien
format) », `bon`/`moyen`/`mauvais` mappés vers `BE`/`SR`/`ME` — jamais réécrites en base.
Elles apparaissent déjà comme `finalized` (`DEFAULT 'finalized'` sur la nouvelle colonne
`status`, appliqué par MySQL aux lignes déjà présentes lors de l'`ALTER TABLE`).

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/027_inspection_zones.sql`** : `status` (`draft`/`finalized`,
  défaut `finalized` pour la compatibilité rétroactive), `finalized_at`, `finalized_by`,
  `tenant_signature_path`, `agent_signature_path` — sur `move_in_reports` ET
  `move_out_reports`.
- **`backend/src/constants/inspection.js`** (réécrit) : zones/éléments standards, échelle
  `INSPECTION_CONDITION_RANK` (BE=2, SR=1, ME=0), mappage de compatibilité
  `LEGACY_CONDITION_TO_NEW`.
- **`backend/src/services/inspection.js`** (nouveau) : `cloneMasterZones`/`cloneZonesFrom`
  (amorçage), `normalizeStoredItems` (compatibilité ancien format), `findItem`,
  `getMissingConditionLabels` (validation avant finalisation), `sumDeductions`,
  `toPublicInspectionReport`/`toPublicMoveOutReport` (sérialisation partagée avec
  `routes/renters.js`, qui embarque ces fiches dans la liste des baux d'un locataire).
- **`backend/src/validators/inspections.js`** (nouveau) : schémas zones/éléments (`key`
  borné par un motif strict, jamais interpolé dans un chemin de fichier), brouillon
  entrée/sortie ; primitives (`optionalText`, `dateSchema`, `amountSchema`) exportées depuis
  `validators/renters.js` pour être réutilisées ici plutôt que dupliquées.
- **`backend/src/routes/leases.js`** : remplace les 5 anciennes routes par 12 nouvelles —
  par type de fiche (entrée/sortie) : `GET`, `POST` (démarre le brouillon), `PATCH` (enregistre
  zones/notes/retenues), `POST .../items/:zoneKey/:itemKey/photo` + `DELETE` (photo par
  élément, réutilise `utils/uploads.js`), `POST .../finalize` (multipart 2 signatures,
  verrouille). La sortie recalcule le décompte de caution à la finalisation à partir des
  données PERSISTÉES (jamais confiance dans ce que le client prétend avoir calculé).
- **`backend/src/services/pdf.js`** (`streamMoveOutPdf`) : adapté à la forme publique par
  zones (au lieu de la ligne SQL brute à plat) ; insère désormais les deux images de
  signature dans le PV de sortie.
- **`backend/src/server.js`** : ajout d'un gestionnaire `uncaughtException` global — voir bug
  ci-dessous.
- Frontend : `lib/constants/inspection.ts` (miroir), `lib/api/renters.ts` (types
  `InspectionZone`/`InspectionItem`/`InspectionReport`, fonctions draft/patch/photo/finalize
  partagées entrée/sortie via un paramètre `kind`), `lib/inspection-comparison.ts` (nouveau —
  `compareInspectionReports`, comparaison élément par élément), `components/inspections/`
  (nouveau dossier : `inspection-form.tsx` éditeur de brouillon partagé, `inspection-readonly.tsx`
  affichage figé, `signature-pad.tsx` pavé de signature en `<canvas>` pur — aucune
  bibliothèque, `finalize-section.tsx`, `signature-block.tsx`), pages réécrites
  `app/espace/locataires/[id]/etat-des-lieux/` et `.../sortie/` (brouillon → finalisation,
  section de comparaison en direct pendant la saisie de la sortie).

### Bug non trivial trouvé et corrigé en testant — crash serveur global sur un PNG corrompu

En testant la finalisation avec un PNG de test mal formé (CRC invalide), **tout le process
Express s'est arrêté** — pas seulement la requête en cours. Cause : `doc.image()` de PDFKit
décode un PNG via l'API **asynchrone** de zlib (`png-js`) ; quand le décodage échoue, l'erreur
est levée dans un callback natif, hors de toute pile synchrone — le `try/catch` autour de
`doc.image()` (déjà présent pour l'attestation) ne peut structurellement pas l'intercepter,
et Node la traite comme une exception non capturée qui tue le process. Un seul fichier
corrompu (signature ou cachet) aurait donc mis l'API hors ligne pour **toutes les
entreprises** jusqu'au redémarrage. Corrigé en ajoutant un gestionnaire
`process.on('uncaughtException', ...)` dans `server.js` : ce process HTTP n'a pas d'état
mémoire partagé entre requêtes (hors le pool MySQL, qui se reconnecte seul), donc
journaliser et continuer est plus sûr ici que redémarrer à chaud pour un incident isolé.
Une vraie signature dessinée au canvas ne produit jamais un PNG corrompu — ce filet est une
protection en profondeur pour d'éventuels autres cas (upload tronqué, encodeur non standard).

### Bug trouvé et corrigé en testant — état de brouillon jamais appliqué

Les deux `INSERT` de démarrage de brouillon (entrée et sortie) omettaient la colonne
`status` : ils héritaient donc du `DEFAULT 'finalized'` de la migration (posé pour la
compatibilité rétroactive des fiches déjà existantes) — chaque nouvelle fiche démarrait déjà
« finalisée », impossible à modifier. Corrigé en fixant explicitement `status = 'draft'`
dans les deux `INSERT`. Trouvé immédiatement par le script de test bout-en-bout (le premier
`PATCH` du brouillon échouait en 409).

### Tests effectués (API + navigateur, cabinet jetable + tenant réel KIko Store)

- [x] Script API bout-en-bout (32 vérifications) : brouillon d'entrée amorcé avec les 5
  zones standards ; élément et zone personnalisés ajoutés puis persistés ; finalisation
  refusée (400, liste des postes manquants) tant qu'un état manque ; finalisation réussie
  avec 2 signatures PNG valides ; `PATCH` après finalisation → 409 ; brouillon de sortie
  correctement amorcé depuis les zones/éléments de l'entrée (y compris personnalisés),
  conditions remises à zéro ; retenues par élément + autres retenues → total/net calculés
  puis recalculés à l'identique à la finalisation ; bail terminé + unité libérée seulement à
  la finalisation de la sortie ; PDF téléchargeable seulement une fois finalisée ; règle de
  dégradation (BE→ME signalé, SR→BE non signalé) vérifiée par calcul direct.
- [x] Script API dédié (16 vérifications) : upload/suppression de photo par élément
  (fichier statique ensuite accessible), élément/zone inconnu → 404 ; les 3 fiches réelles de
  KIko Store (ancien format) toujours lisibles via les vraies routes, normalisées en zones,
  PDF de sortie toujours généré sans erreur.
- [x] Navigateur (Firefox headless, cabinet jetable) : brouillon d'entrée avec zone/élément
  personnalisés visibles, sélection BE/ME/SR, pavé de signature réellement dessiné (tracé au
  curseur) puis finalisation → fiche verrouillée avec les deux signatures affichées et
  « Finalisée le … » ; brouillon de sortie amorcé avec la zone personnalisée de l'entrée ;
  dégradation d'un élément → section de comparaison affichant immédiatement « 1 élément
  dégradé » en rouge, avec le repli/déploiement des autres éléments comparés.
- [x] `tsc --noEmit` et `next lint` sans erreur sur tous les fichiers touchés ;
  `node --check` sur tous les fichiers backend touchés.
- Cabinets de test supprimés après coup ; les 14 baux réels de KIko Store non touchés.

---

## Étape 16 — Toutes les opérations datées

Demande directe de l'utilisateur : « toutes les opérations effectuées sur la plateforme
doivent être datées ». Audit ciblé (agent dédié, lecture seule) pour trouver les écrans où
seul l'auteur d'une action était visible, sans sa date — plutôt qu'une supposition, une revue
systématique de `components/ui/attribution.tsx` (utilisé partout où « X créé par… » s'affiche)
et des écrans de liste/historique.

**Deux catégories de lacunes trouvées** :
1. La donnée existait déjà côté serveur mais n'était pas affichée (`property.createdAt`,
   `owner.createdAt`, `renter.createdAt` — jamais passés au composant `Attribution` ; liste
   des employés et des plaintes sans colonne de date alors que le détail l'affiche déjà).
2. La donnée n'existait carrément pas encore : l'attribution d'un Bien à un agent (étape 14)
   et le placement d'un repère GPS (étape 13, idée n°10) ne posaient aucune colonne de date à
   la base ; la génération du lien de portail (propriétaire/locataire, étape 13) n'était pas
   datée non plus malgré son importance (un lien compromis doit pouvoir être daté).

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/028_operation_dates.sql`** : `properties.agent_assigned_at`,
  `properties.location_set_at`, `owners.portal_link_created_at`,
  `renters.portal_link_created_at` — toutes nullables, `NULL` sur les enregistrements
  antérieurs à cette étape (jamais de date inventée rétroactivement, voir tests ci-dessous).
- **`backend/src/routes/employees.js`** : `agent_assigned_at = NOW()` à l'attribution,
  remis à `NULL` au retrait ; `loadManagedProperties` renvoie désormais `assignedAt`.
- **`backend/src/routes/properties.js`** : `location_set_at` posé/effacé en même temps que
  `latitude`/`longitude` (création et modification) ; `toPublicProperty` expose
  `agentAssignedAt`/`locationSetAt`.
- **`backend/src/routes/owners.js`**, **`backend/src/routes/renters.js`** : `portal_link_created_at
  = NOW()` à chaque (re)génération du lien portail — y compris la génération automatique à la
  création d'un locataire (étape 13) ; exposé comme `portalLinkCreatedAt`.
- **`backend/src/routes/renters.js`** (`LEASE_UNIT_PROPERTY_SELECT`/`toPublicLease`) : le bail
  n'exposait `createdAt` nulle part malgré la colonne déjà présente — corrigé.
- **`frontend/components/ui/attribution.tsx`** : nouvelle prop optionnelle `at`, affichée
  comme « … le {date} » à la suite de l'auteur — un seul endroit à corriger pour dater les
  6 usages du composant (Bien, Propriétaire, Locataire, Bail).
- Frontend, dates rendues visibles : `employes-view.tsx` (liste, « Créé le »),
  `plaintes-view.tsx` (liste, « Signalée le »), `employes/[id]/editer-view.tsx`
  (« Biens gérés », « Attribué le » par Bien), `proprietaire-view.tsx` et `locataire-view.tsx`
  (carte Portail, « Lien généré le »), `bien-view.tsx` (carte Localisation, « Repère placé
  le »), `locataire-view.tsx` (les deux lignes état des lieux ajoutées à l'étape précédente
  précisent maintenant depuis quand un brouillon est en cours, pas seulement son statut).

### Tests effectués (API + navigateur, cabinet jetable + tenant réel KIko Store)

- [x] Script API (16 vérifications) : propriétaire sans lien portail → `portalLinkCreatedAt`
  `null` → généré → non `null` ; Bien sans repère → `locationSetAt` `null` → coordonnées
  posées → daté ; locataire créé → lien portail auto-généré déjà daté ; régénération → date
  mise à jour (postérieure à la précédente) ; bail exposé avec `createdAt` ; agent → Bien
  attribué → `assignedAt` renseigné → retiré → `assignedAt` et `agentAssignedAt` à `null`.
- [x] Vérifié sur le vrai portefeuille KIko Store (lecture seule) : tous les écrans touchés
  chargent toujours sans erreur ; un lien de portail locataire généré **avant** cette étape
  a bien `portalLinkCreatedAt: null` (donnée absente à l'époque, jamais inventée) — la carte
  masque correctement la ligne de date dans ce cas plutôt que d'afficher une date invalide.
- [x] Navigateur (Firefox headless, cabinet jetable) : fiche propriétaire affichant à la fois
  « Fiche créée par … le 14 septembre 2026 » et « Lien généré le 14/09/2026 » ; liste des
  employés affichant « Créé le 14/09/2026 » sous chaque ligne.
- [x] `tsc --noEmit` et `next lint` sans erreur ; `node --check` sur tous les fichiers backend
  touchés.
- Cabinets de test supprimés après coup ; les 14 baux réels de KIko Store non touchés.

---

## Étape 17 — Retour immédiat sur chaque action (notifications toast)

Demande directe de l'utilisateur : « je veux que la plateforme soit très réactive, que les
utilisateurs soient vraiment heureux ». Trop large pour deviner un seul écran — question
posée pour prioriser : entre le retour immédiat sur chaque action, la vitesse perçue au
chargement, et le polish visuel, l'utilisateur a choisi le premier (impact le plus large,
sur le plus d'écrans). Jusqu'ici, une action réussie n'avait souvent **aucun** retour visible
(le formulaire se refermait silencieusement), ou un bandeau inline qui disparaissait à la
navigation suivante (contournement par paramètre d'URL `?queued=1` pour les plaintes
hors-ligne, devenu inutile).

**Décision d'architecture** : un système de toasts monté une seule fois à la racine
(`app/layout.tsx`, hors de tout écran), donc les confirmations survivent à une navigation
(`router.push` juste après un `toast.success(...)` s'affiche bien sur la page de destination)
— contrairement aux anciens bandeaux inline, détruits dès que le composant qui les affichait
disparaissait.

### Fichiers ajoutés/modifiés

- **`frontend/lib/toast/toast-context.tsx`** (nouveau) : `ToastProvider`/`useToast()` —
  `success`/`warning`/`error`/`info`, empilables, disparition automatique après 4 s ou
  fermeture manuelle.
- **`frontend/components/ui/toast.tsx`** (nouveau) : pile de toasts, positionnée sous
  l'en-tête fixe (`top-[72px]`, sous peine de le recouvrir), icône + couleur par variante
  (mêmes tokens success/warning/danger/info que `Badge`/`Button`), animation d'entrée
  (`app/globals.css`, `@keyframes toast-in`).
- **`frontend/app/layout.tsx`** : `<ToastProvider>` monté en dehors de `<AuthProvider>` —
  disponible même sur les pages publiques (connexion, portails).
- Environ 25 points de mutation, à travers 8 modules, dotés d'un toast là où il n'y avait
  aucun retour ou un bandeau qui disparaissait à la navigation : paiements et baux
  (`locataires/[id]`), dépenses/compteurs/unités/repère GPS (`biens/[id]`), plaintes
  (déclaration, modification, changement de statut — `plaintes/nouveau` et
  `plaintes/[id]`), employés (modifications, attribution/retrait de Biens —
  `employes/[id]`), propriétaires (modifications, versement, taux de commission —
  `proprietaires/[id]` et `proprietaires/nouveau`), Biens (création — `biens/nouveau`),
  charges/relevés (nouvelle charge, création/sauvegarde/validation/réouverture/suppression
  d'un relevé — `charges/nouveau`, `charges/releves`, `charges/releve/[id]`), comptabilité
  (dépense, date de démarrage, clôture d'un mois — `comptabilite-view.tsx`), état des lieux
  (brouillon, photo, finalisation — étape 15, `etat-des-lieux-view.tsx` et `sortie-view.tsx`).
- Suppression du contournement `?queued=1` (paramètre d'URL) sur `plaintes/nouveau` /
  `plaintes-view.tsx`, devenu inutile — le toast persiste naturellement à travers la
  navigation, sans avoir besoin d'un paramètre pour transporter l'information.

### Bug visuel trouvé et corrigé en testant

Le premier jet positionnait la pile de toasts en haut absolu de l'écran (`top-0`), qui
recouvrait l'en-tête `sticky` de l'espace (`z-40`) puisque les toasts sont au-dessus
(`z-[100]`) — confirmé en navigateur, le toast s'affichait par-dessus le logo et le bouton
« Se déconnecter ». Corrigé en décalant la pile sous l'en-tête (`top-[72px]`).

### Tests effectués (navigateur, cabinet jetable)

- [x] Firefox headless : modification d'un propriétaire → toast vert « Modifications
  enregistrées. » affiché sous l'en-tête (jamais par-dessus), disparu automatiquement après
  la fenêtre de 4 s, sans laisser de trace résiduelle dans le DOM.
- [x] `tsc --noEmit` et `next lint` sans erreur (y compris un avertissement de dépendance de
  `useEffect` sur une ref, corrigé en capturant sa valeur dans une variable locale).
- Cabinets de test supprimés après coup.

## Étape 18 — Outils comptables/agents (tâches, rapport, historique)

Question ouverte posée à l'utilisateur : « quelle fonctionnalité ajouter pour les comptables
et les agents, comme travail, qui soit vraiment importante ? ». Cinq idées proposées ;
l'utilisateur en a choisi trois, dans cet ordre explicite : **« Tableau de bord en premier /
Rapport mensuel exportable / Historique personnel »**.

### Feature 1 — Tableau de bord « Mes tâches du jour » 🟢 Validée

Objectif : à la connexion, un comptable ou un agent voit d'emblée ce qui attend une action de
sa part, sans avoir à visiter chaque module un par un. Réservé aux employés — le DG a déjà sa
propre vue d'ensemble (portefeuille, alertes prédictives) et cette carte ne lui apporterait
rien de plus.

Contenu, selon le rôle (déterminé par les permissions réelles de l'employé, jamais par un rôle
supposé) :
- **Agent** : relances en retard et alertes prédictives sur son portefeuille (respecte le
  périmètre de l'étape 14), plaintes ouvertes, états des lieux en brouillon.
- **Comptable** : relevés de compteurs en attente de validation, dépenses sans justificatif,
  mois clôturable (réutilise `getPeriodClosability`/`isPeriodClosed` de la comptabilité —
  aucune logique dupliquée).

#### Fichiers ajoutés/modifiés

- **`backend/src/routes/tasks.js`** (nouveau) : `GET /api/tasks` — construit
  `{ agent, accountant }` (chacun `null` si l'employé n'a pas la permission correspondante),
  en réutilisant `listPortfolioArrears`, `listPredictiveLateAlerts`, `getPeriodClosability`,
  `isPeriodClosed` et `resolvePropertyScope` déjà existants plutôt que de recalculer quoi que
  ce soit.
- **`backend/src/routes/index.js`** : montage de `/tasks` **avant**
  `router.use(utilityReadingRoutes)` — ce routeur, monté sans préfixe, intercepte toute
  requête qui l'atteint (piège déjà rencontré aux étapes des portails).
- **`frontend/lib/api/tasks.ts`** (nouveau) : types + `getMyTasks(accessToken)`.
- **`frontend/components/espace/my-tasks-card.tsx`** (nouveau) : carte avec une section par
  type de tâche (masquée si vide), 4 éléments visibles max + lien « Voir tout » vers l'écran
  complet, ou lien direct par élément.
- **`frontend/app/espace/espace-view.tsx`** : `{!isDg && <MyTasksCard />}` entre l'en-tête et
  la grille de cartes existante.

#### Bug trouvé et corrigé en testant

`req.user.permissions` n'existe pas — les permissions ne sont jamais embarquées dans le JWT,
uniquement stockées dans la table `user_permissions`. La première version renvoyait donc
systématiquement `agent: null, accountant: null`, même pour un employé qui devait voir une
des deux sections (détecté par les assertions du test automatisé, jamais vu par
l'utilisateur). Corrigé en appelant `getPermissions(req.user.id, req.user.role)` du service
`services/permissions.js`, comme le fait déjà le frontend au login.

#### Tests effectués (cabinet jetable)

- [x] 17 assertions automatisées (script API) : sections correctement peuplées/vides selon
  le rôle et les permissions, respect du périmètre agent de l'étape 14 (un agent sans Bien
  attribué garde un accès complet ; ce n'est qu'en lui attribuant un Bien à lui — pas à un
  autre agent — qu'il perd la visibilité sur les Biens des autres).
- [x] Firefox headless : les 6 sections attendues s'affichent, badge de total correct (« 6 »),
  capture d'écran vérifiée visuellement.
- Cabinet de test supprimé après coup, KIko Store (14 baux) inchangé.

### Feature 2 — Rapport mensuel exportable 🟢 Validée

Objectif : le comptable peut imprimer/exporter en PDF le même tableau de bord comptable qu'à
l'écran, pour l'archiver ou le transmettre — même période (`from`/`to`) que l'écran.

#### Fichiers ajoutés/modifiés

- **`backend/src/routes/accounting.js`** : extraction du corps de `GET /dashboard` dans une
  fonction réutilisable `computeAccountingDashboard(user, { from, to })` (aucun calcul
  dupliqué), et nouvelle route `GET /dashboard.pdf` qui l'appelle puis passe le résultat à
  `streamAccountingReportPdf`.
- **`backend/src/services/pdf.js`** : nouvelle fonction `streamAccountingReportPdf(res,
  { tenant, dashboard })` — en-tête/pied de page réutilisés, titre + période, statut
  ouvert/clôturé, bloc de synthèse (loyers +, versements -, dépenses -, solde net, ligne
  informative impayés/charges/travaux), puis trois sections listées de façon paginée
  (dépenses par catégorie, charges SONEB/SBEE impayées par type, locataires en retard —
  plafonné à 20 avec mention du dépassement).
- **`frontend/lib/api/accounting.ts`** : `accountingReportPdfPath(from, to)`.
- **`frontend/app/espace/comptabilite/comptabilite-view.tsx`** : bouton « Rapport mensuel »
  (icône `FileDown`) à côté du sélecteur de mois, ouvre le PDF via `openAuthenticatedPdf`.

#### Tests effectués (cabinet jetable)

- [x] Script API : dashboard JSON toujours correct après le refactoring (non-régression),
  téléchargement du PDF (`200`, `Content-Type: application/pdf`, en-tête `%PDF-` valide),
  agent sans la permission comptabilité reçoit bien `403` sur `/dashboard.pdf` comme sur
  `/dashboard`.
- [x] Deuxième cabinet jetable avec données couvrant les trois sections à la fois (loyers,
  versement, deux catégories de dépenses, une charge SONEB impayée générée via le cycle
  complet relevé → validation, un locataire en retard) : PDF extrait avec `pdftotext`,
  contenu vérifié ligne par ligne — montants signés corrects, solde net exact (55 000 −
  30 000 − 23 000 = 2 000 FCFA), libellés de catégorie/fluide résolus correctement,
  formatage FCFA cohérent avec l'écran.
- Cabinets de test supprimés après coup, KIko Store (14 baux) inchangé.

### Feature 3 — Historique personnel 🟢 Validée

Objectif : le comptable/l'agent voit l'historique de ses propres actions passées. Le
« Journal d'activité » existant (`/espace/journal`, `services/activity.js`) est réservé au
DG (`RequireAuth roles={["dg"]}`) et montre TOUT le cabinet, sans filtre par auteur.

#### Fichiers ajoutés/modifiés

- **`backend/src/services/activity.js`** : `listRecentActivity(tenantId, limit, actorUserId)`
  et `listDeletedEntries(tenantId, actorUserId)` acceptent désormais un `actorUserId`
  optionnel — quand fourni, chaque sous-requête (l'une des 15 du journal) ajoute un filtre
  sur sa propre colonne d'auteur (`created_by`/`recorded_by`/`conducted_by`/`closed_by`/
  `set_by`/`resolved_by`/`deleted_by` selon le module). Aucun calcul dupliqué : le journal
  DG (`routes/dashboard.js`) continue d'appeler ces mêmes fonctions sans ce paramètre
  (comportement inchangé, toujours le journal complet).
- **`backend/src/routes/history.js`** (nouveau) : `GET /api/history?limit=` — appelle
  `listRecentActivity(tenantId, limit, req.user.id)`, c'est-à-dire toujours les actions du
  *demandeur*, jamais d'un tiers.
- **`backend/src/routes/index.js`** : montage de `/history` **avant**
  `router.use(utilityReadingRoutes)`, même piège que les autres routes préfixées de cette
  étape.
- **`frontend/lib/api/history.ts`** (nouveau) : `getMyHistory(accessToken, limit)`, réutilise
  le type `ActivityEntry` de `lib/api/dashboard.ts`.
- **`frontend/app/espace/historique/`** (nouveau, `historique-view.tsx` + `page.tsx`) :
  reprend la mise en page du Journal DG (mêmes icônes par type d'action), sans la ligne
  d'auteur (redondante — c'est toujours l'utilisateur lui-même) ; `RequireAuth
  roles={["comptable", "agent"]}` — explicitement fermée au DG, qui a déjà le Journal complet.
- **`frontend/components/espace/espace-header.tsx`** : lien de navigation « Historique »
  ajouté, gardé par `!isDg` (symétrique du lien « Journal », gardé par `isDg`).

#### Bug trouvé en préparant le test (script de test, pas l'application)

Le script de préparation du test navigateur envoyait `confirmPassword` à
`POST /api/auth/change-password`, qui attend en réalité `confirmNewPassword`
(`validators/auth.js`) — Zod rejetait silencieusement la requête (mon script ne vérifiait
pas le code retour), si bien que le mot de passe temporaire restait actif et le login créé
pour le test échouait en boucle avec un message générique. Corrigé dans le script de test
uniquement ; le comportement de l'API était correct depuis le début.

#### Tests effectués (cabinet jetable)

- [x] Script API dédié : deux comptables distincts (A et B) sur le même cabinet, chacun
  enregistrant une dépense + (pour A) une création de propriétaire — 14 assertions : chacun
  voit ses propres actions et ne voit PAS celles de l'autre, ni celles du DG ; le Journal DG
  non filtré (`GET /api/dashboard/activity`) continue de tout voir (non-régression).
- [x] Firefox headless : connexion en comptable, page « Mon historique » affichant
  exactement les deux actions de ce comptable (propriétaire créé, dépense enregistrée) avec
  icône/libellé/montant/date corrects ; lien « Historique » présent dans la navigation,
  liens DG-only (« Employés », « Journal ») absents ; capture d'écran vérifiée.
- Quatre cabinets de test supprimés après coup (dont ceux des Features 1 et 2), KIko Store
  (14 baux) confirmé inchangé.

Les trois idées demandées par l'utilisateur sont maintenant toutes codées, testées et
validées.

## Étape 19 — Refonte design professionnel des documents PDF

Demande directe de l'utilisateur : « les PDF ne sont pas du tout professionnels [...] pour
les factures on va utiliser la police "Courier New" [...] fait un bon design pro comme celui
des grandes entreprises comme Google et Apple ». Deux questions posées pour cadrer une refonte
qui touche 5 gabarits différents : (1) Courier New partout ou seulement sur les chiffres ? →
l'utilisateur a choisi seulement les chiffres (montants, dates, numéros de référence,
RCCM/IFU/téléphone) — le texte courant reste en Helvetica moderne, comme le fait Stripe ; (2)
quels documents redessiner ? → l'utilisateur a choisi les 5 (quittance, rapport mensuel,
relevé propriétaire, PV de sortie, attestation de loyer).

### Fichiers modifiés

- **`backend/src/services/pdf.js`** : refonte de la charte partagée par les 5 documents.
  - Palette alignée sur celle de l'écran (`frontend/tailwind.config.ts` — mêmes valeurs
    hexadécimales que `primary`/`ink`/`border`/`success`/`danger`/`warning`), pour qu'un PDF
    ressemble à un écran de Lyko System plutôt qu'à un document à part.
  - `FONT_MONO`/`FONT_MONO_BOLD` (`Courier`/`Courier-Bold`, l'équivalent Courier New des 14
    polices standard PDF — aucune police à embarquer) appliqués à tout ce qui est un chiffre :
    montants FCFA, dates, numéros de quittance, RCCM/IFU/téléphone, décomptes.
  - `drawHeader` : fine barre d'accent en tête de page (touche « letterhead » qui manquait),
    ligne d'identité légale (RCCM/IFU/téléphone) en Courier.
  - `drawFooter` : désormais sur **toutes** les pages d'un document (avant : seulement la
    dernière), avec pagination « X / Y » en Courier.
  - `drawPanel`/`drawPanelRow` (nouveaux) : cartes à coins arrondis pour les blocs de synthèse
    (montant reçu, décompte de caution, résumé comptable) à la place des rectangles à angles
    vifs — remplace les 3 occurrences dupliquées de ce motif.
  - `drawMetaLine` (nouveau) : ligne libellé/valeur sous chaque titre (« N° QT-2026-0042 ·
    émise le 14 septembre 2026 »), alternant Helvetica (libellés) et Courier (valeurs) via
    l'API « continued » de PDFKit.
  - `drawRow` accepte une option `{ mono: true }` pour les valeurs numériques.
- **`backend/src/constants/contract.js`** : `renderContractTemplateSegments` tague désormais
  chaque placeholder substitué `mono` (téléphone, RCCM, IFU, date d'entrée, loyer, date) ou
  `bold` (noms propres — locataire, entreprise, signataire, bien) plutôt qu'un simple booléen
  gras — l'attestation de loyer profite de la même refonte sans dupliquer la logique.

### Deux bugs PDFKit réels trouvés en testant (pas des bugs applicatifs)

1. **`doc.characterSpacing(...)` n'existe pas comme méthode chaînable** dans PDFKit 0.15.2 (seul
   `.text(str, {characterSpacing: N})` fonctionne) — utilisé pour l'étiquette « MONTANT REÇU »
   en petites capitales espacées ; corrigé en passant l'option directement à `.text()`.
2. **Chevauchement du pied de page avec le corps du texte sur un document long** (constaté sur
   le vrai contrat personnalisé de KIko Store, 48 000+ caractères) : PDFKit déclenche son saut
   de page automatique sur `.text()` en comparant `y` à `page.height - page.margins.bottom`,
   MÊME avec des coordonnées absolues après `switchToPage()` — sans contournement, dessiner le
   pied de page à y≈780 créait une page **blanche supplémentaire** à chaque itération au lieu
   d'écrire sur la page visée (un document de 2 pages en ressortait avec 4, les vrais pieds de
   page invisibles, relégués sur les pages 3-4 jamais vues). Corrigé en mettant `page.margins.
   bottom = 0` juste avant de dessiner le pied de page, puis en le restaurant après (contour-
   nement documenté de PDFKit). Marge basse du document aussi portée de 50 à 75pt pour que le
   texte de corps ne s'approche jamais du pied de page avant le saut de page automatique.

### Tests effectués

- [x] Script API sur cabinet jetable : génère les 5 documents (quittance, attestation, relevé
  propriétaire, rapport mensuel, PV de sortie — ce dernier via le cycle complet démarrage →
  brouillon avec conditions → finalisation avec 2 signatures) — 13/13 vérifications (`200`,
  `Content-Type: application/pdf`, en-tête `%PDF-` valide).
  Récupérer un « bail introuvable » a nécessité de reconstruire correctement le cycle de vie de
  l'état des lieux de sortie (démarrage → PATCH avec toutes les conditions renseignées →
  finalisation avec 2 fichiers de signature) — pas un bug, juste la mécanique déjà en place.
- [x] Rendu visuel (`pdftoppm`) des 5 PDF sur cabinet jetable, page par page : barre d'accent,
  Courier sur RCCM/IFU/téléphone/dates/montants/numéros, panneaux arrondis, montants colorés
  (vert reçu, rouge sortant, bleu solde), pied de page avec pagination correcte sur un document
  multi-page (PV de sortie, 3 pages).
- [x] **Vérification en lecture seule sur le vrai cabinet KIko Store** (login réel du DG, aucune
  écriture) : régénération de la vraie attestation de loyer (leur contrat personnalisé de 11
  articles, avec leur vrai logo/cachet notarié/signature) et du vrai relevé propriétaire —
  rendu correct sur 3 pages, aucun chevauchement, pagination « 3 / 3 » correcte. C'est ce test
  qui a révélé le bug de chevauchement du pied de page (invisible sur les documents courts d'un
  cabinet jetable, mais réel sur ce contrat long).
- Cabinets de test supprimés après coup ; KIko Store (14 baux) confirmé inchangé.

### Complément : date de téléchargement toujours affichée

Demande directe de l'utilisateur, juste après la refonte ci-dessus : « faut toujours mettre
le jour/mois/année de téléchargement des documents ». Certains documents avaient déjà une
date (quittance : date d'émission ; PV de sortie : date de l'état des lieux ; attestation/
relevé : date du jour) mais ce sont des dates MÉTIER, pas forcément celle du téléchargement
— et le rapport mensuel n'en affichait aucune. Plutôt que d'ajouter une ligne différente à
chacun des 5 gabarits, ajout au seul élément déjà commun aux 5 : le pied de page (déjà
affiché sur chaque page depuis le complément ci-dessus). Nouveau `formatDateSlash(isoDate)`
(format JJ/MM/AAAA — délibérément différent de `formatDateFr`, en lettres, utilisé partout
ailleurs pour les dates métier) ; `drawFooter` affiche désormais « Document téléchargé le
**14/09/2026** · Lyko System. » (date en Courier-Bold) sur chaque page de chaque document,
calculée une seule fois par génération (`new Date()` au moment de la requête, ces PDF n'étant
jamais stockés mais toujours générés à la demande).

Tests : mêmes 13 vérifications API (cabinet jetable) toujours au vert, rendu visuel confirmant
la date sur la quittance et sur les 3 pages du PV de sortie, puis re-vérification en lecture
seule sur le vrai contrat KIko Store (toujours 3 pages, aucune régression du bug de
chevauchement corrigé plus haut). KIko Store (14 baux) confirmé inchangé.

---

## Étape 20 — Marketplace des Unités vacantes

Demande directe de l'utilisateur : « ajouter un marketplace au menu — si une personne libère
une maison, le comptable, l'agent ou le DG peut publier ça avec un bouton publier ». Deux
questions posées pour cadrer une fonctionnalité aux implications architecturales réelles :
(1) page PUBLIQUE partageable (comme un vrai site d'annonces) ou outil purement interne ? →
l'utilisateur a choisi **publique** ; (2) infos de base seulement, ou avec photos et
description ? → l'utilisateur a choisi **avec photos et description**.

**Décision d'architecture non posée en question** (déductible du reste de l'application) :
une page publique **par cabinet** (comme les portails locataire/propriétaire), jamais un
marketplace unique fusionnant tous les cabinets Lyko System entre eux — cohérent avec le
principe déjà établi (chaque portail public existant est scopé à un seul cabinet). Contrai-
rement aux portails locataire/propriétaire, **pas de lien secret** : une annonce est faite
pour être vue et partagée largement, l'URL utilise simplement l'id du cabinet
(`/marketplace/:tenantId`).

### Modèle retenu (volontairement simplifié)

Une seule action « Publier » plutôt qu'un vrai flux d'édition : republier une Unité déjà
publiée remplace intégralement l'annonce précédente (description + photos), au lieu d'un
formulaire de modification séparé (aurait ajouté la question « les nouvelles photos
remplacent-elles ou s'ajoutent-elles aux anciennes ? », source d'un piège UX — vider les
photos par accident en modifiant juste la description). Une annonce est supprimée AUTOMATI-
QUEMENT dès qu'un nouveau bail est signé sur son Unité (elle n'est plus vacante) — la
prochaine vacance repart d'une annonce fraîche plutôt que de réafficher un contenu qui
aurait pu devenir obsolète (prix, description) sans qu'on y pense.

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/029_marketplace_listings.sql`** (nouveau) : table
  `marketplace_listings` — une ligne = une annonce active, `UNIQUE KEY` sur `unit_id` (jamais
  de doublon, republier = remplacer). `photo_paths` en JSON, comme les autres photos de
  l'application (Biens, plaintes).
- **`backend/src/routes/marketplace.js`** (nouveau) :
  - `GET /public/:tenantId` — **aucune authentification**, la seule route publique en dehors
    des portails à lien secret.
  - `GET /`, `POST /:unitId` (upload jusqu'à 6 photos, `multer.memoryStorage()` + validation
    du contenu réel comme partout ailleurs), `DELETE /:unitId` — mêmes permissions que la
    gestion des Biens (`locataires` OU `proprietaires`), même portée agent (étape 14) que le
    reste du patrimoine. `POST` refuse (400) une Unité qui n'est plus `libre`.
- **`backend/src/routes/index.js`** : montage de `/marketplace` avant `utilityReadingRoutes`
  — même piège que tous les autres préfixes ajoutés cette session (sa route publique
  `/public/:tenantId` doit rester joignable sans authentification).
- **`backend/src/routes/renters.js`** : nouvelle fonction `clearMarketplaceListing` (+ ses
  deux points d'appel, aux deux endroits où un bail est créé) — supprime l'annonce et ses
  photos disque dès qu'une Unité change de statut vers `loue`.
- **`frontend/lib/api/marketplace.ts`** (nouveau) : types + `listMyListings`,
  `publishListing`, `unpublishListing`, `getPublicMarketplace` (seule fonction sans
  `accessToken`).
- **`frontend/app/espace/marketplace/`** (nouveau) : page interne de gestion — carte avec le
  lien public (copier / partager sur WhatsApp / ouvrir), grille des annonces publiées avec
  bouton « Retirer ». Publier une NOUVELLE annonce se fait depuis la fiche du Bien, pas ici.
- **`frontend/app/marketplace/[tenantId]/`** (nouveau) : page publique, ni `RequireAuth` ni
  `EspaceHeader` — en-tête minimal avec logo/nom du cabinet, grille de cartes (photo,
  désignation, loyer, adresse, description, bouton WhatsApp pré-rempli via
  `buildWhatsAppHref` déjà existant).
- **`frontend/app/espace/biens/[id]/bien-view.tsx`** : bouton « Publier » sur chaque Unité
  `libre` (colonne Actions du tableau), ouvrant un formulaire (description + photos) rendu
  comme une `Card` **sous** le tableau plutôt qu'en superposition dans la cellule.
- **`frontend/components/espace/espace-header.tsx`** : lien de navigation « Marketplace »,
  même garde que « Nos biens » (`locataires` OU `proprietaires`, ou DG).

### Bug trouvé et corrigé en testant

Premier jet du formulaire de publication en `position: absolute` À L'INTÉRIEUR d'une cellule
du tableau des Unités. Le conteneur du tableau (`components/ui/table.tsx`) est
`overflow-x-auto` — règle CSS peu connue : dès qu'un seul axe (`overflow-x`) quitte
`visible`, l'autre axe (`overflow-y`, resté à sa valeur par défaut `visible`) est
automatiquement forcé à `auto` par la plupart des moteurs de rendu. Le panneau flottant
(textarea + champ fichier + boutons, plus haut qu'une ligne de tableau) se retrouvait donc
tronqué par ce défilement interne peu visible plutôt que de s'étendre naturellement dans la
page — repéré en capture d'écran Firefox (formulaire visiblement coupé en bas). Corrigé en
sortant entièrement le formulaire du tableau : l'état « quelle Unité est en cours de
publication » est monté dans le composant parent, et le formulaire s'affiche comme une Card
à part sous le tableau (même convention que `NewUnitForm`, déjà utilisée sur cette page pour
« Ajouter une unité »).

### Tests effectués (cabinet jetable)

- [x] Script API, 17 vérifications : publication avec description + 2 photos (201, photos
  bien attachées), l'annonce apparaît dans la gestion interne ET sur la page publique SANS
  authentification, le fichier photo est bien joignable publiquement (`/uploads/...`, 200),
  publier une Unité non-vacante est refusé (400), un agent sans permission `locataires`/
  `proprietaires` reçoit 403, un nouveau bail signé sur l'Unité publiée supprime bien
  l'annonce ET son fichier photo du disque (404 après), et le retrait manuel fonctionne.
- [x] Firefox headless, trois surfaces : page publique (aucune session, annonce visible avec
  photo/prix/description/bouton WhatsApp), page interne `/espace/marketplace` (lien public +
  carte « Retirer » pour un comptable), formulaire de publication sur la fiche du Bien (bug
  de superposition détecté puis corrigé, capture confirmant le rendu correct après le
  correctif). `tsc --noEmit`/`next lint` propres.
- Cabinets de test supprimés après coup, KIko Store (14 baux) confirmé inchangé.

### Revirement (2026-09-14/15) : la page publique déménage hors de cette plateforme

L'utilisateur est revenu sur la présence du marketplace « au menu » : la vitrine PUBLIQUE
(`frontend/app/marketplace/[tenantId]/`) ne doit pas vivre dans Lyko System — elle devient un
site externe séparé, « Quick Immo » (voir Étape 21), relié à cette plateforme par l'API déjà
construite ci-dessus. Retiré de cette plateforme : le lien de navigation « Marketplace » et la
page publique elle-même. Conservé (le back-office reste ici, décision explicite de
l'utilisateur) : la route publique `GET /api/marketplace/public/:tenantId`, le bouton
« Publier » sur la fiche du Bien, et la page interne `/espace/marketplace` — dont la carte
« lien public à partager » a aussi été retirée (elle n'a plus de sens une fois la page
publique déménagée) ; elle ne fait plus que lister/retirer les annonces déjà publiées, et
affiche désormais aussi les demandes « confier un bien » reçues depuis Quick Immo (voir
Étape 21). `tsc --noEmit`/`next lint` propres après le retrait.

---

## Étape 21 — Quick Immo (site externe, relié à cette plateforme)

Demande directe de l'utilisateur : « marketplace ne doit être là, nous allons construire une
page complète extérieure qui ne sera pas dans cette plateforme mais un autre site qui va
permettre de vendre les biens mais il sera lié à cette plateforme ». Nom de marque donné par
l'utilisateur : **Quick Immo**, avec la consigne explicite « même couleurs, même charte
graphique » que Lyko System.

Plusieurs séries de questions posées avant de coder, la portée s'étant élargie à chaque
réponse :
1. Page publique partageable vs outil interne → **publique**.
2. Infos de base seulement vs + photos + description → **+ photos + description**.
3. La gestion (publier une annonce) reste-t-elle sur Lyko System, ou le nouveau site a-t-il sa
   propre gestion ? → **reste sur Lyko System** (aucune duplication de la gestion des
   employés/permissions) — Quick Immo n'affiche que ce qui est publié via l'API existante.
4. Menu voulu par l'utilisateur : Marketplace | Confier un bien | À propos | Contacter, plus
   Inscription/Connexion — ce dernier point a révélé un besoin de comptes pour le grand
   public (chercheurs de logement ET propriétaires), et un flux « confier un bien » qui
   couvre en fait DEUX intentions (louer OU **vendre** — la vente n'existait nulle part dans
   le modèle de données de Lyko System, construit entièrement autour de baux/loyers).
5. Proposition d'ensemble soumise à validation avant de coder quoi que ce soit
   (voir structure ci-dessous) → **validée telle que proposée**.

### Architecture retenue

- **Un site Next.js séparé** (`quick-immo/`, nouveau dossier à la racine du dépôt, pas dans
  `frontend/`) — son propre `package.json`, tourne sur le port 3100 en dev. Même charte
  graphique que Lyko System : `tailwind.config.ts` et `app/globals.css` copiés à l'identique
  (mêmes tokens de couleur/typographie), composants `ui/` (Button/Card/Badge/Input/Toast)
  copiés tels quels — ils ne dépendaient que du helper `cn()`, aucune adaptation nécessaire.
- **Scopé à UN cabinet pour l'instant** (`NEXT_PUBLIC_TENANT_ID` = 8 = KIko Store en
  production) — jamais un agrégateur multi-cabinets ; la même API accepterait déjà plusieurs
  cabinets si un jour nécessaire, mais rien dans l'UI ne le permet aujourd'hui.
- **La gestion (publier/retirer une annonce) reste entièrement sur Lyko System**, décision
  explicite de l'utilisateur — Quick Immo ne fait qu'appeler
  `GET /api/marketplace/public/:tenantId` (déjà construit, Étape 20), en lecture seule.
- **« Confier un bien » = une simple DEMANDE, jamais une création automatique.** Lyko System
  n'a aucune notion de « Bien à vendre » (tout son modèle est bâti autour de baux/loyers) —
  créer un Bien reste un acte humain, réservé à l'employé qui accepte la demande.
- **Comptes Quick Immo = un realm totalement séparé** des employés (`users`) et des
  locataires/propriétaires à lien secret (portails) : de purs inconnus qui s'inscrivent
  eux-mêmes (rôle `chercheur` ou `proprietaire`, choisi à l'inscription).

### Fichiers ajoutés — backend (même serveur Express, même base MySQL)

- **`backend/src/db/migrations/030_marketplace_accounts.sql`** (nouveau) : trois tables —
  `marketplace_accounts` (comptes du grand public, `UNIQUE (tenant_id, phone)`),
  `marketplace_requests` (une demande « confier un bien », `request_type` ENUM
  `louer`/`vendre`, `status` ENUM `en_attente`/`contactee`/`acceptee`/`refusee`),
  `marketplace_favorites` (favoris d'un compte `chercheur`).
- **`backend/src/utils/jwt.js`** : `signMarketplaceToken`/`verifyMarketplaceToken` — signés
  avec une clé **dédiée** (`JWT_MARKETPLACE_ACCOUNT_SECRET`, nouvelle variable d'env),
  jamais celle des employés. Un seul token, 30 jours, pas de rotation de refresh token (pas
  d'enjeu financier/sensible comparable à un compte employé).
- **`backend/src/middleware/marketplaceAccountAuth.js`** (nouveau) : `requireMarketplaceAccount`
  + `requireAccountRole(...)`, réalm strictement séparé de `requireAuth` (`middleware/auth.js`).
- **`backend/src/routes/marketplaceAccounts.js`** (nouveau), monté sur `/api/marketplace-accounts`
  (avant `utilityReadingRoutes`, même piège récurrent que toutes les routes publiques de cette
  session) : `POST /register`, `POST /login`, `GET /me`, `POST /requests` (rôle `proprietaire`),
  `GET /requests/mine`, `GET|POST|DELETE /favorites[/:unitId]` (rôle `chercheur`).
- **`backend/src/routes/marketplace.js`** : deux routes ajoutées côté employé (gestion
  interne) — `GET /requests` (toutes les demandes du cabinet, avec nom/téléphone du
  propriétaire) et `PATCH /requests/:id` (contactée/acceptée/refusée).
- **`backend/src/routes/renters.js`** : inchangé dans son fonctionnement, déjà couvert par
  l'Étape 20 (suppression auto de l'annonce à la signature d'un nouveau bail).

### Bug de sécurité réel trouvé en testant (corrigé avant d'aller plus loin)

Premier jet : `signMarketplaceToken` réutilisait la clé `accessSecret` DES EMPLOYÉS, avec un
simple champ `kind: 'marketplace_account'` dans le payload comme garde-fou applicatif. Un
test croisé (« un token compte Quick Immo doit être refusé sur une route employé ») a
répondu **403** au lieu du **401** attendu — creusé : `requireAuth` (employé) ne vérifie
JAMAIS ce champ `kind`, donc un token Quick Immo, signé avec la MÊME clé, se décodait avec
succès comme un `req.user` (avec `role: 'chercheur'`, un rôle qui n'existe pas côté employé)
et passait `requireAuth` — seul un hasard (aucune permission trouvée pour cet id
coïncidant) a produit un 403 au lieu d'un accès réel. Un compte du grand public aurait pu,
dans le pire cas, accéder à des routes employé si son `id` de compte coïncidait
numériquement avec l'`id` d'un vrai employé disposant de la permission requise. Corrigé
avec une séparation CRYPTOGRAPHIQUE, pas juste applicative : nouvelle clé dédiée
`JWT_MARKETPLACE_ACCOUNT_SECRET` (`config/env.js`) — un token de ce realm ne peut
mathématiquement pas être vérifié avec succès par `verifyAccessToken` (employé), quel que
soit son payload.

### Fichiers ajoutés — site `quick-immo/` (nouveau projet Next.js)

- Scaffold : `package.json`, `tsconfig.json`, `next.config.ts` (CSP adaptée, même schéma que
  `frontend/`), `tailwind.config.ts` + `app/globals.css` (copiés à l'identique).
- `lib/api/client.ts` : `apiFetch` simplifié (pas de cache hors-ligne IndexedDB, pas de
  cookie de session — inutile pour ce realm de comptes) ; `TENANT_ID` configurable par env.
- `lib/api/marketplace.ts` (lecture publique), `lib/api/accounts.ts` (comptes, demandes,
  favoris), `lib/auth/auth-context.tsx` (un seul jeton en `localStorage`, pas de refresh
  token httpOnly comme les employés — proportionné à l'absence d'enjeu sensible comparable).
- `components/layout/header.tsx` (nav + Inscription/Connexion/compte, menu mobile) et
  `footer.tsx`.
- Pages : `/` (grille des annonces + favoris si connecté en `chercheur`), `/inscription`,
  `/connexion`, `/confier-un-bien` (formulaire louer/vendre, réservé aux `proprietaire`
  connectés), `/mon-compte` (favoris pour un `chercheur`, suivi des demandes avec statut pour
  un `proprietaire`), `/a-propos`, `/contact` (coordonnées du cabinet résolues via l'API,
  jamais codées en dur).

### Bug d'environnement réel trouvé en testant (pas applicatif)

La page d'accueil affichait « Impossible de charger les annonces » en navigateur alors que
la même requête réussissait en `curl`/Node directement — `CORS_ORIGIN` (backend `.env`)
n'autorisait que `http://localhost:3000` (Lyko System), pas `http://localhost:3100` (Quick
Immo) : `fetch` depuis Node ne connaît pas les CORS (ce n'est qu'une politique de
navigateur), donc mes premiers tests API en ligne de commande ne pouvaient pas révéler ce
problème — seul un test EN NAVIGATEUR l'a montré. Corrigé en ajoutant `:3100` à
`CORS_ORIGIN`.

### Tests effectués

- [x] Script API dédié, 27 vérifications (cabinet jetable) : inscription/connexion des deux
  rôles, mauvais mot de passe rejeté, favoris (ajout/liste/retrait), un `chercheur` ne peut
  PAS soumettre une demande (403), un `proprietaire` peut, la demande apparaît côté
  propriétaire (`requests/mine`) ET côté employé (`GET /api/marketplace/requests`) avec le
  bon nom/téléphone, le traitement employé (`PATCH .../requests/:id`) se répercute côté
  propriétaire, téléphone dupliqué refusé (409), et — le test le plus important — un jeton
  Quick Immo est bien rejeté (401) sur une route employé et vice-versa.
- [x] Firefox headless, parcours complet sur Quick Immo (cabinet jetable, tenant pointé
  temporairement via `NEXT_PUBLIC_TENANT_ID` avant d'être remis sur 8/KIko Store) : page
  d'accueil avec les vraies annonces publiées, inscription `chercheur` → mise en favori
  visible sur `/mon-compte`, déconnexion, inscription `proprietaire` → soumission « vendre »
  → confirmation → statut « EN ATTENTE » visible sur `/mon-compte`.
- [x] Firefox headless côté Lyko System : le DG voit la demande dans « Demandes reçues »
  avec le nom/téléphone du propriétaire, clique « Accepter » → statut « ACCEPTÉE » avec
  l'auteur du traitement affiché, toast de confirmation.
- [x] `tsc --noEmit`/`next lint` propres sur les deux projets frontend (`frontend/` et
  `quick-immo/`).
- Cabinet de test supprimé après coup ; KIko Store (14 baux) confirmé inchangé — `quick-immo`
  repointé sur `NEXT_PUBLIC_TENANT_ID=8` (production), où la liste des annonces est
  légitimement vide (aucune Unité KIko Store n'est actuellement publiée).

### Complément : vraie page d'accueil (au lieu de rediriger directement vers la grille)

Demande directe de l'utilisateur : « on va ajouter une page d'accueil, expliquez le site,
ajouter un background hyper optimisé et très jolie, ajouter des cards et d'images pour mieux
expliquer les sujets, organisé de manière pro ». Jusqu'ici, `/` affichait directement la
grille d'annonces (pas de vraie présentation du site) — restructuré :

- **`/marketplace`** (nouveau) : reprend exactement l'ancien contenu de `/` (grille complète,
  favoris) — extrait sans rien changer côté logique.
- **`/`** redevient une vraie page d'accueil « pro », section par section :
  - **Hero** : fond en **dégradé CSS pur** (`.hero-mesh`, `app/globals.css`) — trois dégradés
    radiaux superposés + deux « halos » flous animés (transform/opacity uniquement, désactivés
    si `prefers-reduced-motion`). Aucune image : zéro octet réseau, net à toute résolution,
    coût de rendu minime — répond littéralement à « hyper optimisé et très jolie » sans le
    compromis habituel (une vraie photo de fond aurait pesé plusieurs centaines de Ko).
  - **Comment ça marche** : deux colonnes (chercheur de logement / propriétaire), 3 étapes
    numérotées chacune avec une icône — explique concrètement les deux usages du site.
  - **Pourquoi Quick Immo** : 3 cartes de réassurance (biens vérifiés, accompagnement complet,
    gestion sérieuse via Lyko System) — réutilise la structure déjà éprouvée de `/a-propos`.
  - **Annonces à la une** : aperçu de 3 vraies annonces publiées (mêmes cartes/photos que
    `/marketplace`, `ListingCard` extrait dans `components/listing-card.tsx` pour être partagé
    par les deux pages sans dupliquer le code) — jamais des images de remplissage/stock ;
    message d'attente honnête si aucun bien n'est actuellement publié (le cas réel de KIko
    Store aujourd'hui) plutôt qu'une section vide ou trompeuse.
  - **CTA final** (créer un compte) + pied de page.
  - Navigation mise à jour partout (en-tête + pied de page) : « Accueil » ajouté, « Marketplace »
    pointe désormais vers `/marketplace`.

Testé : Firefox headless, page d'accueil complète (capture pleine page) + `/marketplace`
(toujours fonctionnelle après le déplacement) + un cabinet jetable avec une vraie annonce
publiée pour vérifier que la section « Annonces à la une » affiche correctement une carte
réelle (photo, prix, description, bouton WhatsApp). `tsc --noEmit`/`next lint` propres.
Cabinet de test supprimé après coup ; `quick-immo` repointé sur `NEXT_PUBLIC_TENANT_ID=8`
(KIko Store, 14 baux confirmés inchangés).

### Complément : visuel dans le hero + refonte des deux cartes « Comment ça marche »

Retour de l'utilisateur : « images en bannière et les cards "vous recherchez un logement"
et "vous recherchez un bien" doit être bien design ». Aucune vraie photo disponible pour le
hero (aucune Unité n'est encore publiée pour KIko Store) — plutôt qu'une image de
remplissage/stock, un **visuel en CSS pur** : deux cartes d'annonce (mêmes proportions que
`ListingCard`) superposées et légèrement inclinées, avec bandeau dégradé + icône maison, et
un badge flottant « Bien vérifié » — aperçu honnête de ce à quoi ressemble une vraie annonce
sur le site, toujours zéro octet réseau. Le hero passe en deux colonnes sur desktop (texte à
gauche, visuel à droite), empilé sur mobile (`HeroVisual`, `app/page.tsx`).

Les deux cartes « Vous cherchez un logement » / « Vous avez un bien » (`StepsColumn`)
refaites avec : un bandeau d'en-tête en dégradé (bleu marine pour les chercheurs, bleu
« info » pour les propriétaires) avec une grande icône + un sous-titre, et un bouton d'action
en bas de carte (« Voir les annonces » / « Confier mon bien ») — les deux cartes s'alignent
sur la même hauteur (`flex flex-col` + `flex-1` + `mt-auto` sur le bouton) quel que soit le
nombre de lignes de texte de chaque étape.

Testé : Firefox headless, capture du hero (visuel flottant bien positionné, badge « Bien
vérifié » visible) + des deux cartes (bandeaux colorés, boutons alignés en bas) + un rendu
mobile (390px, aucun débordement horizontal, hero empilé proprement). `tsc --noEmit`/
`next lint` propres.

### Complément : positionnement correct (plateforme, pas une agence) + plafond légal de commission

Correction importante de l'utilisateur : « nous ne sommes pas une agence, Quick Immo est une
plateforme qui permet directement aux agences ou à un propriétaire de vendre, louer ou
confier ces biens aux agences partenaires de Quick Immo » — plus « nous faisons respecter la
loi : tout bien loué ici ne doit pas excéder une commission de 50 % du loyer ». Le texte
initial du site disait à plusieurs endroits « notre agence », ce qui laissait croire que
Quick Immo EST une agence immobilière (faux) plutôt qu'une plateforme reliée à PLUSIEURS
agences partenaires. Recherche exhaustive (`grep -rn "agence"`) et correction de toutes les
occurrences trouvées : page d'accueil (bandeau du hero, sous-titre, cartes de réassurance,
étapes « comment ça marche »), page À propos (introduction + cartes), page Confier un bien
(intro + message de confirmation), page Marketplace, Mon compte, Inscription, métadonnées
(`layout.tsx`). Partout, « notre agence »/« une agence de confiance » devient « une agence
partenaire »/« nos agences partenaires ».

Nouveau : un bloc « Notre engagement » sur la page À propos (icône `Scale`, fond vert
succès) énonçant le plafond légal de commission, plus une ligne de rappel dans le pied de
page du site entier (visible sur toutes les pages) et une note courte sur la page « Confier
un bien » (pertinente au moment où un propriétaire envisage justement de louer). Portée
volontairement limitée à un ajustement de contenu/texte — l'architecture technique reste
inchangée (toujours scopée à un seul cabinet pour l'instant, `NEXT_PUBLIC_TENANT_ID`).

Testé : Firefox headless (hero et À propos, texte corrigé bien affiché, bloc « Notre
engagement » et ligne de pied de page visibles). `tsc --noEmit`/`next lint` propres.

### Complément : vraie photo dans le hero (remplace la maquette de cartes)

Demande de l'utilisateur, désignant précisément la maquette de cartes en CSS du hero : « nous
allons mettre une image là ». Question posée : fournir un fichier précis, ou choisir une
photo libre de droits ? → **libre de droits**. Recherche (`WebSearch`/`WebFetch`) d'une photo
immobilière sous licence Unsplash (gratuite, usage commercial autorisé, aucune attribution
requise) — une rue de maisons modernes au bord d'un lac, cohérente avec le ton du site.
Téléchargée en local dans `quick-immo/public/hero-house.jpg` (jamais un lien externe : pas de
dépendance à un hébergeur tiers, respecte la CSP existante `img-src 'self'` sans la modifier,
et reste joignable même si Unsplash est indisponible). Affichée via `next/image` (`fill`,
`priority`, `sizes` adapté) plutôt qu'une balise `<img>` brute — contrairement aux photos de
biens (servies dynamiquement par l'API), celle-ci est un atout statique du site : `next/image`
la redimensionne/optimise automatiquement, cohérent avec l'exigence « hyper optimisé » du
premier jet du hero.

La double maquette de cartes inclinées (`HeroVisual`) est remplacée par cette photo dans un
cadre arrondi avec ombre, conservant les badges flottants (« Bien vérifié », nouveau
« Agences partenaires » — cohérent avec la correction de positionnement ci-dessus).

Testé : Firefox headless, rendu desktop (photo nette, badges bien positionnés) et mobile
(390px, empilement propre, aucun débordement). `tsc --noEmit`/`next lint` propres.

### Complément : refonte des cartes « Pourquoi Quick Immo »

Demande de l'utilisateur : refaire le design de cette section, jusque-là trois cartes
blanches identiques avec une petite icône. Chaque carte reçoit désormais sa propre couleur
d'accent (vert succès = confiance, bleu marine = accompagnement, bleu info = sérieux du
suivi) : une fine barre colorée en haut de la carte, une icône plus grande dans un cercle
teinté assorti, et un léger effet de survol (translation + ombre) pour l'interactivité.
Sous-titre ajouté pour introduire la section. Composants `Card`/`CardContent` remplacés par
des `div` stylées directement — plus de contrôle sur la barre d'accent superposée
(`absolute inset-x-0 top-0`) qu'avec la structure fixe de `Card`.

Testé : Firefox headless (les trois couleurs d'accent bien rendues, icônes et texte alignés).
`tsc --noEmit`/`next lint` propres.

## Étape 22 — Journal des dépenses regroupé par jour (Comptabilité)

Retour sur Lyko System : demande de l'utilisateur de transformer le Journal des dépenses en
un journal d'activité daté, à l'exemple donné (« Mardi 23/01/2026 / Vidange des véhicules
12h14 / Lundi 23/01/2026 / achat des matériels 09:45 / transport 09:12 ») — regrouper les
écritures par jour avec un en-tête « nom du jour + date », afficher l'heure de chaque
écriture, et le nom de la personne qui l'a enregistrée.

Le nom de l'enregistreur était déjà affiché (`expense.recordedBy`) ; il manquait le
regroupement par jour et l'heure. Point technique vérifié avant de coder : `Expense` expose
déjà `createdAt` (horodatage complet), tandis que `expenseDate` (colonne affichée jusque-là)
n'est qu'une date sans heure, et surtout **modifiable librement par l'utilisateur** dans le
formulaire de saisie (`expDate`, `ExpenseForm`) — une dépense peut donc être enregistrée un
jour et datée à un autre jour (passé ou futur). Le back-end trie déjà le journal par
`created_at DESC` (ordre de saisie), précisément pour qu'une dépense ressaisie plus tard avec
une date antérieure ne se retrouve pas « perdue » plus bas dans la liste (commentaire existant
dans `backend/src/routes/accounting.js`). **Décision : regrouper par le jour de `createdAt`**
(jour de saisie), pas par `expenseDate` — cohérent avec ce choix de tri déjà en place, et
avec la formulation de l'utilisateur (« journal des activités daté »,  c'est-à-dire quand
l'action a été faite). La colonne « Date » (= `expenseDate`) reste affichée sur chaque ligne
en plus du nouvel en-tête de jour : les deux dates peuvent légitimement différer (constaté sur
les vraies données de KIko Store, voir tests ci-dessous), et masquer l'une des deux aurait
fait disparaître une information réelle.

Piège de fuseau horaire identifié avant d'écrire le moindre code d'affichage : le pool MySQL
est configuré en `timezone: 'Z'` alors que le serveur MySQL lui-même tourne en heure locale
(`Africa/Porto-Novo`, WAT, UTC+1, vérifié via `SELECT @@session.time_zone, NOW(),
UTC_TIMESTAMP()`) — les chiffres de `created_at` sont donc de l'heure locale, mais réétiquetés
« UTC » à la sérialisation JSON. Formater ces horodatages avec la conversion de fuseau horaire
par défaut du navigateur (`toLocaleTimeString` sans `timeZone`) aurait décalé l'heure affichée
d'une heure. Deux nouveaux helpers dans `frontend/lib/utils.ts`, tous deux forçant
`timeZone: "UTC"` pour relire les chiffres tels quels (même principe déjà appliqué par
`formatDateLabel`, existant, pour les dates) :
- `formatDateHeading(isoDate)` → en-tête « Mardi 23/01/2026 » (jour de semaine + date).
- `formatTimeOfDay(isoTimestamp)` → heure « HH:MM » à partir de `createdAt`.

Dans `frontend/app/espace/comptabilite/comptabilite-view.tsx` : les dépenses sont regroupées
par jour (`createdAt.slice(0, 10)`, un simple découpage de chaîne — aucune conversion de
`Date` nécessaire, donc aucun risque de décalage) via un `useMemo` qui préserve l'ordre déjà
décroissant renvoyé par l'API. Chaque groupe affiche un en-tête (jour + date, nombre
d'écritures, sous-total du jour) suivi d'un tableau à ses propres colonnes : **Heure** (nouvelle
colonne) | Date | Libellé | Catégorie | Montant | Mode | Enregistré par | Actions.
`ExpenseRow` inchangé à part l'ajout de la cellule Heure et le `colSpan` des formulaires
d'édition/suppression en ligne, passé de 7 à 8.

Testé : navigation réelle en tant que DG (Marcel Mahougnon) sur les vraies données KIko
Store — le journal affiche bien « Vendredi 11/09/2026 · 3 écritures · 38 500 FCFA » puis
« Mercredi 09/09/2026 · 3 écritures · 171 000 FCFA », heures affichées correctes (18:45,
18:19, 18:13 puis 13:02, 13:01, 13:00, dans le bon ordre), enregistreur bien nommé pour
chaque ligne. Repéré au passage un cas réel où `expenseDate` (30/09) diffère du jour de
saisie (09/09) — confirme que garder les deux colonnes était le bon choix, aucune donnée
perdue. `tsc --noEmit` propre sur les fichiers modifiés.

Bug-fix (avant ce test) : découvert deux arbres `next dev`/`nodemon` dupliqués tournant en
parallèle (déjà rencontré à plusieurs reprises cette session, voir Étape 21) — nettoyé
(processus dupliqués tués, `frontend/.next` reconstruit, un seul serveur relancé) avant de
constater que le premier test de connexion échouait silencieusement (soumission GET brute,
React non hydraté) à cause du cache corrompu résiduel.

## Étape 23 — Écart compteur/décompteur configurable, paiements partiels, index préremplis (Charges SONEB/SBEE)

Demande de l'utilisateur : description écrite du fonctionnement voulu du module Charges —
distinction compteur (abonnement officiel SONEB/SBEE) / décompteur (sous-compteur interne
par locataire quand plusieurs logements partagent un même compteur), index début/fin à
chaque niveau avec report automatique de l'index de fin précédent, écart compteur
principal/Σ décompteurs réparti **de façon configurable par Bien** (à la charge du
propriétaire OU répartie au prorata entre locataires — jusque-ici toujours et uniquement
informatif, jamais facturé), et factures avec statut payé/partiellement payé/en retard
pouvant recevoir plusieurs paiements successifs.

Avant de coder : comparaison de cette description avec le module Charges existant
(`backend/src/routes/{charges,utilityReadings}.js`, Étape 9/9bis). La mécanique de relevé
(index début/fin, décompteur = `property_units.{soneb,sbee}_meter_number`, écart affiché)
correspondait déjà à la description. Trois écarts réels identifiés et confirmés avec
l'utilisateur avant d'implémenter : (1) aucune répartition configurable de l'écart —
jusque-ici toujours et uniquement informative (décision explicite d'origine, migration 020,
« jamais refacturée automatiquement ») ; (2) aucun report automatique de l'index dans le
flux de charge directe (hors relevé par immeuble) ; (3) statut binaire payée/impayée,
aucun paiement partiel. Question posée sur l'affichage de la part de pertes sur la facture
→ **ajoutée comme ligne sur la facture du locataire** (montant mesuré + part de pertes,
visibles séparément), pas une facture à part.

Portée volontairement limitée à ces trois points, codés et testés comme un tout cohérent ;
deux points de la description (plusieurs compteurs indépendants par fluide sur un même
Bien, et le branchement du statut de facture sur le module de rappel WhatsApp) sont
**différés** — signalés à l'utilisateur plutôt que traités par défaut, la description ne
distinguant pas leur urgence des trois premiers.

### 1. Répartition configurable de l'écart

`properties.{soneb,sbee}_loss_allocation` — ENUM('proprietaire','prorata'), **défaut
'proprietaire' partout** (comportement historique préservé pour tout Bien n'ayant jamais
touché ce réglage). Configurable depuis la carte « Compteurs & fluides » de la fiche Bien,
au même endroit que le tarif/n° de compteur. À la validation d'un relevé
(`POST /utility-batches/:id/validate`), si le réglage est 'prorata' et l'écart réellement
positif (jamais la différence « négative » — décompteurs > compteur principal — qui signale
une anomalie de relevé, pas une perte) : l'écart est distribué au prorata de la consommation
propre de chaque locataire **effectivement facturé** (bail actif) ce mois-ci, ajouté à sa
facture comme `loss_share_amount` distinct du montant de consommation mesurée
(`consumptionAmount`). Décision produit explicite (non spécifiée par l'utilisateur, donc
consignée ici) : la part d'une unité vacante ou sans bail retombe sur les locataires en
place plutôt que d'être simplement absorbée sans base — cohérent avec le choix « au prorata
entre locataires », ajustable si l'utilisateur préfère une autre règle.

### 2. Paiements multiples/partiels

Nouvelle table `utility_payments` (miroir exact de `rent_payments` pour le loyer) : une
ligne par règlement. `utility_charges.status` devient `impayee` / `partiellement_payee` /
`payee`, dérivé de `SUM(utility_payments.amount)` vs `amount` — jamais resaisi à la main.
`PATCH /:id/pay` (tout ou rien) remplacé par `POST /:id/payments` (montant libre, refusé si
dépasse le solde restant) + `GET /:id/payments` (historique). Garde anti-doublon (paiement
identique < 2 min) et verrou de ligne (`FOR UPDATE`), même principe que
`routes/leases.js`. Rétro-remplissage migré : chaque facture déjà `payee` avant cette étape
reçoit son paiement correspondant dans la nouvelle table (les 2 factures réelles de KIko
Store, dont une déjà payée, vérifiées identiques après migration). Nouvelle garde : un
paiement déjà enregistré (même partiel) fige les index/tarif de la facture (`PATCH /:id`
refuse toute modification du montant, 409) — sinon la facture se désynchroniserait de ce qui
a déjà été réglé.

### 3. Index de début préremplis (flux de charge directe)

`GET /api/charges/previous-reading?leaseId=&utilityType=` renvoie l'index de fin de la
dernière facture de ce bail pour ce fluide ; la page « Nouvelle charge » préremplit l'index
de début avec cette valeur (reste modifiable). Le flux du relevé par immeuble avait déjà ce
report (Étape 9bis) — n'existait pas pour la charge directe, seul cas manquant.

### Différé (signalé à l'utilisateur, pas traité silencieusement)

- **Plusieurs compteurs indépendants par fluide sur un même Bien** (ex. deux abonnements
  SBEE séparés) : le schéma actuel n'a qu'un seul compteur principal par fluide par Bien
  (`soneb_main_meter_number`/`sbee_main_meter_number`, colonne unique) — passer à plusieurs
  demanderait de transformer ce compteur en entité à part (table dédiée), une refonte plus
  large et plus risquée sur des données réelles déjà en production que les trois points
  ci-dessus.
- **Statut de facture → module de rappel WhatsApp** : `rentTracking.js`/`/espace/relances`
  ne connaissent aujourd'hui que le loyer (`rent_payments`), jamais `utility_charges`.

### Tests

Aucune tenant jetable pour la vérification visuelle finale (lecture/affichage seulement sur
KIko Store) mais TOUTE écriture testée sur un tenant jetable créé via l'API réelle
(`POST /api/auth/register`), jamais sur KIko Store :
- Relevé SBEE avec écart positif délibéré (décompteurs 100+80 unités, compteur principal
  200 unités, tarif 200 FCFA) et répartition 'prorata' activée : `consumptionAmount`
  exacts (20 000 / 16 000), `lossShareAmount` proportionnels (2222/1778, somme exacte 4000),
  `amount = consumptionAmount + lossShareAmount`.
- Même scénario avec le réglage resté 'proprietaire' (par défaut) : `lossShareAmount = 0`
  malgré un écart réel — non-régression du comportement d'origine confirmée.
- Paiement partiel puis complémentaire exact → statut `partiellement_payee` puis `payee` ;
  paiement sur facture déjà payée rejeté (400) ; dépassement du solde restant rejeté (400).
- Modification des index sur une facture avec paiement → rejetée (409) ; sur une facture
  sans aucun paiement → acceptée (200).
- `previous-reading` renvoie bien l'index de fin de la facture la PLUS RÉCENTE (pas une
  plus ancienne) pour un bail/fluide donné.
- Nettoyage : tenant jetable entièrement supprimé (cascade FK vérifiée : 0 ligne restante
  dans `properties`/`leases`/`utility_charges`/`utility_payments`) ; KIko Store (tenant 8)
  reconfirmé intact après coup — 14 baux, les 2 factures réelles bit-à-bit inchangées.
- Vérification visuelle réelle (Firefox headless, DG connecté) : onglet « Partiellement
  payées », panneau de règlement avec montant modifiable et solde restant affiché,
  sélecteur « Écart compteur principal / décompteurs » sur la fiche d'un Bien réellement
  sous-compté (BIEN-008) — fermé sans enregistrer pour ne pas modifier sa configuration
  réelle, reconfirmé inchangée en base après coup. `tsc --noEmit`/`next lint` propres sur
  tous les fichiers modifiés.

### Trouvaille annexe (hors périmètre de cette étape, signalée pas corrigée)

Le script de test a découvert un bug préexistant, sans rapport avec ce qui précède :
`POST /api/auth/register` immédiatement suivi d'un `POST /api/auth/login` pour le même
utilisateur **dans la même seconde** renvoie une erreur 500 brute (au lieu de 200). Cause :
`signRefreshToken()` (`backend/src/utils/jwt.js`) ne porte aucun identifiant unique par
émission (`jti`) et `iat` n'a qu'une résolution à la seconde — deux jetons émis la même
seconde pour le même utilisateur sont byte-à-byte identiques, ce qui viole la contrainte
unique `refresh_tokens.uq_refresh_tokens_hash` (`services/session.js`) ; l'erreur MySQL
brute n'étant pas interceptée, elle fuit telle quelle au client. Pourrait toucher un
utilisateur réel qui double-clique sur « Se connecter » ou ouvre deux onglets à la fois.
Non corrigé — hors périmètre de la demande, à traiter dans une étape dédiée si confirmé
prioritaire.

## Étape 24 — Menu vertical, responsive et animations (refonte du design de l'espace connecté)

Demande de l'utilisateur : revoir le design dans son ensemble — menu vertical (jusque-là un
en-tête horizontal), bonne responsivité, animations, éléments attractifs, couleurs « très
attractives, jolies, très explicites, de qualité », avec l'exigence explicite d'un rendu
« de travail d'expert » où chaque partie cliquée met l'utilisateur à l'aise.

Portée traitée dans cette étape : la coquille de navigation (menu vertical + sa
responsivité + ses animations) et une passe de polish sur les composants UI partagés — le
levier le plus large possible en une fois, puisque ces deux points touchent automatiquement
les ~29 pages de l'espace connecté sans avoir à en redessiner chacune individuellement.
**Différé, signalé plutôt que traité silencieusement** : un remaniement bespoke du contenu
propre à chaque page (mise en page spécifique des tableaux de bord, formulaires, etc.) —
un chantier d'une toute autre ampleur, à traiter page par page si souhaité.

### Architecture : un point d'entrée unique au lieu de 29 répétitions

Avant : chaque page (`*-view.tsx`, 29 fichiers) montait individuellement `<EspaceHeader />`
(en-tête horizontal, navigation repliée en tiroir sous `lg`) au sommet de son propre JSX —
aucun `app/espace/layout.tsx` n'existait. Nouveau : `app/espace/layout.tsx` (nouveau fichier)
monte le menu une seule fois pour tout l'espace connecté, et décale le contenu
(`lg:pl-sidebar`, token déjà présent mais inutilisé dans `tailwind.config.ts` depuis l'étape
0 — la maquette d'origine prévoyait déjà un sidebar, jamais construit jusqu'ici). Les 29
fichiers ont eu leur `<EspaceHeader />` et son import supprimés (mécanique, vérifié par
`tsc`/`lint` after coup — zéro référence orpheline) ; l'ancien composant
`components/espace/espace-header.tsx` est supprimé, remplacé par
`components/espace/espace-sidebar.tsx` (`EspaceSidebar`). Bénéfice concret au-delà du
visuel : `startQueueAutoSync` (file hors-ligne, étape 11) n'est désormais appelé qu'une
fois par session au lieu d'être remonté à chaque navigation — plus proche de l'intention
d'origine du commentaire qui l'accompagnait.

`EspaceSidebar` reste masqué (`return null`) tant que `status !== "authenticated"` — chaque
page garde son propre écran de chargement/accès refusé (`RequireAuth`) affiché seul, jamais
un menu peuplé qui flash avant une redirection vers `/connexion`. `EspaceLayout` applique
lui-même le décalage `lg:pl-sidebar` seulement une fois authentifié (sinon l'écran de
chargement, centré sur toute la largeur par `RequireAuth`, se serait retrouvé décalé à
droite pendant que le menu ne rend encore rien).

### Menu vertical

Regroupé par section (Vue d'ensemble / Patrimoine / Opérations / Finances /
Administration) avec libellé de groupe en majuscules discret — amélioration de clarté
notable : l'ancienne barre horizontale n'avait aucun regroupement (liste plate de jusqu'à
10 liens) ni la moindre icône. Chaque lien reçoit désormais une icône `lucide-react`
distincte. État actif : liseré vertical en dégradé de marque (repris du logo, `#1E3A8A` →
`#2563EB` → `#38BDF8`, nouveau token `bg-brand-gradient`) + fond teinté + icône colorée ;
survol : léger déplacement horizontal + fond, transitions douces (150ms). Pied de menu :
avatar (initiales, dégradé de marque), nom + rôle (`Badge`), indicateur de connexion,
réglages (DG) et déconnexion (bouton icône seul — voir bug ci-dessous).

Responsive : fixe (260px, token `sidebar` déjà défini) à partir de `lg` (1024px) ; en
dessous, barre compacte (logo + connexion + hamburger) et un tiroir plein-hauteur
coulissant (fond assombri + flou léger, fermeture au clic dehors ou sur le bouton ✕),
plutôt que l'ancien simple repli en liste. Nouvelles animations (`tailwind.config.ts`) :
`sidebar-in` (glissement du tiroir), `fade-in` (fond assombri), `page-in` (fondu + léger
glissement vertical à chaque changement de page, `<main key={pathname}>` pour forcer un
remontage — sans la clé, l'élément appartient à la coquille stable et ne rejouerait
l'animation qu'au tout premier chargement).

### Bug trouvé et corrigé en cours de route (pas dans le code d'origine — introduit puis corrigé dans cette étape)

Le bouton « Se déconnecter » du pied de menu copiait un motif `hidden sm:inline` pensé pour
l'ancien en-tête HORIZONTAL (le texte se cache sous le breakpoint `sm`, pensé par rapport à
la largeur de tout le viewport). Dans une colonne verticale fixe de 260px, ce breakpoint ne
correspond à rien d'utile : sur desktop (viewport large, `sm` toujours vrai) le texte
« Se déconnecter » essayait de s'afficher à côté de « Réglages » dans une colonne trop
étroite et retombait sur deux lignes, doublant la hauteur de la rangée. Repéré par une
vérification du DOM en plus de la capture d'écran (hauteur de la rangée deux fois celle de
« Réglages »). Corrigé une première fois : bouton de déconnexion en icône seule (`title`/
`aria-label` pour l'accessibilité), `whitespace-nowrap` sur le lien Réglages — plus aucune
ambiguïté de largeur disponible.

**Correction ultérieure (retour direct de l'utilisateur : « il n'y a pas de manière de se
déconnecter »)** : cette première correction est allée trop loin — un bouton icône seule de
36×36px, sans aucun texte visible, tout en bas d'une colonne, n'était tout simplement pas
repérable comme « le bouton pour se déconnecter ». Vérifié que le bouton fonctionnait
techniquement (clic Selenium réel, redirection vers /connexion confirmée) — ce n'était donc
pas un bug fonctionnel mais un vrai problème de repérabilité côté design. Corrigé
définitivement : Réglages et Se déconnecter passent chacun en rangée pleine largeur
(icône + libellé visible), empilées verticalement au lieu de se partager une seule rangée
trop étroite — élimine le problème de largeur à la racine plutôt que de sacrifier le texte.
Léger `pb-4` ajouté au pied de menu par précaution (ce coin bas-gauche est aussi où
s'affiche le badge de développement Next.js — cosmétique, absent en production, mais autant
laisser un peu d'air).

### Polish des composants partagés (bénéficie à toutes les pages sans les toucher une par une)

- `Button` : `transition-colors` → `transition-all` + `active:scale-[0.97]` — retour
  tactile au clic sur tous les boutons de la plateforme, un seul fichier changé.
- `StatCard` (tuiles de tableau de bord) : léger soulèvement au survol
  (`hover:-translate-y-0.5 hover:shadow-md`) — même principe, un seul fichier.
- `Table`/`TableRow` avait déjà `transition-colors hover:bg-surface-hover` (étape 0) —
  inchangé, déjà cohérent avec cette passe.
- Couleurs : délibérément **pas** de refonte des teintes sémantiques existantes
  (`success`/`warning`/`danger`/`info`, déjà des teintes Tailwind vives et déjà utilisées de
  façon cohérente et signifiante sur des dizaines de pages — les changer aurait été un
  risque de régression visuelle large pour un gain incertain). Seul ajout : le token
  `bg-brand-gradient`, réservé à des touches décoratives ponctuelles (liseré actif, avatar)
  — jamais un grand aplat derrière un logo d'entreprise arbitraire, dont le contraste n'est
  pas maîtrisé (vérifié : le logo réel de KIko Store est un monochrome noir/blanc, illisible
  sur un fond sombre).

### Tests

Aucune écriture de données dans cette étape (uniquement de la navigation/affichage) — testé
directement sur KIko Store, en lecture seule, DG connecté (Marcel Mahougnon) :
- `tsc --noEmit` et `next lint` propres après la suppression des 29 `<EspaceHeader />` (une
  suppression manquée ou un import orphelin serait immédiatement remonté par l'un des deux).
- Firefox headless, desktop (1600px) : tableau de bord, comptabilité, charges, biens,
  nouveau bien, employés, réglages — menu, groupes, icônes, état actif, dégradé, pied de
  menu tous corrects ; toutes les données réelles de KIko Store rendues à l'identique
  (taux d'occupation 73 %, 11 baux actifs, 2 575 000 FCFA encaissés, etc.).
- Firefox headless, mobile (390px) : barre compacte, ouverture/fermeture du tiroir,
  fond assombri correctement en arrière-plan (vérifié par inspection du DOM — `z-index`
  calculé 30/40/50 pour barre/fond/tiroir respectivement, pas seulement à l'œil).
- Bug du bouton de déconnexion trouvé ET corrigé avant validation finale (voir ci-dessus).
- Bug-fix environnement (avant les tests) : `/tmp/geckodriver` et le lien symbolique
  `node_modules` du scratchpad avaient de nouveau disparu (voir Étape 22/23) — recréés.

## Étape 25 — Pages 404 avec message et lien vers une URL valide

Demande de l'utilisateur (juste après un nouvel épisode de « css ne s'applique pas », résolu
comme d'habitude — deuxième `npm run dev` lancé depuis un autre terminal, arbres tués,
`.next` reconstruit) : profiter du sujet des URLs invalides pour écrire un message qui
permette à l'utilisateur de repartir vers une URL valide plutôt que de tomber sur le 404 brut
et sans style de Next.js.

Deux pages, pas une seule, pour une raison précise découverte pendant le test : `app/not-
found.tsx` (nouveau) couvre tout le site public (marketing, connexion, portails) avec l'en-
tête/pied de page du site, un message, et un bouton dont la destination s'adapte à la session
(`useAuth()`) — « Retourner à l'accueil » si déconnecté, « Retourner à mon espace » si
authentifié (jamais renvoyé vers /connexion, qui l'aurait de toute façon redirigé vers
/espace). `app/espace/not-found.tsx` (nouveau) couvre les URLs invalides SOUS `/espace/**` en
conservant le menu vertical (`EspaceSidebar`) — sans lui, un employé déjà connecté qui tape
une URL erronée dans son espace se serait retrouvé sur le 404 public, menu disparu, en-tête
marketing hors contexte affiché à sa place.

**Piège Next.js découvert en testant** (comportement du framework, pas un bug applicatif) :
un `not-found.tsx` imbriqué (`app/espace/not-found.tsx`) ne s'active PAS automatiquement pour
une URL qui ne correspond à aucune route de ce segment — seul un appel explicite à
`notFound()` (import `next/navigation`) depuis une page de ce même segment le déclenche.
Sans rien de plus, `/espace/n-importe-quoi` remontait directement au 404 racine (vérifié :
premier test, capture d'écran montrant l'en-tête public « Se connecter »/« Créer mon compte »
à la place du menu). Corrigé avec le patron documenté de Next.js : une route générique
`app/espace/[...catchAll]/page.tsx` qui ne fait qu'appeler `notFound()` — vivant dans le
segment `/espace/`, Next.js remonte alors au `not-found.tsx` le plus proche de LÀ, donc celui
de l'espace, tout en gardant `app/espace/layout.tsx` (donc le menu) monté autour.

Testé (Firefox headless, aucune écriture de données) :
- Déconnecté, URL racine invalide → 404 avec en-tête/pied de page publics, bouton
  « Retourner à l'accueil » + lien « Se connecter ».
- Connecté (DG), URL invalide sous `/espace/` → 404 avec le menu vertical intact (vérifié
  par la présence de l'élément `<aside>`, pas seulement à l'œil), bouton unique
  « Retourner à mon espace ».
- Connecté, URL racine invalide (hors `/espace/`) → bouton adapté automatiquement
  (« Retourner à mon espace », jamais « à l'accueil »).
- Point de vigilance noté pendant le test, pas un bug : après une navigation complète du
  navigateur (pas une transition SPA), `useAuth()` repart de `status:"loading"` le temps
  d'un aller-retour vers `/api/auth/me` — un contrôle fait trop tôt après le chargement de la
  page verrait donc encore l'état « déconnecté ». Comportement déjà présent partout ailleurs
  dans l'appli (`RequireAuth` a son propre écran de chargement pour la même raison), pas une
  régression de cette étape.
- `tsc --noEmit`/`next lint` propres.

## Étape 26 — Attribution d'un Bien à un agent introuvable (en réalité : invisible, pas cassée)

Signalement de l'utilisateur : « la fonctionnalité d'assignation des biens aux agents ne
marche pas on dirait ». Avant de toucher au moindre code, reproduction complète du
mécanisme sur un tenant jetable créé via l'API réelle (jamais sur KIko Store) : création
DG/propriétaire/2 Biens/1 agent, puis attribution réalisée EN PASSANT PAR LE NAVIGATEUR RÉEL
(Selenium) exactement comme un DG le ferait — recherche du Bien sur la fiche de l'agent,
sélection, clic « Attribuer ». Résultat : succès complet, à chaque étage vérifié
séparément — le back-end enregistre bien `agent_id`, ET la restriction de portée s'applique
immédiatement (connexion en tant que cet agent : ne voit plus que le Bien qui lui a été
attribué, plus l'autre). Le mécanisme lui-même n'avait donc aucun bug.

Le vrai problème, confirmé en lisant les deux pages où un DG chercherait naturellement cette
fonctionnalité : **le seul contrôle existant vivait sur la fiche de l'employé** (`Biens
gérés`, en bas de la page « Modifier l'employé ») — rien sur la fiche du Bien lui-même
(juste un badge en lecture seule « Géré par X », aucun moyen d'agir), rien non plus sur la
liste « Nos biens » ni sur la liste « Employés » pour confirmer visuellement qu'une
attribution a eu lieu. Un DG pensant « je vais attribuer CE bien à un agent » et cherchant
sur la fiche du Bien ne trouvait donc littéralement rien d'actionnable — exactement le même
type de problème que le bouton de déconnexion invisible (étape 24) : le mécanisme
fonctionnait, seule sa découvrabilité était en cause.

Trois ajouts, tous purement additifs (aucun changement du mécanisme d'attribution
lui-même, qui fonctionnait déjà) :
1. **Carte « Agent responsable » sur la fiche du Bien** (`bien-view.tsx`, nouveau composant
   `AgentAssignmentCard`, réservé au DG) : liste déroulante des agents actifs de
   l'entreprise + bouton « Attribuer », ou bouton « Retirer » si déjà attribué — réutilise
   les mêmes fonctions d'API que la fiche employé (`assignProperties`/`unassignProperty`),
   aucun nouvel endpoint back-end nécessaire.
2. **Colonne « Agent » sur la liste « Nos biens »** (`biens-view.tsx`, DG uniquement) —
   « Tout agent » si non attribué, le nom de l'agent sinon.
3. **Indicateur « N Bien(s) attribué(s) » sur la liste « Employés »** (`employes-view.tsx`)
   — a nécessité un petit ajout côté back-end : `GET /api/employees` renvoie désormais
   `managedPropertiesCount` par employé (sous-requête `COUNT(*) ... GROUP BY agent_id`,
   toujours 0 pour un comptable). `GET /api/employees/:id` calcule la même valeur à partir
   de `managedProperties.length` déjà chargé, pour rester cohérent sans requête
   supplémentaire.

Testé : le scénario complet ci-dessus rejoué après les trois ajouts (tenant jetable,
navigateur réel) — attribution depuis la nouvelle carte de la fiche du Bien (toast + badge
d'en-tête + carte mise à jour), colonne Agent visible sur « Nos biens », indicateur « 1 Bien
attribué » visible sur « Employés », retrait depuis la même carte (repasse au sélecteur).
Tenant jetable entièrement supprimé après coup ; KIko Store reconfirmé intact (14 baux, ses
8 Biens réels toujours à `agent_id NULL`, comme avant — cette étape n'a rien écrit sur les
données réelles, uniquement des ajouts de code testés sur un tenant jetable). `tsc --noEmit`
et `next lint` propres.

## Étape 27 — Export comptable (Excel) du registre

Demande directe de l'utilisateur, après une question exploratoire sur ce qui manquait
encore côté comptabilité/gestion d'entreprise — export choisi : le registre comptable en
Excel, jusque-là seulement disponible sous forme de rapport PDF agrégé (totaux, pas de
détail ligne à ligne) — aucun moyen de sortir les écritures individuelles pour un
rapprochement par un comptable externe.

Nouveau `GET /api/accounting/export.xlsx?from=&to=` (même permission `comptabilite`, même
période que le tableau de bord écran). Plutôt qu'inventer un nouveau calcul, réunit dans UN
classeur chronologique les 4 registres déjà exposés séparément à l'écran (paiements de
loyer, versements propriétaires, dépenses, charges SONEB/SBEE réglées via
`utility_payments`, étape 23), chacun avec une étiquette de type explicite plutôt que fondu
dans un solde unique — en particulier les travaux facturés à un Bien restent visibles
(étiquetés « charge propriétaire ») mais jamais mélangés avec les dépenses de
fonctionnement du cabinet, cohérent avec la règle déjà appliquée par
`computeAccountingDashboard` (jamais comptés dans le solde du cabinet). Colonnes Débit/
Crédit séparées (pas un montant signé), lignes triées chronologiquement (le sens de lecture
naturel d'un registre, à l'inverse des listes à l'écran qui affichent le plus récent en
premier), ligne de total et solde net en bas de feuille. Aucun nouveau calcul de fond :
uniquement des `SELECT` déjà connus (mêmes jointures que `/rent-payments`, `/owner-payouts`,
`/expenses`), juste réunis et formatés.

Format Excel réel (`.xlsx` via la nouvelle dépendance `exceljs`), pas un CSV : un CSV ouvert
tel quel dépend du séparateur attendu par la configuration régionale d'Excel (point-virgule
en France/Afrique francophone, virgule ailleurs) — un vrai classeur Excel élimine ce piège
entièrement, en plus de permettre des colonnes numériques correctement formatées (séparateur
de milliers) et des dates en cellules Date réelles (filtrables/triables dans Excel), pas du
texte.

Téléchargement authentifié géré par un nouveau `downloadAuthenticatedFile()`
(`lib/api/client.ts`) plutôt que de réutiliser `openAuthenticatedPdf` (`window.open`) : un
PDF s'affiche dans un onglet, un `.xlsx` non — `window.open` sur un blob Excel aurait donné
un onglet vide ou une invite peu fiable selon le navigateur. Nouveau helper : un `<a
download>` créé dynamiquement, cliqué par script, retiré — le mécanisme standard pour forcer
un téléchargement authentifié.

Testé : registre généré sur un tenant jetable (1 paiement de loyer, 1 versement
propriétaire, 1 dépense cabinet, 1 charge SONEB réglée) puis RELU avec `exceljs` pour
vérifier le contenu réel du fichier plutôt que seulement le code HTTP — chaque ligne, le tri
chronologique, le total (débit 35 000 / crédit 54 000) et le solde net (19 000) exacts au
franc. Bouton « Exporter (Excel) » testé en navigateur réel contre les vraies données KIko
Store (lecture seule, aucune écriture) : requête et blob corrects (200, bon type MIME, bonne
taille) vérifiés en exécutant exactement la même logique de téléchargement directement dans
la page — seule l'étape finale « écriture réelle sur disque » n'a pas pu être confirmée en
Firefox headless (limitation connue des tests automatisés sans affichage pour les
téléchargements par URL `blob:`, pas un défaut de l'application : le motif `<a download>` +
blob est la technique standard, qui fonctionne dans un navigateur normal). Tenant jetable
supprimé après coup ; KIko Store reconfirmé intact (14 baux, aucune écriture faite sur ses
données réelles — seule une requête `GET` en lecture y a été exercée). `node -c`/`tsc
--noEmit`/`next lint` propres.

Dépendance ajoutée : `exceljs` (backend). `npm audit` signale 2 vulnérabilités modérées
transitives (`uuid`, bug de vérification de bornes sur un usage avec buffer explicite,
jamais utilisé ici) — la correction proposée imposerait de revenir à `exceljs@3.4.0`
(changement cassant) pour un risque non pertinent dans ce contexte ; non appliqué,
à surveiller si `exceljs` publie un jour un correctif non cassant.

## Étape 28 — Rappels WhatsApp pour les charges SONEB/SBEE impayées

Deuxième idée de la liste « qu'est-ce qui manque encore » (après l'export Excel, étape 27) :
le Centre de relance (`/espace/relances`, étape 10) ne connaissait que le loyer — les
charges SONEB/SBEE impayées ou partiellement payées (statuts introduits à l'étape 23)
n'avaient aucun mécanisme de rappel, malgré un bouton WhatsApp équivalent déjà bien établi
pour le loyer.

Nouveau `GET /api/accounting/utility-arrears` (permission `charges` OU `comptabilite`,
même logique que `/arrears` avec `locataires`/`comptabilite`) — une ligne PAR FACTURE, pas
par locataire : contrairement au loyer qui s'accumule mécaniquement mois après mois (donc
agrégé par bail), une facture SONEB/SBEE est un événement plus ponctuel, et un locataire
avec 2 factures impayées simultanées reste un cas rare — agréger aurait ajouté de la
complexité de message pour peu de bénéfice. « En retard » = jours écoulés depuis
`billed_at`, faute d'échéance propre à une facture ponctuelle (contrairement au loyer, qui a
un `rent_due_day`) — inclut les factures `impayee` ET `partiellement_payee` (le montant dû
utilisé est `amount - paid_total`, jamais le montant brut de la facture pour une facture
partiellement réglée).

Nouvelle section sur `/espace/relances`, entre le tableau des retards de loyer et les
alertes prédictives : carte de synthèse (nombre de factures + montant total dû) puis un
tableau (locataire, bien/unité, fluide avec icône, montant dû, retard, bouton WhatsApp).
Nouveau message de relance dédié (`buildUtilityReminderMessage`, `lib/utils.ts`) — même ton
que le rappel de loyer, mais « facturée le » plutôt qu'une échéance. Élargi la permission de
page (`RequireAuth`) à `["locataires", "comptabilite", "charges"]` — sans ça, un comptable
n'ayant que la permission `charges` (pas `locataires`) aurait été bloqué à l'entrée de la
page alors que le back-end lui donnerait pourtant accès aux données.

Testé sur un tenant jetable (jamais KIko Store) : 3 factures créées — une impayée facturée
il y a 26 jours, une partiellement payée (2000/6000) facturée hier, une entièrement payée.
Vérifié via l'API que seules les deux premières apparaissent (montants dus exacts : 4000 et
4000, jours de retard exacts : 26 et 1) et que la facture payée est bien absente. Puis
vérifié en navigateur réel : la section s'affiche avec les bons montants/icônes, et le lien
WhatsApp du rappel décodé contient bien le message attendu (nom, fluide, montant, jours de
retard, date de facturation). Tenant jetable supprimé après coup ; KIko Store reconfirmé
intact (14 baux). `tsc --noEmit`/`next lint` propres.

## Étape 29 — Limite de téléchargement (5 max) + code de vérification d'authenticité

Demande directe de l'utilisateur : bloquer le téléchargement des documents remis aux
locataires et propriétaires à 5 fois maximum par document, et ajouter un code de
vérification sur les factures pour l'authentification. Trois questions de cadrage posées
avant de coder (documents concernés, comportement après la limite, profondeur de la
vérification) — recommandations retenues dans les trois cas : (1) quittance + attestation +
relevé propriétaire, les 3 documents téléchargeables depuis un portail sans compte employé
(le PV de sortie n'a aucun téléchargement portail aujourd'hui, uniquement côté employé) ;
(2) le DG peut réinitialiser le compteur depuis la fiche du locataire/propriétaire ; (3) une
page de vérification publique (`/verifier`) où n'importe qui entrant le code voit une
confirmation minimale, jamais de montant ni de donnée personnelle.

### Modèle et mécanique

Nouvelle table `document_issuances` (migration `032_document_issuances.sql`) : une ligne
par INSTANCE de document (la quittance du paiement #42, l'attestation du bail #7, le
relevé du propriétaire #3) — jamais par lien de portail, pour que régénérer un lien (déjà
possible depuis l'étape 12/13) ne remette jamais le compteur à zéro, ce qui viderait la
limite de tout son sens. Colonnes clés : `download_count`/`max_downloads` (5), un
`verification_code` unique (12 caractères, alphabet sans caractères ambigus 0/O/1/I/L —
pensé pour être retranscrit à la main depuis un PDF, contrairement aux tokens de portail
qui ne sont jamais tapés), et une traçabilité de réinitialisation
(`reset_count`/`last_reset_by`/`last_reset_at`).

Nouveau service `services/documentIssuance.js` : `getOrCreateIssuance` (première
consultation = création, avec gestion de la course entre deux premiers téléchargements
simultanés via le code d'erreur `ER_DUP_ENTRY`), `registerDownload` (incrémentation
atomique via `WHERE download_count < max_downloads` — aucun verrou explicite nécessaire),
`resetIssuance`, `findByVerificationCode` (jamais de montant ni de nom exposé, uniquement
type de document + entreprise émettrice + date).

Branché dans les 3 endpoints de portail concernés
(`routes/portal.js` receipt.pdf + certificate.pdf, `routes/ownerPortal.js` statement.pdf) —
JAMAIS dans leurs équivalents côté employé (`routes/leases.js`, `routes/renters.js`,
`routes/owners.js`), qui restent illimités : un employé doit pouvoir régénérer un document
pour ses propres besoins sans jamais buter sur une limite pensée pour l'abus d'un lien
public. Le code de vérification est imprimé sur le document via une extension de
`drawFooter()` (`services/pdf.js`) — une seconde ligne sous le pied de page existant,
seulement quand un code est fourni (jamais sur le PV de sortie ni le rapport comptable
interne, hors périmètre). Nouvelle variable d'environnement `FRONTEND_URL` (défaut
`http://localhost:3000`) pour imprimer l'adresse complète de la page de vérification, pas
seulement le code.

### Consultation/réinitialisation (espace employé) et vérification publique

Nouveau routeur `routes/documents.js` (`/api/documents`) : `GET
/:documentType/:referenceId/status` (tout employé authentifié du même tenant — une simple
donnée de suivi, pas sensible) et `POST /:documentType/:referenceId/reset` (DG uniquement,
`requireRole('dg')`) — les deux vérifient explicitement que la référence (paiement/bail/
propriétaire) appartient bien au tenant de l'appelant avant toute lecture/écriture, pour
qu'un employé ne puisse pas consulter/réinitialiser le compteur d'un document d'une autre
entreprise en devinant un identifiant.

Nouveau routeur PUBLIC `routes/documentVerification.js` (`/api/verify/:code`, aucune
authentification) avec son propre limiteur de débit (défense en profondeur, l'entropie du
code — 12 caractères sur un alphabet de 32, ~60 bits — rendant déjà l'énumération
impraticable, même raisonnement que `portalLimiter` à l'étape 12).

Nouveau composant partagé `components/documents/document-download-status.tsx` — badge
« N/5 téléchargements » (rouge si la limite est atteinte) + bouton de réinitialisation
visible seulement pour le DG ; n'affiche rien tant qu'aucun téléchargement n'a eu lieu, pour
ne pas alourdir les fiches où rien ne s'est encore passé. Intégré sur la fiche locataire
(`locataire-view.tsx` : à côté du bouton Attestation, et à côté de chaque quittance du
registre des paiements — a nécessité de faire remonter une nouvelle prop `isDg` à travers
`LeaseCard` PUIS `PaymentRegister`, la ligne du tableau vivant dans ce second composant, pas
le premier) et sur la fiche propriétaire (`proprietaire-view.tsx`, à côté de « Générer le
relevé »).

Nouvelle page publique `app/verifier/page.tsx` (+ `verifier-view.tsx`) — même en-tête/pied
de page que le reste du site public, un champ de saisie du code (reformaté automatiquement
en blocs de 4 avec tirets), un résultat clair (bouclier vert « Document authentique » avec
type + entreprise + date, ou bouclier rouge « Code invalide » générique — jamais de
distinction entre « inconnu » et « existe mais malformé » côté message affiché).

### Tests

Tout testé via l'API réelle sur un tenant jetable (jamais KIko Store pour les écritures) :
- Téléchargement de la même quittance/attestation/relevé 6 fois via le portail : les 5
  premiers 200, le 6ème 403 avec message explicite — vérifié séparément pour les 3 types de
  document.
- Vérification employé (`GET .../status`) : affiche bien 5/5 pour les 3 documents.
- Réinitialisation (`POST .../reset`) : repasse à 0/5, un 6ème téléchargement (qui aurait dû
  être refusé) redevient possible immédiatement après.
- Téléchargement côté employé (`GET /api/leases/:id/payments/:id/receipt.pdf`, avec jeton
  DG) : 7 téléchargements consécutifs tous à 200 — confirme que la limite ne s'applique
  jamais à ce chemin.
- PDF réellement générés relus avec `pdftotext -layout` : la ligne de vérification
  s'affiche correctement sur les 3 types de document, sans chevaucher le numéro de page ni
  déborder de la largeur de page, avec un code distinct à chaque fois.
- Code extrait d'un vrai PDF vérifié avec succès sur `/api/verify/:code` (les 3 types,
  réponse `valid:true` avec le bon type de document et la bonne entreprise) ; un code bien
  formé mais inconnu renvoie `valid:false` ; un code mal formé renvoie 400.
- Firefox headless : page `/verifier` publique testée avec un vrai code (bouclier vert,
  bon message) et un code inventé (bouclier rouge) ; fiche locataire et fiche propriétaire
  connectées en DG : badge « 5/5 TÉLÉCHARGEMENTS » et bouton de réinitialisation visibles et
  correctement positionnés sur les deux pages.
- Tenant jetable supprimé après coup, cascade FK vérifiée jusque `document_issuances` (0
  ligne restante) ; KIko Store reconfirmé intact (14 baux).
- `tsc --noEmit`/`next lint`/`node -c` propres sur tous les fichiers modifiés.
