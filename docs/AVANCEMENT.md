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

---

## Étape 30 — Paiement en ligne optionnel (KKiaPay)

Demande directe de l'utilisateur : chaque entreprise cliente peut désormais activer,
si elle le souhaite, l'encaissement en ligne (Mobile Money/carte) via **KKiaPay**
(agrégateur béninois), pour le loyer ET les charges SONEB/SBEE — sans jamais l'imposer.
Une entreprise qui n'active rien continue de fonctionner exactement comme avant (paiements
enregistrés manuellement). Deux points d'entrée : le portail locataire (libre-service) et un
lien de paiement généré par le personnel (pour un locataire sans portail actif, envoyé à la
main par WhatsApp).

Modèle KKiaPay : chaque entreprise a son propre compte et ses 3 clés (publique/privée/
secrète) — pas de sous-comptes côté agrégateur. Règle non négociable de leur documentation :
ne jamais faire confiance au callback client, toute confirmation doit être revérifiée côté
serveur (`verify()`) avant d'enregistrer quoi que ce soit.

### Fichiers ajoutés/modifiés

- **`backend/src/db/migrations/037_kkiapay.sql`**, **`038_kkiapay_charge_method.sql`** :
  `tenants.kkiapay_enabled/kkiapay_sandbox/kkiapay_public_key/kkiapay_private_key_enc/
  kkiapay_secret_key_enc` ; `rent_payments`/`utility_payments.kkiapay_transaction_id`
  (UNIQUE — idempotence au niveau base) et `recorded_by` rendu NULLABLE (un paiement KKiaPay
  n'a pas d'employé qui l'a saisi, même raisonnement que `complaints.created_by`) ; ajout de
  `kkiapay` aux ENUM `payment_method` (`rent_payments`, `utility_payments`,
  `utility_charges`) ; nouvelle table `payment_links` (liens générés par le personnel, même
  schéma de token à sens unique que le portail).
- **`backend/src/utils/encryption.js`** (nouveau) : AES-256-GCM — première capacité de
  chiffrement RÉVERSIBLE du projet (tout le reste, mots de passe/tokens, est à sens unique).
  Nouvelle variable d'environnement globale `SECRETS_ENCRYPTION_KEY`.
- **`backend/src/services/kkiapay.js`** (nouveau) : client KKiaPay écrit à la main avec
  `fetch` natif plutôt que le SDK officiel `@kkiapay-org/nodejs-sdk` — ce dernier embarque
  axios^0.27.2, porteur d'une longue liste de CVE connues pour ne wrapper que deux appels
  HTTP triviaux. `verifyTransaction()` (revérification serveur obligatoire) et
  `verifyWebhookOrigin()` (comparaison à temps constant du secret webhook).
- **`backend/src/services/paymentVerification.js`** (nouveau) : `verifyAndRecordKkiapay()`,
  point d'entrée UNIQUE appelé par les 3 chemins (portail, lien de paiement, webhook) —
  idempotence, revérification serveur, et recoupement de la référence interne (voir bug de
  sécurité ci-dessous).
- **`backend/src/routes/leases.js`**, **`charges.js`** : extraction de `recordRentPayment()`/
  `recordUtilityPayment()`, désormais seuls points d'insertion dans `rent_payments`/
  `utility_payments` (la route manuelle existante les appelle aussi, comportement inchangé) ;
  nouvelles routes `POST /:leaseId/payment-links` et `POST /:id/payment-links` (staff,
  mêmes permissions que l'enregistrement manuel).
- **`backend/src/routes/portal.js`** : `GET /:token` expose désormais les charges SONEB/SBEE
  impayées (nouveauté — absentes du portail jusqu'ici) et la config KKiaPay publique ;
  nouvelles routes `POST /:token/payments/verify` et `.../charges/:chargeId/payments/verify`.
- **`backend/src/routes/paymentLinks.js`**, **`kkiapayWebhook.js`** (nouveaux, montés en
  public avant `utilityReadingRoutes` — même piège que les autres routes publiques) :
  `GET/POST /api/pay/:token` (page publique) et `POST /api/webhooks/kkiapay` (défense en
  profondeur, capte les paiements confirmés quand le client ne revient jamais sur `verify`).
- **`backend/src/routes/settings.js`**, **`validators/settings.js`** : section Réglages
  KKiaPay (DG uniquement) — activer exige les 3 clés déjà présentes ou fournies dans la même
  requête ; clés privée/secrète en écriture seule, jamais relues en clair.
- Frontend : `lib/kkiapay.ts` (chargement du widget CDN + `payWithKkiapay()`),
  `components/payments/pay-now-button.tsx` et `payment-link-card.tsx` (partagés),
  `app/payer/[token]/` (nouvelle page publique), portail locataire (bouton « Payer
  maintenant » + bloc charges), fiche locataire et fiche charge (bouton « Générer un lien de
  paiement », révélation unique + envoi WhatsApp, même schéma que le lien de portail).

### Revue de sécurité demandée explicitement par l'utilisateur, point par point

- **Faille réelle trouvée et corrigée** : sans protection supplémentaire, un tiers connaissant
  le `transactionId` RÉEL d'un paiement appartenant à quelqu'un d'autre (même entreprise)
  aurait pu le soumettre à son propre contexte — la revérification KKiaPay aurait confirmé
  que la transaction existe et a réussi (vrai), mais sans recoupement, l'argent se serait
  retrouvé crédité au mauvais bail/facture. Corrigé : `verifyAndRecordKkiapay` compare
  désormais la référence que KKiaPay associe réellement à la transaction (`partnerId`/`data`
  échoïsés dans sa réponse) avec celle attendue pour CE paiement précis, sur les 3 points
  d'entrée.
- Webhook sans quota dédié → ajouté (300/15min), même principe que les autres routes
  publiques (chaque requête forgée coûte au moins une lecture base avant rejet).
- Validation de type durcie sur les champs du corps du webhook (entrée externe non fiable).
- Vérifié sain sans changement nécessaire : paramètres SQL nommés partout (y compris le nom
  de table dynamique, dérivé d'un ternaire interne) ; comparaison du secret webhook déjà à
  temps constant avec garde de longueur ; manipulation du montant côté widget sans
  conséquence exploitable (le serveur n'utilise jamais un montant fourni par le client,
  seulement celui confirmé par KKiaPay) ; portée agent respectée pour la génération de liens
  de loyer ; 404 générique systématique sur un lien de paiement invalide/expiré/déjà payé.
- Trouvé en cours de route (pas une faille, un oubli du plan initial) : le journal
  d'activité affichait « Auteur inconnu » pour un paiement en ligne (`recorded_by` NULL par
  design) — corrigé pour afficher « Paiement en ligne (KKiaPay) ».

### Tests effectués

Tout testé via l'API réelle sur un tenant jetable (jamais KIko Store pour les écritures),
jetons d'accès mintés directement (pas de mot de passe connu pour ce tenant) :
- Chiffrement : aller-retour clé privée/secrète + détection de falsification (authTag GCM)
  vérifiés en isolation avant intégration.
- `recordRentPayment`/`recordUtilityPayment` appelés directement : paiement manuel inchangé,
  paiement KKiaPay multi-mois (`recorded_by` NULL sur les deux lignes, `kkiapay_transaction_id`
  attaché uniquement à la première pour respecter la contrainte UNIQUE), règlement de charge
  (statut basculé `payee`, `paid_recorded_by` NULL) — puis rejeu du même `transactionId` :
  contrainte UNIQUE déclenchée comme attendu (`ER_DUP_ENTRY`).
- Réglages : activation refusée sans les 3 clés, acceptée une fois fournies ; clés stockées
  chiffrées en base (vérifié par déchiffrement direct) et absentes de toute réponse API.
- Lien de paiement bout-en-bout réel : génération (`POST /api/leases/:id/payment-links`),
  résolution publique (`GET /api/pay/:token`, bon montant/bonne clé publique), tentative de
  vérification avec un `transactionId` inventé → rejetée proprement par l'appel réel à l'API
  KKiaPay (HTTP 401 avec clés factices), serveur resté sain après, aucun paiement enregistré.
- Page publique `/payer/:token` testée en navigateur (Firefox headless) : affichage correct,
  clic sur « Payer maintenant » sans crash (échec attendu faute de vraies clés sandbox),
  aucune erreur console.
- `tsc --noEmit`/`next lint`/`node -c` propres sur tous les fichiers modifiés, y compris un
  passage complet du projet (pas seulement les fichiers touchés).
- **Non testé** (nécessite un vrai compte KKiaPay, hors de portée de cet environnement) : le
  chemin de succès complet (paiement réel confirmé → enregistrement), et la forme exacte du
  payload webhook — les noms de champs plausibles sont tentés défensivement, à confirmer lors
  de la première activation réelle par l'utilisateur.

---

## Étape 31 — Repérage automatique des locataires en retard, relance en un clic

Demande directe de l'utilisateur, reprenant une idée de la comparaison concurrentielle
(« relances WhatsApp automatiques pour le loyer, pas seulement les charges »). Vérification
d'abord : contrairement à ce que suggérait la comparaison, un bouton de relance WhatsApp
existait déjà pour le loyer sur `/espace/relances`, ET le repérage automatique des locataires
en retard existait DÉJÀ dans le widget « Mes tâches » (`listPortfolioArrears`, étape 18) —
aucune API WhatsApp payante n'existe dans ce projet, donc aucune des deux relances (loyer ou
charges) n'a jamais été réellement automatique au sens « envoi sans clic humain ». Question de
cadrage posée avant de coder ; réponse retenue : repérage automatique + rappel visible déjà
là, envoi manuel conservé (pas d'intégration WhatsApp Business API, chantier trop lourd pour
la demande réelle).

Le vrai manque : aucune action directe dans le widget « Mes tâches » lui-même — cliquer sur
une ligne renvoyait vers `/espace/relances` avant de pouvoir envoyer quoi que ce soit.

### Fichiers modifiés

- **`frontend/components/espace/my-tasks-card.tsx`** : le composant `Row` accepte désormais un
  slot `action` rendu HORS du lien de navigation de la ligne (jamais un élément cliquable
  imbriqué dans un autre) ; bouton WhatsApp compact ajouté sur chaque ligne « Locataires en
  retard », réutilisant `buildRentReminderMessage`/`buildWhatsAppHref` déjà en production sur
  `/espace/relances` — même message, mêmes garanties, aucune donnée dupliquée côté backend
  (`phone` était déjà renvoyé par `listPortfolioArrears`, simplement jamais exploité ici).

### Tests effectués

Données réelles de KIko Store lues via l'API (`GET /api/tasks` avec un jeton d'agent réel,
lecture seule) pour confirmer la forme exacte des données. Puis bout-en-bout sur un tenant
jetable avec un vrai agent connecté en navigateur (Firefox headless) : le lien `wa.me` généré
contient le bon numéro, le bon nom, le bon montant et le bon nombre de jours de retard.
Tenant jetable supprimé après coup, KIko Store reconfirmé intact (14 baux). `tsc --noEmit`/
`next lint` propres.

## Étape 32 — Envoi automatique de la quittance après un paiement

Demande directe de l'utilisateur, même origine que l'étape 31. Contrainte technique posée
avant de coder : un lien `wa.me` ne peut préremplir qu'un texte, jamais joindre un fichier —
« envoyer la quittance » signifie donc envoyer un LIEN vers le PDF. Or le token du portail
locataire n'est jamais récupérable après sa création (seule son empreinte est stockée) : impossible
de le reconstruire après coup pour l'envoyer avec chaque nouvelle quittance, et tous les
locataires n'ont pas de portail actif. Question de cadrage posée ; réponse retenue : un lien
dédié à CETTE quittance précise, généré automatiquement, sur le même principe que les liens de
paiement KKiaPay (étape 30).

### Modèle et mécanique

`document_issuances` (étape 29) étendue d'une colonne `share_token` (migration
`039_receipt_share_link.sql`) — stockée **en clair**, à la différence des tokens de portail/
paiement (à sens unique) : déviation délibérée, justifiée par un enjeu très inférieur (accès
en lecture seule à UNE quittance, plafonné à 5 téléchargements par le mécanisme déjà existant
de l'étape 29 — jamais un accès à l'ensemble du compte ni une action pouvant déplacer de
l'argent). Le stockage en clair permet aussi de renvoyer plus tard exactement le même lien
sans invalider un envoi précédent. Génération idempotente (`ensureShareToken`,
`services/documentIssuance.js`).

Nouvelle route publique `GET /api/recu/:token` (`routes/receiptShare.js`, montée à la racine —
préfixe dédié `/recu` plutôt que `/documents/share`, pour ne jamais dépendre de l'ordre de
montage par rapport à `documentRoutes`, authentifié) : sert directement le flux PDF, sans page
Next.js intermédiaire (`Content-Type: application/pdf`, ouvrable tel quel dans un navigateur).
Scope actuel : quittance uniquement (demande explicite) — attestation/relevé restent réservés
au portail pour l'instant.

Côté personnel : `POST /api/leases/:leaseId/payments/:paymentId/receipt-link` (nouveau,
`routes/leases.js`) génère/récupère le lien. Le formulaire d'enregistrement de paiement
(`PaymentRegister`, fiche locataire) l'appelle automatiquement dès qu'un paiement réussit —
sans action supplémentaire du personnel — et affiche aussitôt un bandeau « Envoyer la
quittance par WhatsApp » prêt à cliquer. Un bouton d'envoi discret a aussi été ajouté sur
chaque ligne de l'historique des paiements, pour renvoyer une quittance plus ancienne.

### Fichiers ajoutés/modifiés

- `backend/src/db/migrations/039_receipt_share_link.sql`, `services/documentIssuance.js`
  (`ensureShareToken`, `findByShareToken`), `routes/receiptShare.js` (nouveau), `routes/index.js`
  (montage `/recu`, avant `utilityReadingRoutes`), `routes/leases.js` (nouvelle route
  `receipt-link`).
- `frontend/lib/api/renters.ts` (`generateReceiptShareLink`, `receiptShareUrl`),
  `lib/utils.ts` (`buildReceiptMessage`), `app/espace/locataires/[id]/locataire-view.tsx`
  (bandeau automatique + composant `ResendReceiptButton` pour l'historique).

### Tests effectués

Sur un vrai paiement de KIko Store (lecture/génération non destructive) : génération du lien
(idempotente — rappel renvoie le même token), téléchargement public du PDF sans aucune
authentification (200, `application/pdf`, contenu vérifié avec `pdftotext` — bonne quittance,
bon numéro), token invalide → 404 générique, compteur de téléchargement bien incrémenté (1/5)
puis remis à zéro via la fonctionnalité de réinitialisation déjà existante (aucune trace
laissée). Puis bout-en-bout sur un tenant jetable, en navigateur réel : paiement enregistré
via le vrai formulaire → bandeau vert apparu automatiquement avec le lien WhatsApp prêt
(numéro, montant, mois et URL corrects) ; bouton de renvoi sur la ligne d'historique
également visible. Tenant jetable supprimé après coup, KIko Store reconfirmé intact (14
baux). `tsc --noEmit`/`next lint` propres.

## Étape 30 — Le point des charges SONEB/SBEE (facture mère payée vs encaissé)

🟢 Validé (2026-09-25).

**Besoin** : le propriétaire règle lui-même la facture mère à la SONEB/SBEE ; le cabinet encaisse
les charges chez les locataires, puis fait le point pour que le propriétaire ne soit pas perdant.
Jusque-là, rien n'enregistrait si la facture mère avait été payée, et la fiche/portail/relevé PDF
du propriétaire ne montraient aucune charge.

**Ce qui a été ajouté**
- **Paiement de la facture mère** : sur chaque relevé, montant réellement payé + date + mode
  (facultatif) + note. Corrigeable / annulable. Simple mémo : aucun mouvement de caisse du
  cabinet, donc ni écriture comptable ni verrou de période. Migration `062`
  (`utility_reading_batches.main_paid_*`). Routes `PUT/DELETE /api/utility-batches/:id/main-payment`.
- **Le point** (`services/utilityPoint.js`, `GET /api/utility-point`) : par relevé validé,
  facture mère payée (A) vs facturé aux locataires (B) vs encaissé (C). Reste au propriétaire =
  A − C = consommation non refacturée (A − B) + impayés des locataires (B − C). Statuts par
  ordre de priorité : paiement à déclarer > à recouvrer > à charge du propriétaire > soldé.
  Factures supprimées logiquement exclues ; périmètre agent respecté.
- **Interface** : carte « Facture mère payée » + mini-point sur le relevé ; page
  `/espace/charges/point` (tous les propriétaires, plage de mois) ; « Carnet des charges » sur la
  fiche propriétaire ; indicateur « facture mère payée / à déclarer » dans la liste des relevés.

**Bug corrigé au passage** : `POST /utility-batches/:id/reopen` ne refusait que les factures
`payee` — une facture `partiellement_payee` était supprimée avec ses règlements (cascade). Tout
règlement, même partiel, bloque désormais la réouverture.

**Suite** : export PDF du carnet, portail propriétaire, relevé PDF, alertes et reversement des
charges encaissées ont été construits à l'étape 31 ci-dessous.

**Tests** : 3 tests de service (`test/utilityPoint.test.js`, suite 135/135) ; scénario API bout
en bout sur tenant jetable (validation → règlements partiels → déclaration → point → réouverture
refusée → annulation) ; parcours navigateur réel (déclarer/annuler/corriger, page du point,
fiche propriétaire). `tsc`/`eslint` propres.

## Étape 31 — Carnet des charges, portail propriétaire, alertes et reversement

🟢 Validé (2026-09-25).

**Besoin** (suite de l'étape 30) : le propriétaire paie la facture mère ; le cabinet encaisse chez
les locataires puis lui reverse — **le cabinet ne garde rien sur les charges** (hypothèse
explicite de l'utilisateur, aucun pourcentage retenu). Il fallait donc : un carnet des entrées par
propriétaire (et son PDF), l'affichage côté propriétaire, des alertes, et le reversement.

**Ce qui a été ajouté**
- **Reversement des charges** (`services/utilityRemittance.js`, migration `063`, table
  `owner_charge_remittances`) : à reverser = Σ règlements encaissés sur les factures de ses Biens
  (factures supprimées exclues) − Σ reversements non annulés. **Table séparée des versements de
  loyer** : ceux-ci portent commission/IRF côté comptabilité avancée, faux pour un remboursement
  de charges, et le séquestre des loyers ne se mélange jamais à ce solde. Garde de solde évaluée
  DANS la transaction, sous verrou de la fiche propriétaire (deux reversements simultanés ne
  peuvent pas dépasser l'encaissé — testé : un 201, un 400). Annulation logique avec
  justification (5 caractères min.), verrou de période comme les versements. Routes
  `POST/DELETE /api/owners/:id/charge-remittances` (`proprietaires`/`comptabilite`).
- **Carnet des entrées** (`getUtilityEntries`, `getOwnerCarnet`) : chaque règlement reçu d'un
  locataire (date, locataire, unité, fluide, période, mode, montant), rattaché au mois de la
  facture ; les factures individuelles hors relevé sont signalées et comptées à part.
- **PDF du carnet** (`streamUtilityCarnetPdf`, charte des autres PDF) : synthèse du point, point par
  relevé, entrées, reversements, compte à reverser. `GET /api/owners/:id/carnet-charges.pdf`
  (employé : illimité, sans code) ; côté portail : 5 téléchargements max + code de vérification
  (nouveau type de document `carnet_charges`, réinitialisable par le DG sur la fiche).
- **Portail propriétaire** : section « Charges SONEB / SBEE » en langage simple (payé à la
  SONEB/SBEE, encaissé chez ses locataires, reste à sa charge, reste à lui reverser, reversements
  reçus) + téléchargement du carnet. **Relevé propriétaire PDF** (employé et portail) : nouvelle
  section « Charges SONEB / SBEE ».
- **Alertes** (`services/utilityAlerts.js`, `GET /api/utility-alerts`, calcul à la volée) : relevé
  du mois précédent manquant (à partir du 5, danger si 2 mois ou plus), relevé en brouillon
  depuis 7 jours, facture mère non déclarée payée (7 jours, danger à 30), écart compteur
  principal/décompteurs anormal (fenêtre de 90 jours), charges encaissées à reverser depuis
  7 jours (ancienneté calculée dans l'ordre chronologique des encaissements). Un agent restreint
  ne voit que ses Biens et jamais l'alerte de reversement. Affichées sur l'accueil (DG et
  permission `charges`), la page Charges et « Le point des charges » ; tâche planifiée
  quotidienne (07h20) qui notifie le DG au plus une fois par jour.
- Journal d'activité : reversement enregistré/annulé et facture mère déclarée payée. Export Excel :
  ligne « Reversement de charges (propriétaire) » en débit.

**Points à valider / limites connues**
- **Comptabilité avancée : aucune écriture automatique** pour un reversement de charges. La règle
  `charge_locative_encaissee` crédite le 411 du locataire (déjà signalé : point B2 de
  `AUDIT_COMPTABLE.md`, à valider par l'expert-comptable) ; le compte à débiter au reversement
  dépend de cette réponse. L'API renvoie `accountingNote` et l'écran affiche un avertissement quand
  le module est actif. Le flux net du tableau de bord simple ignore les charges à l'entrée, il les
  ignore donc aussi à la sortie.
- **Bug corrigé au passage** : l'export Excel comptait les règlements de factures supprimées.
- **Défaut d'interface préexistant, NON corrigé (hors périmètre)** : `tailwind-merge` (via `cn()`)
  ne connaît pas les tailles de police personnalisées (`text-body-sm`…) et les prend pour des
  couleurs : tout bouton `size="sm"` perd sa couleur de texte (texte sombre sur fond marine pour un
  bouton plein, ex. « Confirmer le versement »). Contourné dans les nouveaux écrans (taille
  standard). Correction possible en une ligne (`extendTailwindMerge` avec les tailles du
  `tailwind.config.ts`), mais elle modifierait l'aspect de nombreux écrans existants.
- Non couvert : reversement de charges par lot sur plusieurs propriétaires.

**Tests** : `test/utilityRemittance.test.js` (12 tests : solde, ordre chronologique, garde de
solde, carnet, alertes, tâche planifiée, PDF sur 80 lignes/14 relevés, section du relevé) — suite
**148/148** ; scénario API bout en bout sur cabinet jetable (validation, concurrence, annulation,
PDF employé et portail, plafond de 5 téléchargements, code de vérification, journal, Excel,
verrou de période) ; parcours navigateur réel de chaque écran ; `pdftotext`/`pdftoppm` sur les
PDF. `tsc`/`eslint` propres. **Bug trouvé par les tests** : la flèche « → » n'existe pas dans
l'alphabet des polices PDF standard (caractères parasites) — remplacée par « de … à … ».

## Étape 32 — Lecture par mois des paiements et des charges

🟢 Validé (2026-09-25).

**Besoin** : « arriver vite à comprendre les choses » — les paiements et les charges étaient de
longues listes plates triées par date (seul le Journal des dépenses était regroupé, par jour).

**Ce qui a été fait** (frontend uniquement, aucun changement de données)
- Brique commune : `lib/group-by-month.ts` (regroupement du plus récent au plus ancien, date
  absente ou invalide rangée en dernier, aucun élément perdu) et `components/ui/month-group.tsx`
  (en-tête de mois repliable avec bilan et état, « Tout déplier / Tout replier », élision
  « Loyer d'août »). Jusqu'à 3 mois tout est déplié ; au-delà, seuls le mois le plus récent et le
  mois en cours le sont. Le choix de l'utilisateur survit au rechargement de la liste.
- **Comptabilité** : « Paiements des locataires » regroupés par MOIS DE LOYER concerné (un paiement
  d'octobre qui couvre novembre apparaît sous novembre) ; « Versements aux propriétaires » par mois
  de règlement.
- **Fiche locataire** : registre des paiements par mois de loyer, avec l'état de chaque mois face au
  loyer (Payé, ou Partiel · reste X et « 50 000 / 75 000 ») ; charges SONEB/SBEE par mois avec
  « reste » ou « tout réglé ».
- **Page Charges** : factures regroupées par mois de la période facturée, avec total facturé,
  reste dû et état du mois.

**Bug corrigé au passage** : « Payé jusqu'à … » (fiche locataire et portail du locataire) prenait
le dernier mois ayant reçu AU MOINS UN paiement : un mois seulement entamé, ou payé après un trou,
s'affichait comme payé. C'est maintenant le dernier mois réellement soldé de façon consécutive
(`computeArrears`, test dédié).

**Tests** : logique de regroupement vérifiée sur les cas limites ; suite backend 149/149 ;
navigateur réel sur les trois écrans (dont un mois partiel, l'élision et le repli/dépli) ;
`tsc`/`eslint` propres.

**Suite** : la frise des 12 mois par locataire (étape 33) et l'encadré « Ce mois-ci » (étape 34)
sont faits.

## Étape 33 — Frise des 12 mois par locataire

🟢 Validé (2026-09-25).

**Besoin** : voir « qui est à jour ? » sans lire un tableau.

**Ce qui a été fait**
- **Calcul côté serveur** (`buildRentStrip`, `services/rentTracking.js`) : l'état de CHAQUE mois d'une
  fenêtre de 12 mois (8 passés, le mois en cours, 3 à venir), calculé mois par mois — jamais déduit
  de la seule prochaine échéance, donc un mois payé après un trou ou seulement entamé reste lisible.
  États : payé, partiel (avec `late` si l'échéance est passée), en retard, à payer, à venir, avant le
  suivi (le bail existait avant Lyko System : rien n'est réclamé), hors bail. Suit la convention du
  bail (avance / à terme échu) et le même point de départ de suivi que `computeArrears` (helper
  commun `baselineMonthOf`). Un test vérifie la cohérence avec `computeArrears` (même prochaine
  échéance, même verdict de retard, dans les deux conventions).
- **Affichage** (`components/renters/rent-strip.tsx`) : cases colorées avec forme ou icône en plus de
  la couleur (coche, alerte, horloge) ; un mois partiel est une **jauge** remplie au prorata du payé ;
  au clic sur un mois, une phrase dit tout (« Partiel : 50 000 payés sur 75 000, reste 25 000 —
  échéance le 5 janvier 2027 ») ; info-bulle au survol ; légende. Version complète sur la fiche
  locataire et sur **le portail du locataire** (il voit ses propres 12 mois) ; version compacte
  (pastilles) dans une nouvelle colonne « 12 mois » de la liste des locataires.
- Exposée par `GET /api/renters` (par locataire), `GET /api/renters/:id` (bail actif) et le portail.

**Tests** : 7 tests de la frise (fenêtre sur changement d'année, avance / terme échu, suivi tardif,
bail commencé ou terminé en cours de fenêtre, paiements d'avance, cumul, cohérence avec
`computeArrears`) — suite backend **156/156** ; navigateur réel sur la fiche (12 cases, détail au
clic), la liste (5 frises) et le portail ; `tsc`/`eslint` propres.

## Étape 34 — Encadré « Ce mois-ci » (Comptabilité et Charges)

🟢 Validé (2026-09-25).

**Besoin** : savoir en une seconde où en est le mois — combien est attendu, combien est encaissé,
combien reste, et si le reste est déjà en retard.

**Ce qui a été fait**
- **Comptabilité — « Loyers {mois} »** : attendu, encaissé (avec le pourcentage), reste à encaisser
  dont la part déjà en retard ; barre en trois segments (encaissé / en retard / pas encore dû) ;
  décompte des baux (payés, partiels, en retard, à venir) et lien vers les baux en retard.
  Suit le mois choisi dans la page ; le badge « Ce mois-ci » n'apparaît que sur le mois en cours.
  `GET /api/accounting/rent-month?month=` (permission `comptabilite`, portée « Biens gérés »).
- **Charges — « Charges {mois} »** : facturé / réglé / reste sur les factures émises dans le mois,
  barre réglé / reste, règlements reçus dans le mois (toutes factures) et ce qui reste dû sur les
  mois précédents. `GET /api/charges/month-summary?month=`.
- **Une seule règle** : `rentMonthState` (état d'un mois pour un bail) est partagée par la frise des
  12 mois, l'encadré et — via `summarizeRentMonth` — les totaux. Un bail n'entre dans l'attendu
  que si le mois le concerne (ni hors bail, ni antérieur au suivi, ni entré « à jour » ce mois-là).
  Invariant testé : attendu = encaissé + reste.

**Tests** : 3 tests de l'agrégat (mélange de baux, mois futur / vide / surpaiement, cohérence avec la
frise) — suite backend **159/159** ; recoupement à la main en SQL sur le cabinet de test (410 000
attendus, 335 000 encaissés, 75 000 en retard ; charges 67 000 / 35 000 / 32 000) ; navigateur réel
(mois courant, futur, sans bail, badge) ; `tsc`/`eslint` propres.

## Étape 35 — Payer le reste d'un mois partiel

🟢 Validé (2026-09-25).

**Question posée** : « est-ce possible de payer le reste des paiements partiels ? »

**État constaté** : côté serveur, oui depuis la correction A1 (`allocateRentPayment` complète d'abord le
reliquat du mois entamé, puis les mois suivants ; une quittance par mois touché) — vérifié en réel :
25 000 payés sur un décembre à 50 000/75 000 le soldent, le prochain mois dû passe à janvier. Mais
l'écran ne suivait pas : l'aperçu ignorait ce qui était déjà payé (il annonçait « paiement partiel »
au lieu de « solde ») et le montant proposé était le loyer entier.

**Ce qui a été fait** (frontend uniquement)
- `previewRentAllocation` reprend exactement la règle du serveur (reliquat d'abord) : vérifié sur
  20 012 cas aléatoires et limites contre `allocateRentPayment` — 0 écart.
- **Fiche locataire** : bandeau « {mois} n'est payé qu'en partie : X sur Y — il reste Z » avec un
  bouton « Payer le reste (Z) » qui ouvre le formulaire avec le bon montant ; le bouton habituel
  « Enregistrer un paiement » propose aussi le reste ; l'aperçu dit « Solde {mois} : … qui complètent
  les … déjà payés », ou « il restera … » si le montant ne suffit pas, ou détaille le solde puis
  l'avance sur le mois suivant.
- **Portail du locataire** : bandeau « il vous reste Z à régler pour ce mois » et, si le paiement en
  ligne (KKiaPay) est activé, le bouton propose le reste (« Payer le reste (Z) en ligne ») au lieu d'un
  loyer entier. Non testé de bout en bout : KKiaPay n'est pas activé sur le cabinet de test.

**Constaté, non modifié** : le message de relance WhatsApp (fiche, Relances, Mes tâches) parle
toujours du loyer entier même si une partie est déjà payée.

**Tests** : parcours navigateur réel (bandeau, montant par défaut, quatre aperçus, paiement du reste,
disparition du bandeau, frise et groupe du mois passés à « Payé », bandeau du portail) ; `tsc`/`eslint`
propres.

## Étape 36 — Fin des faux « paiement identique » (clé d'idempotence)

🟢 Validé (2026-09-25).

**Problème signalé** : après un paiement partiel, payer le reste aussitôt (même mode, même jour)
affichait « Un paiement identique vient d'être enregistré » ; il fallait changer le mode de paiement.

**Cause** : la garde anti-doublon comparait le mois, la date et le mode de paiement dans les 2
dernières minutes — mais PAS le montant. Le reste d'un mois partiel tombe sur le même mois : refusé à
tort. Elle aurait aussi bloqué deux moitiés égales voulues.

**Correctif**
- **Clé d'idempotence** (voie normale) : le navigateur joint une clé unique à chaque envoi du
  formulaire (générée à l'ouverture, renouvelée après chaque paiement enregistré). Le serveur la
  consomme dans la MÊME transaction que le paiement (`services/paymentGuards.js`, table
  `request_idempotency_keys`, migration `064`) : même clé = un seul paiement ; clés différentes = jamais
  confondus, quels que soient montant, date et mode. Une clé n'est consommée que si le paiement est
  enregistré (réessayer après une erreur reste possible).
- **File hors-ligne** : la même clé suit le paiement mis en attente ; si la réponse s'était perdue alors
  que le serveur avait tout enregistré, le rejeu est reconnu (409 `duplicate_request`) et traité comme
  réussi au lieu d'être signalé en échec, sans doubler le paiement.
- **Envoi sans clé** (ancien client, script) : l'heuristique est conservée mais compare désormais aussi
  le MONTANT de la première écriture qui serait créée.

**Règlements de charges SONEB/SBEE** : même correctif (`POST /api/charges/:id/payments`, portée
`charge_payment`, clé jointe par la page Charges). Sa garde héritée comparait déjà le montant mais
refusait deux acomptes égaux voulus dans les 2 minutes. Vérifié : deux acomptes égaux à la suite
(API et page Charges), clé rejouée (409), trois envois simultanés (un seul), sur-règlement refusé puis
réessai avec la même clé accepté.

**Tous les enregistrements d'argent** (demande de l'utilisateur) : la même clé est maintenant
jointe et consommée dans la transaction pour les dépenses (formulaire multipart), les immobilisations,
les versements de loyer aux propriétaires, les reversements de charges, les règlements d'impayés à
l'entrée et les pénalités de retard — avec un schéma partagé (`validators/idempotency.js`) et un hook
côté écran (`lib/use-idempotency-key.ts`, clé renouvelée après chaque enregistrement réussi : un
formulaire resté monté sert à plusieurs opérations distinctes). Une portée par type d'opération
(`expense`, `fixed_asset`, `owner_payout`, `charge_remittance`, `opening_debt_payment`, `late_fee`) : la
même clé ne peut pas entrer en conflit entre deux types. Vérifié en base pour chaque route (clé
rejouée = une seule ligne ; deux clés différentes = deux lignes) et dans le navigateur (deux dépenses
identiques, deux reversements identiques à la suite).
Non concernés (état-dépendants, un second envoi est déjà refusé par l'état) : règlement d'une dépense
à crédit, règlement et amortissement d'une immobilisation.

**Limite** : les clés d'idempotence ne sont pas purgées (une ligne par opération, du même ordre de
grandeur que les opérations elles-mêmes).

**Tests** : 4 tests de la garde (clé unique, annulation avec la transaction, 3 réclamations
simultanées, comparaison mois/date/mode/montant, dont le cas signalé) — suite backend 163/163 ;
scénarios API réels (le cas signalé sans clé, clé rejouée, clé prime sur le contenu, 3 envois
simultanés, deux moitiés égales voulues, doublon strict sans clé, échec puis réessai, clé mal formée) ;
navigateur réel : partiel puis reste, puis deux moitiés égales, sans aucune erreur ; `tsc`/`eslint` propres.

## Étape 37 — Versements aux propriétaires : solde vérifié sous verrou

🟢 Validé (2026-09-25).

**Défaut** (résidu de l'audit A2) : `POST /api/owners/:id/payouts` vérifiait le solde séquestre HORS
transaction et sans verrou. Deux versements simultanés, chacun inférieur au solde, passaient tous
deux la vérification et le dépassaient. Reproduit avant correction : 3 versements simultanés de
30 000 sur un solde de 50 000 → 3 acceptés, solde final −40 000 (dépassement à chaque essai sur 8).

**Correctif** : dans la transaction, la fiche du propriétaire est verrouillée (`FOR UPDATE`), la clé
d'idempotence est réclamée, puis `assertPayoutWithinBalance(…, conn)` lit le solde sur la connexion de
la transaction — donc après tout versement concurrent déjà validé. `getEscrowBalances` accepte une
connexion (`db`, défaut : le pool, autres appelants inchangés). Même schéma que les reversements de
charges.

**Tests** : test de concurrence (`test/commission.test.js`, 3 versements simultanés → un seul passe,
solde jamais négatif) — suite backend **164/164** ; sur la route réelle : 3 versements simultanés de
60 % du solde → 201/400/400, solde final = solde − un versement, « un franc de plus » refusé,
« exactement le solde » accepté.

## Étape 38 — Interface colorée : une couleur par cadre

🟢 Validé visuellement (2026-09-25) — Frontend uniquement, aucune donnée touchée.

**Demande** : « que l'interface soit jolie — pour les div parent, ajoute des couleurs en background ».
Les cartes étaient toutes blanches sur un fond quasi blanc (#F8FAFC) : la page paraissait plate.

**Principe** : une teinte douce par module, appliquée automatiquement, sans modifier les ~150 cartes
une à une.
- `tailwind.config.ts` : fond de page `canvas` légèrement bleuté (#F3F6FB) + nouveaux jetons
  `tint-{blue,violet,teal,amber,rose,slate}` (fond + liseré). Ces teintes sont **décoratives** : elles
  n'empruntent pas les couleurs de statut (vert = payé, rouge = retard…), qui gardent leur sens.
- `components/ui/card.tsx` : `Card` accepte `tone` ; sans `tone`, elle reprend la teinte du module en
  cours (contexte React `CardToneContext`). Une carte teintée remet le contexte à blanc pour ses
  enfants : une carte imbriquée reste blanche et se détache de son parent coloré. Un `className`
  explicite (`bg-success/5`…) l'emporte toujours (les registres de Comptabilité gardent leurs couleurs).
- `app/espace/layout.tsx` : la teinte vient du **cadre** de la page (`lib/module-theme.ts`, voir la révision ci-dessous).
- `components/ui/table.tsx` : un tableau posé directement sur la page prend le liseré et l'en-tête de la
  teinte du module ; dans une carte teintée il garde la charte neutre. Fond de tableau blanc explicite.
- Portails : locataire = vert d'eau, propriétaire = violet (`CardToneProvider` sur le `<main>` commun).
- 6 encarts d'alerte posés DANS des cartes (`bg-warning/10`, `bg-danger-bg/40`…) sont passés en fond
  plein : un fond semi-transparent se mélangeait à la teinte du parent (mauvais rose sur violet).

**Vérifié** : captures avant/après sur 14 écrans (tableau de bord, biens, fiche bien, propriétaires,
fiche propriétaire, locataires, relances, plaintes, point des charges, paramètres, comptabilité, deux
portails) ; `tsc` et `eslint` propres ; pages publiques (accueil, connexion, inscription, vérifier,
payer, portail) toujours en 200.

**Point d'attention** : Tailwind (dev) ne recharge pas la VALEUR d'un jeton existant (`canvas`) à chaud —
redémarrer `next dev` après l'avoir modifié ; les nouveaux jetons, eux, sont pris à chaud.

**Révision — « chaque couleur doit exprimer son cadre »** : la première version réutilisait les
mêmes teintes pour des modules sans rapport (bleu pour Biens, Charges et Tableau de bord ; ardoise
pour presque tout le reste). Règle retenue : **une couleur = un cadre = une rubrique du menu**, jamais
partagée. Source unique : `lib/module-theme.ts` (`CADRES`, `cadreForPath`), lue par le layout ET le menu.

| Cadre (rubrique du menu) | Couleur | Ce qu'elle exprime |
|---|---|---|
| Vue d'ensemble | bleu | l'identité Lyko, le regard d'ensemble |
| Patrimoine (Biens, Propriétaires, Locataires) | violet | ce que l'on gère |
| Opérations (Plaintes, Relances, Tâches) | orange | l'action au quotidien |
| Finances (Comptabilité, Comptabilité avancée, Charges) | cyan | l'argent qui circule (et l'eau/l'électricité) |
| Administration (Employés, Journal, Historique, Réglages, Mon compte) | ardoise | le fonctionnement du cabinet |

La couleur apparaît partout au même endroit : pastille + titre de rubrique du menu (infobulle = sens de
la couleur), icônes et entrée active du menu, filet de 4 px en haut de page, fond des cartes et en-têtes
de tableaux. Sur les pages transverses, chaque carte prend le cadre de **ce dont elle parle** : sur le
tableau de bord, les alertes charges sont cyan, « Plaintes en cours » et « Mes tâches » orange, les
tuiles de démarrage violet (bien/locataire) ou ardoise (employé) ; portail locataire = cyan (loyers,
charges), portail propriétaire = violet. Le vert/ambre/rouge de STATUT reste réservé au sens (payé,
attention, retard) : Comptabilité n'est plus ardoise mais cyan, précisément parce que le cyan est loin du
vert de « encaissé ».

## Étape 39 — Refonte de la page d'accueil (contenu marketing)

🟢 Validé visuellement (2026-09-25), ordinateur et téléphone (390 px), aucun débordement horizontal.
Frontend uniquement. **Décisions de l'utilisateur : ni tarifs, ni témoignages.**

**Constat de départ** : la page (5 sections) listait des modules au lieu de vendre des bénéfices et
contenait des affirmations inexactes — « factures SONEB, SBEE et **ordures** » (non géré), « saisie hors
connexion (paiement, **dépense, fiche locataire**) » (seuls le paiement de loyer et la plainte sont
mis en file), et « entreprises immobilières **et juridiques** » (aucune fonction juridique).

**Nouveau parcours** (`app/page.tsx`) : héros orienté bénéfice → « Conçu pour le Bénin » (FCFA, SONEB/SBEE,
Mobile Money via KKiaPay, WhatsApp, plan SYSCOHADA) → avant/après → un espace par métier (direction, agents,
comptabilité, propriétaires, locataires) → vitrine des charges SONEB/SBEE avec aperçu construit avec les vrais
composants (chiffres fictifs, badge « Exemple ») → argent et comptabilité → sécurité/traçabilité/fiabilité →
comment ça marche → FAQ (10 questions, `<details>` natifs) → appel à l'action. En-tête et pied de page refaits.

**Règle éditoriale** : chaque phrase correspond à une fonction construite (vérifiée dans ce fichier et le code).
Volontairement ABSENT : l'IRF (règle marquée « hypothèse #10 — À VALIDER », jamais confirmée par un expert-
comptable), toute promesse de « conformité » légale, les sauvegardes/HTTPS (déploiement 12b pas encore validé),
Quick Immo (en cours de retrait), prix, notes, témoignages, logos.

**Technique** : `SectionHeading` sans `cn()` (tailwind-merge supprimait `text-headline-xl` dès qu'une couleur
`text-*` était présente — même défaut que l'étape 24) ; boutons sur fond bleu avec `!text-white` pour la même
raison ; métadonnées corrigées (`layout.tsx`, `manifest.webmanifest`, Open Graph `fr_BJ`) ; données structurées
JSON-LD (`SoftwareApplication` + `FAQPage`, sans prix ni note).

**Contact** : `components/marketing/contact.ts` lit `NEXT_PUBLIC_CONTACT_WHATSAPP` et `NEXT_PUBLIC_CONTACT_EMAIL`
(documentées dans `.env.example`). Vides = aucun bouton de contact, jamais de faux numéro.

**Reste à faire** : renseigner ces deux variables ; pages légales (mentions légales, confidentialité,
conditions) — contenu à fournir par l'utilisateur, la règle béninoise n'étant pas confirmée ; vraies captures
d'écran issues d'un cabinet de démonstration si souhaité.

## Étape 40 — Assistant IA (chat Claude), étape A : fondations + aide sur la plateforme

🟡 Codé et testé avec un FAUX client (aucun appel réseau, aucune dépense) — **jamais encore essayé sur le vrai
modèle : il manque la clé API** (voir « Reste à faire »). Modèle retenu par l'utilisateur : **Claude Sonnet 5**
(`claude-sonnet-5`, réglage `AI_MODEL`).

**Demande** : un chat IA intégré qui aide les utilisateurs, conseille, analyse leur entreprise et propose des
solutions. Plan validé en trois étapes : **A** (celle-ci : fondations + aide sur la plateforme, SANS données du
cabinet) → **B** (outils de LECTURE réutilisant les services existants + « Analyse mon entreprise ») → **C**
(briefing hebdomadaire, brouillons de relances WhatsApp). Défauts retenus faute de réponse contraire :
activation par la direction, lecture seule, historique serveur supprimable, quota 300 messages/mois.

**Backend** (`backend/src/services/assistant/`, `routes/assistant.js`, migration `065_ai_assistant.sql`,
SDK `@anthropic-ai/sdk`) :
- `client.js` : SEUL point qui touche au SDK et à la clé (jamais loggée, jamais renvoyée au front) ;
  sans clé, l'assistant est « non configuré » et le reste de la plateforme est inchangé.
- `systemPrompt.js` + `knowledge.js` : consigne en deux blocs — règles + plan de la plateforme (stable, mis en
  cache côté API) et contexte (prénom, rôle, modules, pages accessibles, date) APRÈS le point de cache. Consignes :
  ne pas inventer, dire « je ne suis pas sûr » sur le droit/la fiscalité/SYSCOHADA, ne rien exécuter, liens
  internes seulement. Le nom d'entreprise et le prénom (saisis par des humains) sont réduits à une ligne courte.
- `access.js` : entreprise et utilisateur relus en base à partir du JETON ; activation par le cabinet,
  permission `assistant` (la direction y a toujours accès), compte actif, clé, quota mensuel.
- `chat.js` : flux continu (SSE), une seule réponse en cours par utilisateur, échange enregistré seulement une
  fois la réponse complète, annulation du navigateur comptée dans le quota (sinon contournement), erreurs du SDK
  traduites en messages présentables (jamais le texte brut de l'API), `refusal` et `max_tokens` gérés.
- Tables : `assistant_conversations` (PRIVÉES à leur auteur, pas même visibles de la direction, supprimables pour
  de bon, purge après `AI_RETENTION_DAYS` = 90 j), `assistant_messages`, `assistant_usage` (compteurs de jetons
  uniquement — jamais le texte — pour mesurer le coût réel), colonnes `tenants.assistant_*` (activé, quota,
  consentement daté et attribué). Désactivé par défaut pour TOUS les cabinets.
- Routes `/api/assistant` : `status`, `settings` (GET/PUT, direction ; l'activation exige une confirmation
  explicite), `chat` (SSE, limité à 12 messages/minute/utilisateur), `conversations` (liste/lecture/suppression).
- Nouvelle permission `assistant` dans le catalogue (jamais pré-cochée).

**Frontend** : bouton flottant + panneau (plein écran sur téléphone) monté dans `app/espace/layout.tsx`, visible
seulement si `/status` dit « utilisable » ; suggestions, réponse en flux, arrêt, historique, suppression ; carte
« Assistant IA » dans Réglages avec l'information à lire et la case de confirmation. **Rendu volontairement
restreint** (`lib/safe-markdown.ts`) : paragraphes, listes, gras, code, et liens vers `/espace/...` uniquement —
images, liens externes et HTML restent du texte inerte (une image ou un lien pourraient faire fuir des données).

**Vérifié** : 24 tests dédiés (droits, désactivation, isolation entre employés et entre entreprises, quota,
consigne envoyée, aucun paramètre retiré pour ce modèle, identifiant opaque, erreurs, annulation, route SSE,
réglages) — suite backend **188/188** ; `tsc`/`eslint` propres ; test de l'analyseur Markdown (liens externes,
`javascript:`, images, HTML, chemins piégés) ; navigateur réel (ordinateur et 390 px) avec le vrai backend et un
faux modèle : activation depuis Réglages, flux, un seul lien interne rendu, erreur qui rend le texte au champ,
historique et suppression. Le cabinet de test a été remis à zéro ; KIko Store est inchangé.

**Complément (2026-09-25) — mémoire du profil** : demande « l'assistant demande le nom et le titre, il mémorise pour
toujours ». Prise de connaissance **scriptée et déterministe** (pas de dépendance au modèle, aucun jeton dépensé) :
à la première ouverture sans profil, l'assistant demande « comment dois-je vous appeler ? » (puce pré-remplie avec le
prénom du compte, ou réponse libre), puis « quelle est votre fonction ? » (puces : titre du poste du compte,
Directeur/Directrice, Gestionnaire, Comptable, Agent immobilier ; « Plus tard » pour passer). Table
`assistant_profiles` (migration `066`), un profil PRIVÉ par utilisateur, conservé **sans limite de durée** — la purge
des conversations ne le touche pas — jusqu'à ce que la personne le modifie ou l'efface (icône profil du panneau :
« Mon profil », « Oublier mon profil »). Routes `PUT/DELETE /api/assistant/profile` ; `GET /status` renvoie le profil
(`null` = jamais renseigné) et de quoi pré-remplir. Le nom d'usage et la fonction sont normalisés (une ligne, longueur
bornée, sans caractère de contrôle) puis injectés dans le bloc dynamique de la consigne — libellés, jamais
instructions — et la consigne demande d'adapter le ton à la fonction (direction : priorités et décisions ; agent :
gestes concrets ; comptable : rigueur et périodes). Texte de consentement des Réglages mis à jour (nom d'usage et
fonction transmis, mémorisés jusqu'à effacement). Ajout d'une « méthode de conseil » à la consigne (recommandation
d'abord, 2 à 4 actions priorisées, une question de précision si la demande est floue, distinguer ce qui est su de ce
qui est supposé) — **non évaluée sur le vrai modèle**.
Vérifié : 8 tests de plus (32 dédiés, suite backend 196) ; navigateur réel : demande du nom en réponse libre, fonction par
puce, mémorisation confirmée après rechargement complet de la page (« Bonjour Marcel »), modification, oubli.

## Étape 41 — Assistant IA, étape B : outils de lecture (« un vrai conseiller-analyste »)

🟡 Codé et testé avec un FAUX client (aucun appel réseau, aucune dépense), y compris un aller-retour
d'outil complet vérifié en navigateur réel sur le cabinet de test — **jamais encore essayé sur le vrai
modèle**. Décision de l'utilisateur sur la confidentialité (proposée avec pseudonymisation en option,
tranchée explicitement) : **noms réels**, jamais d'alias.

**Principe** : le modèle ne touche JAMAIS la base de données. Il appelle un OUTIL par son nom (protocole
standard « tool use » de l'API Claude) ; notre code exécute le calcul de confiance déjà utilisé par les
écrans existants (mêmes services), et seul le RÉSULTAT (JSON borné) lui est renvoyé. La consigne système
interdit d'énoncer un chiffre qui ne vient pas d'un résultat d'outil.

**`services/assistant/tools.js`** (nouveau) — 6 outils, réutilisant les services déjà en place :
- `locataires_en_retard` (`listPortfolioArrears`), `charges_impayees` (même requête que le centre de
  relance des charges), `plaintes_ouvertes` (permission `plaintes`), `bilan_comptable_du_mois`
  (`computeAccountingDashboard`, exporté depuis `routes/accounting.js` pour l'occasion — un seul calcul,
  jamais dupliqué), `soldes_proprietaires` (`getEscrowBalances`, `getOwnersWithoutCommissionRate` —
  volontairement JAMAIS scopé agent, comme partout ailleurs où ce calcul est déjà utilisé),
  `point_des_charges` (`getUtilityPoint`).
- Chaque outil est gardé par les MÊMES permissions que l'écran correspondant (`hasAny`), et respecte la
  portée « Biens gérés » d'un agent restreint (`resolvePropertyScope`, calculée une fois par tour) —
  jamais un accès plus large via l'assistant que via l'interface. La direction a toujours tous les outils.
- Chaque résultat est BORNÉ (compteurs exacts + un nombre de lignes plafonné et réglable par le modèle,
  `limite`, plafond dur 20) — jamais un déversement de toute la base.
- `runTool` revérifie les droits une seconde fois (jamais fait confiance au seul filtrage de la liste
  proposée) ; un outil refusé ou halluciné renvoie `{ erreur: … }`, jamais une exception qui casserait le
  tour — et ce sentinel est traduit en `is_error: true` dans le `tool_result` envoyé au modèle, pour qu'il
  n'insiste pas.

**`services/assistant/chat.js`** — boucle de tours d'outils (jusqu'à 4 allers-retours, plafond de sécurité
`MAX_TOOL_ROUNDS`) : à chaque tour, si le modèle répond `stop_reason: 'tool_use'`, on exécute (en
parallèle) tous les appels demandés, on renvoie les `tool_result` (avec le bon `tool_use_id`), et on
reboucle — jusqu'à une vraie réponse texte ou au plafond. Le libellé de statut envoyé au front pendant
l'exécution nomme l'outil en français (« Consultation des loyers en retard… »), jamais son nom technique.
**La conversation enregistrée ne garde que la question et la réponse finale** — les allers-retours d'outils
sont un espace de travail éphémère à ce tour, jamais persistés (le rechargement d'une conversation ne
montre donc pas « comment » l'assistant a trouvé sa réponse, seulement le résultat ; limite connue de
cette v1). Le nombre de MESSAGES compté dans le quota reste 1 par tour utilisateur, quel que soit le
nombre d'allers-retours d'outils internes — mais les JETONS de chaque appel réel à l'API sont tous cumulés
dans `assistant_usage` (coût réel). Piège corrigé en cours de route : le tableau `messages` envoyé au SDK
ne doit jamais être muté en place après l'appel (`conversationMessages.push`) — un test qui inspectait
`calls[i].params.messages` après coup voyait ses propres mutations, un vrai risque de confusion même en
production ; corrigé en réaffectant `conversationMessages = [...conversationMessages, …]`.

**`systemPrompt.js`** — remplace le renoncement absolu de l'étape A (« tu n'as PAS accès aux données de ce
cabinet ») par une règle conditionnelle valable pour tous les utilisateurs sans dupliquer le bloc mis en
cache : *si* des outils sont proposés, les utiliser pour toute question sur les données réelles et ne
jamais inventer un chiffre ; *sinon*, le dire franchement et renvoyer vers la page. Un résultat d'outil
(noms de locataires, titres de plainte…) est explicitement qualifié de DONNÉE, jamais d'instruction — même
règle que le texte collé par l'utilisateur.

**Vérifié** : 20 tests dédiés à `tools.js` (`test/assistantTools.test.js` — catalogue par permission,
portée agent, tri, bornage, comptabilité jamais scopée, décomposition du point des charges) + 6 tests
d'aller-retour réel dans `test/assistant.test.js` (aucun outil sans permission, outil halluciné sans
crash, plafond des 4 tours avec jetons cumulés et un seul message de quota, la direction voit tout) — suite
backend **220/220** ; `tsc`/`eslint` propres ; navigateur réel sur le cabinet de test (« Audit Comptable
Test », tenant jetable) avec un faux modèle qui appelle RÉELLEMENT l'outil `locataires_en_retard` sur les
vraies données de ce cabinet : réponse finale « 2 locataire(s), pour un total de 157000 FCFA. Le plus
urgent : Dette Entree17105, 23 jours de retard » — cohérent avec les impayés déjà visibles sur les écrans
habituels de ce même cabinet ; quota décrémenté d'un seul message malgré les deux appels réels à l'API.

**Reste à faire** : les mêmes points que l'étape A (clé API, budget de test réel, vérification légale) —
voir plus bas — s'appliquent aussi à l'étape B ; en plus : mesurer le coût réel d'un tour avec outil(s) sur
le vrai modèle (hypothèse de travail non vérifiée : 2 à 3× un message simple) ; étape C (briefing hebdo,
brouillons de relance WhatsApp) non commencée.

**Reste à faire** : (1) mettre `ANTHROPIC_API_KEY` dans `backend/.env` puis faire approuver un petit budget de test
sur le vrai modèle — à mesurer : coût réel par message (`assistant_usage`), et si le cache de la consigne se
déclenche vraiment (`cache_read_tokens` > 0 ; la taille minimale cacheable dépend du modèle) ; (2) déploiement :
rejouer la migration 065 ; Caddy reverse-proxy le flux sans réglage (pas de compression sur le domaine API) ;
(3) vérifier les obligations légales sur les données personnelles avant activation chez un vrai cabinet (règle
béninoise non confirmée) ; (4) étape B.

## Étape 42 — Prorata d'entrée + dette initiale réglée dans le compte séquestre

🟢 Validé en navigateur réel sur le cabinet de test (« Audit Comptable Test »), y compris un piège de
déploiement réel découvert et corrigé en cours de route. **Décisions explicites de l'utilisateur** :
diviseur forfaitaire de 30 jours, le montant appartient au propriétaire, libellé « Prorata d'entrée »,
réglage par défaut laissé à « aucun » (comportement historique inchangé) — configurable par entreprise.
Deuxième demande explicite, en cours de discussion : « lorsqu'un impayé est payé, on doit aussi l'ajouter
dans le compte séquestre, en le notifiant, avec le détail visible dans le compte séquestre ».

**Le problème d'origine** : un locataire qui entre en cours de mois (ex. le 25 septembre, échéance le 5)
n'était facturé ni pour les jours réellement occupés (option « rien facturer », déjà possible via la case
« à jour à l'entrée ») ni de façon proportionnelle — aucune des deux options n'existait proprement.
**Bug lié, découvert en creusant** : un bail dont le jour d'entrée tombe APRÈS le jour d'échéance de son
propre mois apparaissait immédiatement « en retard » dès sa création (l'échéance comparée était déjà
dans le passé) — indépendant du prorata, potentiellement déjà présent sur de vrais baux.

### Calcul (`services/rentTracking.js`, nouveau)
- `firstRegularDueDate(startDate, rentDueDay)` : la prochaine date portant le jour d'échéance, à partir de
  `startDate` INCLUS — une entrée exactement le jour d'échéance donne 0 jour de prorata (cas normal).
- `computeEntryProrata({ startDate, monthlyRent, rentDueDay })` : jours occupés avant cette échéance ×
  loyer ÷ **30** (forfaitaire, jamais les jours réels du mois — décision explicite), arrondi au franc.
  Miroir exact côté front, `previewEntryProrata` (`lib/utils.ts`), vérifié identique par un test dédié —
  sert uniquement à l'aperçu instantané du formulaire, le serveur reste seul à calculer le montant stocké.

### Modèle et flux (migration `067_entry_prorata.sql`)
- `leases.entry_proration` ('aucun'/'prorata'), `entry_prorata_amount/_days/_due_date` (toujours calculés
  par le SERVEUR, jamais transmis par le client), `entry_prorata_received_at/_received_method`.
- `tenants.default_entry_proration` (Réglages, DG) — défaut 'aucun', repris à la création d'un bail comme
  `default_rent_timing`, exposé via `toPublicTenant` (les 3 appelants dans `auth.js`) car un simple agent
  doit pouvoir le lire à la création d'un bail, pas seulement le DG.
- Payé à la signature, comme la caution et les frais d'agence (`recordEntryProrataReceived`,
  `routes/renters.js`, dans les DEUX routes de création de bail) — jamais différé à la première échéance :
  ne touche donc JAMAIS `computeArrears`/`allocateRentPayment` (déjà audités).
- Nouveau type d'écriture GL `prorata_entree_encaisse` (`constants/glOperationTypes.js`,
  `seedGeneralLedger.js`) — MÊME répartition qu'un loyer normal (commission + reste au propriétaire),
  exactement comme `dette_initiale_encaissee` (précédent déjà en place) — jamais comme les frais d'agence
  (100 % cabinet). Backfill historique ajouté dans `glActivationService.js` (comme pour la caution/les
  frais d'agence) pour un tenant qui activerait la comptabilité avancée APRÈS avoir déjà encaissé des
  prorata.

### Compte séquestre — les deux sources désormais comptées (`services/commission.js`)
**Avant cette étape**, `getEscrowBalances`/`getRecetteNetteMaison` ne lisaient QUE `rent_payments` : la part
RÉGLÉE d'une dette initiale (`lease_opening_debt_payments`, étape antérieure) n'entrait dans AUCUN total
« argent détenu pour ce propriétaire » — un vrai manque, différent du choix délibéré de garder la partie
NON réglée séparée (`getUnpaidOpeningDebtByOwner`, toujours à part). Les deux fonctions lisent maintenant
TROIS sources (loyers, dette initiale réglée, prorata d'entrée), groupées par mois de RÈGLEMENT effectif
pour les deux dernières (elles n'ont pas de mois de loyer propre) — même traitement de commission que les
loyers. Un `breakdown` (`{ rent, openingDebt, prorata, expenses }`, montants BRUTS avant commission) est
renvoyé partout où le solde l'est (fiche propriétaire, tableau de bord comptable, portail propriétaire)
pour que « les détails se retrouvent dans le compte séquestre », pas seulement un total opaque.

**Frontend** : fiche propriétaire — nouvelle section « Dont, avant commission » sous le compte séquestre,
listant loyers/dette initiale/prorata/dépenses (les postes à 0 restent masqués sauf loyers). Formulaire de
création de bail — bloc dédié dès qu'une entrée décalée est détectée (aperçu jours/montant, choix radio
« ne rien facturer » / « facturer le prorata », mode + date de règlement si prorata > 0, case « faire
démarrer le cycle normal à la prochaine échéance » **cochée automatiquement** dans ce cas précis — jamais
pour l'onboarding historique, qui reste une décision manuelle de l'agent). Le panneau de succès affiche le
montant et le nombre de jours ajoutés au compte séquestre. Réglages — nouvelle carte « Prorata d'entrée »
(réglage par défaut). Toast enrichi sur le règlement d'une dette initiale, qui mentionne désormais
explicitement son effet sur le compte séquestre (demande « notifier cela »).

### Piège de déploiement réel trouvé en testant en direct
Le cabinet de test avait DÉJÀ activé la comptabilité avancée avant l'ajout de la nouvelle règle GL —
`genererEcriture` a levé une vraie erreur (« Aucune règle comptable active pour l'opération
"prorata_entree_encaisse" ») exactement comme prévu par la mécanique de seed existante (`seed()` ne se
rejoue jamais automatiquement pour un tenant déjà initialisé). Corrigé en rejouant `seed(tenantId)`
manuellement sur le tenant de test (opération idempotente, sans effet sur les règles déjà validées par un
comptable) — **la même opération sera nécessaire sur KIko Store (tenant 8, comptabilité avancée active)
au déploiement**, à documenter dans les notes de mise en production, jamais faite sur ce tenant réel
sans une demande explicite.

**Vérifié** : 4 tests GL (`test/gl/entryProrata.test.js`, mêmes assertions que `entryFee.test.js`/
`openingDebt.test.js`) + 6 tests unitaires (`computeEntryProrata`/`firstRegularDueDate`,
`test/rentTracking.test.js`) + 3 tests d'intégration escrow/recette (`test/commission.test.js`) — suite
backend **233/233** ; `tsc`/`eslint` propres ; miroir front/back vérifié identique (script ad hoc) ;
navigateur réel de bout en bout sur le cabinet de test : création d'un bail entrant le 28/09 (échéance le
5) avec choix « facturer le prorata » → aperçu exact (17 500 FCFA, 7 jours) → confirmation à la création →
fiche propriétaire montrant le détail complet (loyers 758 000 + dette initiale réglée 43 000 + prorata
17 500 − dépenses 12 000 = 806 500 FCFA de recette nette cumulée). Données de test nettoyées après
vérification.

**Reste à faire** : mesurer si l'utilisateur veut aussi le détail sur le relevé PDF propriétaire (pas
encore fait — ce PDF ne montre aujourd'hui ni recette ni séquestre, seulement patrimoine + historique des
versements, un chantier séparé) ; réappliquer `seed(8)` sur KIko Store au déploiement (ci-dessus) ;
rejouer la migration 067.

## Étape 43 — Cautions supplémentaires (SBEE, SONEB, peinture)

Demande directe de l'utilisateur : en plus de la caution de loyer (déjà existante,
`leases.deposit_amount`), jusqu'à 3 cautions optionnelles par entreprise — SBEE/SONEB (garantie contre
les impayés de charges) et peinture (garantie contre les frais de remise en état) — chacune activable
indépendamment, montant **toujours saisi à la main** (jamais suggéré), restituable, et « claires »
(affichées séparément, jamais fondues dans la caution de loyer).

Décisions explicites de l'utilisateur : (1) SBEE/SONEB sont une garantie contre les impayés de charges,
pas un remboursement d'installation de compteur ; (2) un dépassement de la retenue peinture au-delà de
SA PROPRE caution retombe sur la caution de LOYER ; (3) **un seul compte comptable** (165, celui de la
caution de loyer) pour les trois types — le type se lit dans le libellé de l'écriture, pas dans un
sous-compte séparé ; (4) le montant est toujours saisi manuellement, jamais suggéré/calculé.

### Modèle de données (migration 068)
- `tenants.deposit_{sbee,soneb,peinture}_enabled` — désactivées par défaut, chaque entreprise choisit
  (Réglages, DG).
- Nouvelle table `lease_deposits` (`type` ENUM sbee/soneb/peinture, `amount`, `status` held/returned,
  `received_at/_method`, `returned_at/_amount/_method`, `deduction_amount/_note`) — une ligne par type
  effectivement demandé à CE bail (un type non demandé ne laisse aucune ligne, jamais une ligne à 0).
- `move_out_reports.peinture_deduction_amount/_note` — même principe que `other_deductions_amount/_note`
  déjà existant, mais pour la retenue peinture spécifiquement (jamais mêlée aux autres retenues).

### Service central (`services/leaseDeposits.js`, nouveau)
- `recordAdditionalDeposits` — à la signature, une ligne + une écriture GL (`caution_supplementaire_recue`)
  par type effectivement demandé et activé pour l'entreprise (un type non activé envoyé quand même est
  ignoré silencieusement, jamais une erreur).
- `settleUnpaidUtilityCharges`/`getUnpaidUtilityBalance` — à la sortie, SBEE/SONEB règlent RÉELLEMENT le
  solde impayé du locataire en réutilisant `recordUtilityPayment` (déjà exporté par `routes/charges.js`,
  même fonction que le règlement normal d'une charge) : les factures de ce locataire ne restent plus
  impayées après coup, et le propriétaire reçoit ce qui a été recouvré comme n'importe quel autre
  encaissement de charge — jamais une simple ligne comptable isolée.
- `finalizeAdditionalDeposits`/`checkAdditionalDepositRefunds` — décompte de sortie : pré-vérifie (AVANT
  toute écriture) qu'un mode de règlement est fourni pour toute caution dont il reste effectivement un
  montant à rendre ; calcule le dépassement de la retenue peinture (plafonnée à sa propre caution) à
  reporter sur la caution de loyer.
- Nouveaux types d'écriture GL `caution_supplementaire_recue`/`_restituee` (compte 165 unique, décision
  explicite ci-dessus), backfill historique ajouté dans `glActivationService.js`.

### Piège corrigé avant même le premier test (dédoublonnage du rattrapage GL)
`glActivationService.js` dédoublonne son rattrapage par **`(tenant_id, source_table, source_id)` SEUL**,
sans regarder le type d'opération. Deux cautions différentes sur le même bail (ex. SBEE et SONEB)
partageraient `leaseId` comme identifiant commun si on l'utilisait naïvement → la seconde serait ignorée
à tort comme « déjà faite ». Corrigé en utilisant l'id de la ligne `lease_deposits` elle-même (unique par
nature) comme `sourceId`, et un `sourceTable` synthétique différent pour la restitution
(`'lease_deposits_return'`, jamais une vraie table — même précédent que `'lease_entry_fees'`/
`'lease_entry_prorata'` ailleurs) pour que la réception et la restitution de la MÊME ligne ne se
percutent jamais.

### Piège de déploiement réel trouvé en testant en direct (même mécanique que l'étape 42)
Le cabinet de test avait déjà activé la comptabilité avancée avant l'ajout des deux nouvelles règles GL —
`genererEcriture` a levé une vraie erreur (« Aucune règle comptable active pour l'opération
"caution_supplementaire_recue" »). Corrigé en rejouant `seed(tenantId)` manuellement sur le tenant de
test — **la même opération sera nécessaire sur KIko Store (tenant 8) au déploiement**, jamais faite sur
ce tenant réel sans une demande explicite.

### Bug réel trouvé et corrigé pendant l'écriture du service
`services/leaseDeposits.js` importait `UTILITY_TYPE_LABELS` depuis `constants/charges.js`, qui n'exporte
que `UTILITY_TYPES` (tableau) — l'import valait `undefined` et aurait fait planter
`settleUnpaidUtilityCharges` au premier règlement réel. Corrigé en dérivant la table de labels
localement. Également corrigé une formulation redondante (« Caution Caution SBEE... reçue ») dans les
deux modèles de narration GL (`{type}` porte déjà le libellé complet « Caution SBEE (électricité) »).

### Frontend
Réglages — nouvelle carte « Cautions supplémentaires » (3 cases à cocher). Création de bail (les deux
routes) — section dédiée, un bloc par type ACTIVÉ pour l'entreprise, montant + mode de règlement + date ;
panneau de succès mentionnant chaque caution enregistrée. Fiche locataire — carte « Cautions
supplémentaires » séparée de la caution de loyer, une ligne par type avec son statut
(conservée/restituée). État des lieux de sortie (brouillon) — section dédiée : SBEE/SONEB affichent un
texte explicatif (règlement automatique des impayés à la sortie) + sélecteur de mode de restitution
optionnel ; peinture a un champ de retenue manuel + motif + sélecteur de restitution requis si un reste
est calculable côté client, avec avertissement du dépassement éventuel vers la caution de loyer. Fiche
finalisée — chaque caution supplémentaire affichée avec sa retenue/restitution.

**Vérifié** : 12 tests GL dédiés (`test/gl/leaseDeposits.test.js`) couvrant le compte 165 unique dans les
deux sens, le règlement réel des charges impayées (couverture totale et partielle), le dépassement de la
retenue peinture, le refus AVANT toute écriture d'un mode de règlement manquant, et — spécifiquement —
le piège de dédoublonnage corrigé ci-dessus (réception + restitution de deux cautions sur un même bail,
rejouées via le rattrapage, sans qu'aucune ne soit ignorée à tort) ; suite backend complète
**245/245** ; `tsc`/`eslint` propres. Navigateur réel de bout en bout sur le cabinet de test : activation
des 3 cases dans Réglages → création d'un bail avec une caution SBEE (15 000 FCFA, espèces) → écriture GL
vérifiée en base (débit 571/crédit 165, narration propre) → fiche locataire affichant la carte dédiée
(« Caution SBEE (électricité) — Conservée — 15 000 FCFA ») → démarrage du brouillon de sortie confirmant
le rendu de la section (texte de règlement automatique + sélecteur de restitution). Décompte de sortie
complet (remplissage de tous les postes de l'état des lieux) non rejoué en direct — logique déjà couverte
de façon exhaustive par les 12 tests GL ci-dessus. Données de test nettoyées après vérification (cases
Réglages laissées activées, comportement normal d'un réglage d'entreprise plutôt qu'une donnée de test).

**Reste à faire** : réappliquer `seed(8)` sur KIko Store au déploiement (ci-dessus, jamais fait sans
demande explicite) ; rejouer la migration 068 ; construire le relevé PDF propriétaire (recette + compte
séquestre), demandé par l'utilisateur mais explicitement mis en attente derrière cette étape.

## Étape 44 — Recette nette du cabinet + menu « Dépenses »

Demande directe de l'utilisateur : le module Dépenses existait déjà (catégorie, montant, mode de
règlement, statut payée/à crédit, fournisseur, justificatif upload, comptabilisation GL par catégorie,
permission `comptable`) mais restait noyé dans la page Comptabilité, invisible dans le menu — et surtout,
**rien ne déduisait ces dépenses de fonctionnement du revenu propre du cabinet** : seule une recette nette
*par Bien/propriétaire* existait (`getRecetteNetteMaison`), rien au niveau de l'entreprise globale.

Décisions tranchées avec l'utilisateur (3 questions) : la nouvelle recette apparaît sur le **Tableau de
bord** existant (pas une page séparée) ; calculée **par mois calendaire**, comme la recette des
propriétaires ; le lien « Dépenses » du menu reste la **même page** Comptabilité (ancre directe vers le
journal), rien à dupliquer.

### Nouvelle fonction `getCabinetRevenue(tenantId, yearMonth)` (`services/commission.js`)
Revenu du cabinet lui-même pour un mois, tous propriétaires confondus — 4 requêtes agrégées (jamais une
boucle par Bien, même discipline que `getEscrowBalances`) :
- **Commission** : recette nette de CHAQUE Bien (loyers + dette initiale réglée + prorata − dépenses DE
  CE BIEN) × taux en vigueur ce mois-là pour son propriétaire, sommée sur tous les propriétaires.
- **Frais d'agence à l'entrée** (100 % cabinet, déjà existant).
- **Moins les dépenses de FONCTIONNEMENT** (`expenses.property_id IS NULL`) — jamais celles facturées à
  un Bien (déjà déduites côté propriétaire, sinon compté deux fois).
- **Pénalités de retard volontairement EXCLUES** pour l'instant : `late_fees.applied_at` n'est qu'une
  date d'application, aucun encaissement réel n'est tracé (pas de table `late_fee_payments`) — les
  inclure surestimerait le revenu réel. Choix de jugement documenté dans le code, jamais inventé une
  fausse certitude ; à ajouter le jour où un vrai suivi de règlement existera.

Branché dans `computeAccountingDashboard` (nouveau champ `cabinetRevenue`, `null` si la période demandée
ne correspond pas exactement à un seul mois calendaire) — jamais confondu avec `netCashFlow` existant,
qui est une trésorerie brute (loyer encaissé moins versé), pas la commission réellement gagnée ce mois.

### Frontend
Tableau de bord — nouvelle carte « Recette nette du cabinet (mois) » avec le détail (commission + frais
d'agence − dépenses), jamais un chiffre opaque. Barre latérale — nouvelle entrée « Dépenses » dans
FINANCES, pointant vers `/espace/comptabilite#depenses` (ancre HTML vers le Journal des dépenses déjà
existant, aucune page dupliquée). Piège trouvé et corrigé en testant en direct : la navigation native vers
une ancre échouait silencieusement (la section n'existe pas encore dans le DOM au moment où le navigateur
tente de défiler, chargement encore en cours) — corrigé par un effet qui retente le défilement une fois
les données du journal effectivement chargées.

**Vérifié** : 2 tests dédiés (`test/commission.test.js`, commission sommée sur deux propriétaires à des
taux différents + frais d'agence − dépenses de fonctionnement, en excluant explicitement une dépense
facturée à un Bien) — suite backend complète **247/247** ; `tsc`/`eslint` propres ; navigateur réel de
bout en bout sur le cabinet de test : carte du tableau de bord affichant le détail exact
(commission 20 000 + frais d'agence 0 − dépenses 15 431 = 4 569 FCFA), clic sur « Dépenses » dans le menu
atterrissant directement sur le journal après correction du défilement.

**Reste à faire** : décider si/quand inclure les pénalités de retard une fois un vrai suivi
d'encaissement construit (hors périmètre de cette étape).

## Étape 44bis — Suivi de règlement des pénalités de retard

Demande directe de l'utilisateur, en revenant sur la limite documentée à l'étape 44 : une pénalité de
retard (`late_fees`, migration 047) n'avait jusqu'ici aucun suivi de règlement — ni statut, ni date de
paiement, une créance comptable (411) restant indéfiniment ouverte, sans que personne ne puisse dire si
elle avait été payée. Comblé sur le même modèle que la dette initiale à l'entrée (`lease_opening_debt_payments`).

### Modèle
- Nouvelle table `late_fee_payments` (migration 069) — une pénalité peut être réglée en une ou plusieurs
  fois (`late_fee_id`, jamais `lease_id` directement : un bail peut avoir plusieurs pénalités, chacune
  réglée indépendamment).
- Nouveau type d'écriture GL `penalite_retard_encaissee` — débite la trésorerie (mode de paiement),
  crédite le MÊME compte 411 déjà ouvert par `penalite_retard` à l'application : solde la créance, ne
  recrée JAMAIS le produit 707 (déjà comptabilisé, une pénalité reste reconnue en produit dès son
  application — décision d'origine non remise en cause, seul le règlement était manquant).
- `POST /api/leases/:leaseId/late-fees/:lateFeeId/payments` — même verrouillage/idempotence que le
  règlement de la dette initiale ; `GET .../late-fees` renvoie désormais `paid`/`remaining`/`status`
  (impayée/partielle/payée) par pénalité.
- `listPortfolioArrears` (relances/impayés) — une pénalité non réglée compte désormais comme une
  troisième raison de retard (avec le loyer et la dette initiale), sans empêcher les deux autres.
- `getCabinetRevenue` (étape 44) — les pénalités RÉELLEMENT réglées (`paid_at`, jamais `applied_at`)
  entrent maintenant dans la recette nette du cabinet, remplaçant l'exclusion documentée à l'étape 44.
- Backfill historique (`glActivationService.js`) ajouté pour les deux nouveaux cas (application déjà
  couverte, règlement nouveau) — deux tables réelles distinctes, aucun risque de collision de
  dédoublonnage (contrairement au piège des cautions supplémentaires, étape 43).

### Frontend
Fiche locataire — chaque pénalité affiche son statut (badge impayée/partielle/payée) et, si un reste est
dû, un formulaire de règlement (montant, mode, date, note) identique dans l'esprit à celui des impayés à
l'entrée. Relances — nouvelle ligne « Pénalité(s) non réglée(s) » à côté des impayés à l'entrée. Tableau
de bord — le détail de la recette nette du cabinet inclut désormais les pénalités réglées.

**Vérifié** : 3 tests GL dédiés (`test/gl/lateFeePayments.test.js` : écriture de règlement correcte,
`listPortfolioArrears` réduit puis retire le bail, rattrapage historique sans collision) + 2 tests
`commission.test.js` (recette du cabinet mise à jour au mois de RÈGLEMENT, jamais celui d'application) —
suite backend complète **251/251** ; `tsc`/`eslint` propres. Navigateur/API réel de bout en bout sur le
cabinet de test : pénalité de 5 000 FCFA appliquée, réglée en deux fois (2 000 puis 3 000) — statut
passant impayée → partielle → payée à chaque étape, écritures GL vérifiées en base (411 correctement
soldé, jamais de second crédit 707), recette nette du cabinet passée de 4 569 à 6 569 FCFA après le
premier règlement, bail disparaissant des impayés une fois la pénalité intégralement réglée. Données de
test nettoyées après vérification.

## Étape 45 — Refonte design de la quittance de loyer (modèle facture pro)

Demande directe de l'utilisateur, avec un exemple visuel de facture professionnelle en référence
(logo+société / gros titre+date sur une ligne, bloc expéditeur/destinataire, tableau à en-tête colorée,
total dans une barre pleine couleur, note, ligne de remerciement, pied à plusieurs colonnes). Précision
importante obtenue en clarifiant : c'est la QUITTANCE (`streamReceiptPdf`) qui est visée, pas une
« facture » — aucun document de ce nom n'existe dans le logiciel.

Deux décisions tranchées avec l'utilisateur avant de coder (le modèle utilise des informations que
l'entreprise n'a pas en base) :
1. Le bloc « adresse du cabinet » du modèle reste RCCM/IFU/téléphone (aucune adresse en base, pas de
   nouveau champ ajouté).
2. Le bloc « informations de paiement » (coordonnées bancaires, sans objet sur une preuve de paiement
   déjà reçu) est remplacé par le cachet/signature déjà existant, réorganisé en colonne à côté du
   contact — jamais une donnée inventée.

### Ce qui change dans `streamReceiptPdf` (`services/pdf.js`)
En-tête entièrement reconstruit (n'utilise plus `drawHeader` générique pour ce document précis) : logo +
nom du cabinet à gauche, titre « QUITTANCE » + date sur la MÊME ligne à droite (au lieu du titre seul à
gauche et des méta-informations en petit à droite avant) ; une seconde ligne CABINET (RCCM/IFU/téléphone)
/ À L'ATTENTION DE (locataire + bien loué) reprend la structure adresse-expéditeur/destinataire du
modèle. Tableau des lignes désormais à **en-tête plein fond bleu marine, texte blanc** (au lieu d'un
simple texte gris) — colonnes réordonnées Description/P.U./Mois/Montant pour coller au modèle. Total mis
en évidence dans une **barre pleine couleur** (texte blanc), remplaçant l'ancien panneau à fond clair.
Nouveau bloc « Note » (reprend la phrase de certification déjà existante) et ligne « Merci pour votre
confiance. » avant le pied de page. Pied à deux colonnes (Une question ? / Cachet & signature) au lieu
d'un simple bloc signature empilé — comble l'espace vide en bas de page sans rien inventer.

**Vérifié** : suite backend complète **251/251** (aucun test ne dépend du rendu exact du PDF) ; rendu
réel généré directement (script ad hoc appelant `streamReceiptPdf` avec les données d'un vrai paiement du
cabinet de test) ET via la vraie route API (`GET /api/leases/:leaseId/payments/:paymentId/receipt.pdf`,
HTTP 200, PDF valide) — comparé visuellement au modèle fourni par l'utilisateur, structure fidèle
(logo+titre+date, bloc expéditeur/destinataire, tableau à en-tête colorée, barre de total colorée, pied
à deux colonnes).

**Reste à faire** : les autres documents (attestation, PV de sortie, relevé propriétaire, carnet de
charges) gardent leur design actuel — cette refonte est volontairement scopée à la seule quittance, pas
demandée ailleurs.

**Complément demandé juste après** : la date sous le titre affiche désormais aussi l'HEURE de
délivrance — `receipts.issued_at` (horodatage réel de la création de CETTE quittance), jamais
`payment.paid_at` (juste un jour, sans heure, et un concept différent : le loyer a pu être réglé un
jour, la quittance émise à un autre moment). Nouvelle fonction `formatTimeHm(date)`, même piège que
`frontend/lib/utils.ts` `formatTimeOfDay` : le pool MySQL étiquette les horodatages en UTC alors qu'ils
sont déjà en heure locale (WAT) — relit donc `getUTCHours`/`getUTCMinutes`, jamais la conversion locale
du process Node. Vérifié : la valeur brute en base (`09:20:03`) correspond exactement à l'heure affichée
sur le rendu réel, aucun décalage d'une heure.

## Étape 46 — Attestation de loyer → Contrat de bail (remplacement complet)

Demande directe de l'utilisateur : « attestaion loyer doit est changé contrat de loyer, et on refaire
le design aussi trea professionnelle ». L'ancienne « attestation de loyer » était une simple lettre
unilatérale (signature DG seule, texte libre `{{placeholder}}` personnalisable dans Réglages) — pas un
vrai contrat. Trois décisions tranchées avec l'utilisateur avant de coder (choix « Recommandé » retenu
dans les trois cas) :
1. **Double signature** (locataire + agent), comme l'état des lieux — au lieu de la signature DG seule.
2. **Document structuré par clauses** (articles numérotés calculés depuis les vraies données du bail),
   au lieu du texte libre à `{{placeholder}}` personnalisable.
3. **Remplacement complet partout** (même emplacement de bouton/route), pas un document additionnel en
   parallèle de l'ancienne attestation.

### Nouveau modèle : brouillon → finalisation (repris du système état des lieux)
Nouvelle table `lease_contracts` (migration `070_lease_contracts.sql`) : `status
ENUM('draft','finalized')`, `particular_conditions TEXT`, `snapshot JSON` (figé au moment de la
signature — un contrat signé ne doit plus jamais recalculer son contenu depuis des données de bail
possiblement modifiées après coup), `finalized_at/by`, `tenant_signature_path`/`agent_signature_path`.
`document_issuances.document_type` : renommage ENUM `'attestation'` → `'contrat'` (migration en 3 temps
sûre : élargir l'ENUM, `UPDATE` les lignes existantes, rétrécir l'ENUM). Nouveau service
`services/leaseContract.js` (`buildContractData` — calcule les données réelles du bail incluant les
cautions additionnelles de l'étape 43 ; `loadContractRow`/`toPublicContract`).

**Décision de sécurité prise sans demander** : la colonne `tenants.contract_template` (ancien modèle
texte libre) n'est PAS supprimée par la migration malgré son obsolescence totale — KIko Store (tenant
réel, id 8) y a 4530 caractères réellement personnalisés par l'utilisateur ; colonne laissée inerte
(plus lue par aucun code) plutôt que détruite irréversiblement.

### PDF (`streamLeaseContractPdf`, remplace `streamCertificatePdf` dans `services/pdf.js`)
9 articles numérotés (Parties / Objet / Durée / Loyer / Caution(s) / Obligations locataire /
Obligations bailleur / Résiliation / Conditions particulières), bandeau d'avertissement « PROJET — NON
SIGNÉ » affiché uniquement tant que `status !== 'finalized'`, blocs de signature côte à côte
(locataire/agent). Nouvelles routes dans `leases.js` : `GET/POST/PATCH /:leaseId/contract`, `POST
/:leaseId/contract/finalize` (upload des 2 signatures via `signaturesUpload`), `GET
/:leaseId/contract.pdf`. Route portail `GET /:token/contract.pdf` (remplace `/certificate.pdf`,
404 explicite si pas encore signé par les deux parties) ; `GET /:token` expose désormais
`activeLease.hasSignedContract` pour n'afficher le bouton de téléchargement côté locataire qu'une fois
le contrat réellement signé. Suppression complète : route `GET /:id/certificate.pdf` (renters.js),
carte « Modèle de l'attestation de loyer » des Réglages, fichier `constants/contract.js`.

**Frontend** : nouvelle page `locataires/[id]/contrat` (brouillon éditable → aperçu par article → double
signature → PDF final), réutilise `FinalizeSection`/`SignatureBlock` de l'état des lieux sans
modification. Bouton « Contrat de bail » sur la fiche locataire à l'emplacement exact de l'ancien
bouton attestation.

### Bugs trouvés et corrigés en vérifiant en direct
- **`JSON.parse` sur une colonne déjà parsée** : `leases.js` et `portal.js` faisaient
  `JSON.parse(contract.snapshot)`, mais mysql2 parse déjà automatiquement une colonne `JSON` en objet JS
  à la lecture — `JSON.parse()` sur un objet le coerce en `"[object Object]"`, une chaîne invalide en
  JSON (`SyntaxError`, HTTP 500). Corrigé en lisant directement `contract.snapshot` (l'écriture, elle,
  fait bien `JSON.stringify()` — c'est la lecture seule qui doit ne jamais re-parser).
- **Date mal formatée dans le PDF** : `.toString().slice(0,10)` sur un objet `Date` JS donne
  `"Sun Sep 28 2026 ..."` et non une chaîne ISO, ce que `formatDateFr` (attend `YYYY-MM-DD`) ne peut pas
  découper → « Rédigé le undefined undefined NaN » sur le PDF réel. Corrigé en `.toISOString().slice(0,10)`.

### Nettoyage terminologique complémentaire
Après le remplacement fonctionnel, un `grep -rin "attestation"` sur tout le dépôt a révélé plusieurs
textes encore visibles par l'utilisateur (pas seulement des commentaires de code) qui mentionnaient
encore l'ancienne « attestation » : description de la page Réglages, message de révélation du lien
portail (page « nouveau locataire »), métadonnées SEO + texte de la page publique `/verifier`, deux
cartes du contenu marketing de la landing page, et la base de connaissances de l'assistant IA (le texte
que Claude peut réciter au personnel dans le chat). Tous mis à jour pour dire « contrat de bail ». Les
mentions restantes du mot « attestation » dans le dépôt sont uniquement des commentaires de code
expliquant l'historique de ce changement (étape 46) — aucune ne reste visible par un utilisateur final.

**Vérifié** : suite backend **255/255** (dont les 4 nouveaux tests `leaseContract.test.js`) ; `tsc`/
`eslint` frontend propres ; parcours complet en direct (Selenium + curl sur le cabinet de test) :
création brouillon → aperçu avec vraies données de bail → édition conditions particulières →
finalisation double signature → téléchargement PDF signé côté personnel ET côté portail locataire →
compteur de téléchargements → vérification publique par code — les deux bugs ci-dessus trouvés et
corrigés à cette occasion, pas avant.

**Reste à faire** : aucune action de code en attente. KIko Store conserve son `contract_template` inerte
(4530 caractères) sans qu'aucune action ne soit requise, sauf si l'utilisateur souhaite l'exporter ou le
supprimer plus tard.

## Étape 47 — Refonte de « Mon compte » + photo de profil

Demande directe de l'utilisateur : « on va revoir le design de mon compte, permettre aux utilisateurs
d'ajouter une photo de profil aussi ». La page existante n'affichait QUE le cachet/la signature
personnels (aucun nom, téléphone, rôle, ni accès volontaire au changement de mot de passe — seulement
forcé à la première connexion). Question de portée posée avant de coder, réponse « Recommandé » retenue
: page complète (en-tête d'identité + cachet/signature redessinés + accès volontaire au mot de passe),
plutôt qu'un simple ajout de carte photo sur la page inchangée.

### Backend
Nouvelle colonne `users.avatar_path` (migration `071_user_avatar.sql`) — purement visuelle dans l'app,
jamais utilisée sur un document PDF (le cachet/la signature restent le seul mécanisme légal). Route
`PATCH /api/auth/my-signature` renommée `PATCH /api/auth/my-profile` et élargie à un 3e champ `avatar`
(un seul appel enregistre photo/cachet/signature ensemble, même dossier `uploads/tenants/<t>/employees/<u>/`,
mêmes `assertUploadType`/`randomFileName` que l'existant — aucune nouvelle logique d'upload). `toPublicUser`
expose désormais `avatarUrl`.

### Frontend
`mon-compte-view.tsx` entièrement redessiné : en-tête d'identité (photo cliquable avec bouton appareil
photo superposé, nom, badge de poste via `tenant.roleTitles`, téléphone), cartes cachet/signature
reprises à l'identique visuellement, et nouvelle carte « Sécurité » avec un lien vers
`/changer-mot-de-passe`. Cette page existait déjà et gérait déjà le cas volontaire (texte différent selon
`mustChangePassword`) mais n'était reliée nulle part — seul le flux forcé de première connexion y menait.
Petite correction de cohérence trouvée au passage : `ChangePasswordForm` affichait toujours le label
« Mot de passe actuel (temporaire) », qui n'a de sens que dans le flux forcé — rendu conditionnel à
`user.mustChangePassword`.

La photo remplace aussi les initiales dans le pied de la barre latérale (`espace-sidebar.tsx`) dès
qu'elle existe — sinon l'utilisateur aurait pu se demander pourquoi sa photo n'apparaît nulle part
ailleurs après l'avoir téléversée.

**Vérifié** : suite backend 255/255 inchangée (aucun test ne couvrait cette route, comportement non
régressif confirmé par la suite existante) ; `tsc`/`eslint` frontend propres ; parcours complet en direct
(curl + Selenium sur le cabinet de test) : upload d'une photo test → apparaît sur la carte d'identité ET
dans la barre latérale → accès volontaire à « Changer mon mot de passe » depuis Mon compte → label sans
« (temporaire) » confirmé. Données de test nettoyées après vérification (photo supprimée en base et sur
disque).

**Reste à faire** : aucune action de code en attente.

## Étape 48 — Audit complet des états des lieux (bug corrigé + 4 points faibles traités)

Demande directe de l'utilisateur : « on va maintenant pencher sur les états des lieux, vérifie tout ce
qui marche et qui ne marche pas, les points faibles et les solutions à apporter », suivie de « fait tout
les point faibles ». Audit mené en explorant le code **et** en rejouant en direct (curl + Selenium) le
parcours entrée→sortie complet sur le cabinet de test, avant toute correction — plusieurs points n'ont
été confirmés qu'après avoir vu le comportement réel, pas seulement lu le code.

### Bug réel trouvé et corrigé
Le mode de règlement de la restitution de caution (`refund_payment_method`) était saisi, exigé côté
serveur (`netRefund > 0`), et stocké en base — mais **jamais renvoyé par l'API**, ni affiché à l'écran,
ni mentionné sur le PV de sortie signé par les deux parties. Un document légal annonçait « Net à
restituer : X FCFA » sans jamais dire comment. Corrigé dans `toPublicMoveOutReport` (`services/inspection.js`),
le type frontend, l'écran de sortie finalisée, et le PDF (`streamMoveOutPdf`, nouvelle ligne « Réglé
par »). Régression couverte par 4 nouveaux tests dans `test/inspectionPdf.test.js`.

### Les 4 points faibles traités (décisions arbitrées par l'utilisateur avant de coder)

**1. Réouverture d'une fiche finalisée** (DG uniquement, motif obligatoire ≥10 caractères, tracé au
journal d'activité) — nouvelles colonnes `reopened_at/by/reason` sur `move_in_reports`/`move_out_reports`
(migration `072`). Invalide les deux signatures existantes (fichiers supprimés, il faut resigner).
Pour la **sortie**, la réouverture ne défait **jamais** les effets déjà survenus (bail terminé, unité
libérée, cautions supplémentaires réglées — des faits, pas des erreurs de saisie) : seul le contenu de
la fiche redevient modifiable. Une écriture comptable « caution restituée » déjà postée est **extournée**
(`extourneEcriture`, jamais modifiée/supprimée directement) à la réouverture ; la refinalisation
réévalue et poste une nouvelle écriture si le nouveau calcul le justifie. Un drapeau interne
(`report.reopened_at` déjà présent avant ce finalize précis) distingue une refinalisation d'une première
finalisation pour ne **jamais** rejouer `UPDATE leases/property_units` ni `finalizeAdditionalDeposits`
une seconde fois. Vérifié en direct de bout en bout : première finalisation avec dégât facturé → aucune
écriture GL (retenue) → réouverture (rien à extourner) → correction (retire la facturation) →
refinalisation → **une** écriture "caution restituée" postée → réouverture d'une fiche qui a cette fois
une écriture → **extournée automatiquement** (confirmé en base : `status='extournee'` + nouvelle écriture
miroir) → refinalisation → nouvelle écriture propre. Bail/unité jamais touchés une deuxième fois
(confirmé : `end_date` inchangé après correction).

**2. Réserves du locataire** — nouveau champ `tenant_reserves` (même migration), rempli par l'**agent**
au moment de la signature (jamais un accès en écriture du locataire — décision de l'utilisateur), sur
`FinalizeSection` (partagé entrée/sortie). Affiché en encadré distinct des notes générales, à l'écran et
sur le PDF (`drawTenantReserves`).

**3. Galerie de photos (jusqu'à 3 par élément, entrée et sortie)** — `item.photoUrl` (singulier) devient
`item.photoUrls[]` (jusqu'à 3, plafonné côté serveur ET client) ; `normalizeStoredItems` migre à la
lecture les anciennes fiches `photoUrl` sans jamais les réécrire (même principe que les anciennes
conditions `bon/moyen/mauvais`). Upload : ajoute au tableau (400 si déjà 3). Suppression : nouvelle route
`DELETE .../photo/:photoIndex` (position dans le tableau — l'ancienne route sans index n'avait de sens
que pour une photo unique). Les photos apparaissent désormais aussi sur le PDF (elles n'y figuraient
**jamais** avant cette étape, sur aucun des deux documents) — petites vignettes sous chaque élément.

**4. Vue portefeuille sur le tableau de bord DG** — nouvelle section `inspections` dans
`GET /api/dashboard/overview` : brouillons en attente (tous agents confondus, contrairement à « Mes
tâches » scopée à l'agent connecté), sorties du mois, et cautions à régulariser (voir ci-dessous).

### Corrections/ajouts faits sans redemander (mécaniques, ou découverts pendant l'audit)
- **PDF de l'état des lieux d'entrée** : n'existait pas du tout avant cette étape (seule la sortie
  s'exportait). Nouvelle fonction `streamMoveInPdf`, qui partage désormais `drawInspectionZones`/
  `drawTenantReserves`/`drawSignatureBlock`/`drawReopenedNotice` avec `streamMoveOutPdf` (refactor —
  évite ~100 lignes dupliquées). Nouvelle route `GET /:leaseId/move-in-report.pdf`.
- **Aucun code de vérification sur les PV** (découvert en corrigeant le point précédent) : ni le PV de
  sortie ni le nouveau PDF d'entrée n'appelaient `getOrCreateIssuance`/`drawFooter({verificationCode})` —
  contrairement à la quittance et au contrat de bail. Corrigé des deux côtés (personnel : code généré,
  téléchargements illimités par conception ; portail : `registerDownload` avec le plafond de 5). Nouveau
  couple de types `document_issuances.document_type` : `etat_lieux_entree`/`etat_lieux_sortie`
  (migration `074`, jamais détourné `contrat`/`carnet_charges` qui désignent autre chose).
- **Restitution de caution avec retenue jamais comptabilisée** : déjà signalé par un message ponctuel à
  la finalisation (facile à manquer, jamais revu ensuite). Nouvelles colonnes `gl_regularized_at/by`
  (migration `073`) + nouvelle route `POST .../gl-regularized` (comptabilité ou DG) pour la marquer
  réglée. Reste visible dans « Mes tâches » (comptable — `components/espace/my-tasks-card.tsx`, nouvelle
  carte « Cautions à régulariser ») et sur le tableau de bord DG tant que personne ne l'a marquée réglée.
  Fonction extraite dans `services/inspection.js` (`listPendingDepositRegularizations`), partagée par les
  deux routes plutôt que dupliquée.
- **Portail locataire** : n'exposait **aucun** contenu d'état des lieux (ni entrée ni sortie), alors que
  le locataire les a physiquement signés. Le portail restreint volontairement l'accès au bail *actif*
  uniquement (décision v1 déjà documentée dans le code) — or le PV de sortie n'existe qu'une fois le bail
  *terminé*. Dérogation étroite et ciblée : nouveau `loadLastPortalLease` (dernier bail, actif OU
  terminé — jamais l'historique complet), utilisé **seulement** par les 2 nouvelles routes
  `GET /:token/move-in-report.pdf` et `/move-out-report.pdf` ; le reste du portail (paiements, charges,
  contrat) continue de n'utiliser que le bail actif, comportement inchangé.
- Info-bulles sur les boutons BE/ME/SR (`title=`) — le libellé complet n'apparaissait qu'après sélection,
  jamais avant.

### Correction d'une erreur de cette même étape
Une première version de cet audit affirmait que « Mes tâches » (comptable/agent) n'était consommée par
aucune page frontend, faute d'avoir grepé `getMyTasks` sous `app/` seulement — la carte existe bel et
bien, sous `components/espace/my-tasks-card.tsx`, montée sur `/espace` pour tout non-DG (étape 18,
2026-09-, déjà validée). Le rappel de régularisation de caution manquait seulement d'une carte dans ce
composant déjà existant, ajoutée dans la foulée (ci-dessus) — aucune page n'a eu besoin d'être créée.
Correction demandée directement par l'utilisateur après relecture de ce même compte-rendu.

**Vérifié** : suite backend **265/265** (10 nouveaux tests purs + 4 nouveaux tests PDF) ; `tsc`/`eslint`
frontend propres ; parcours complet en direct sur le cabinet de test (curl + Selenium) : entrée avec 3
photos (plafond testé, refusé au 4e) + réserves → PDF d'entrée avec vignettes + encadré réserves + code
de vérification → sortie avec dégât facturé → **bug du mode de règlement confirmé absent puis présent
après correctif** → réouverture → correction → refinalisation → **écriture GL extournée puis reposée
confirmée en base** → régularisation manuelle marquée réglée → disparition du tableau de bord confirmée.
Données de test entièrement nettoyées (rapports, écritures GL, catalogue, fichiers). Non commité (branche
`audit-comptable`).

**Reste à faire** : aucune action de code en attente sur les 4 points traités. Construire la page « Mes
tâches » (découverte pendant l'audit, hors périmètre) reste optionnel, à la demande de l'utilisateur.

## Étape 49 — Audit de sécurité général du projet (6 volets) + 4 correctifs sévérité haute

Demande directe de l'utilisateur : « on va un revue général ds fonctionnalité que ne marche pas encore,
les bugs, les mauvaises utilisations de sécurité, manque de logique ». Audit mené en 6 volets parallèles
(agents en lecture seule, aucune modification pendant l'audit) : authentification/isolation multi-tenant,
surface publique (portails, marketplace, webhooks), intégrité de l'argent (paiements, GL, KKiaPay),
sécurité des uploads de fichiers, sécurité de l'assistant IA, sécurité/logique frontend. Puis, sur
décision de l'utilisateur (« les 4 sévérité haute d'abord »), les 4 problèmes les plus sérieux ont été
corrigés et vérifiés en direct.

### Vue d'ensemble du constat
Le code est globalement discipliné (portée par tenant systématique sur la quasi-totalité des routes,
jetons à entropie forte, montants validés, grand livre équilibré, aucune vraie faille XSS trouvée). Deux
agents indépendants ont trouvé la MÊME faille (favoris marketplace), ce qui l'a confirmée sans ambiguïté.
Au total : 4 constats sévérité haute, ~11 sévérité moyenne (non traités à ce stade), le reste en notes/
choix déjà assumés.

### Les 4 correctifs sévérité haute

**1. Fuite de données inter-entreprises confirmée (favoris Quick Immo)** — `POST/GET/DELETE
/api/marketplace-accounts/favorites/:unitId` (`routes/marketplaceAccounts.js`) ne vérifiait jamais que
l'unité appartient à la même entreprise (tenant) que le compte, ni même qu'elle est réellement publiée.
N'importe quel compte public auto-inscrit pouvait « favoriser » puis lire (adresse, loyer, statut) n'importe
quelle unité de n'importe quelle entreprise sur la plateforme, publiée ou non, juste en devinant un id
séquentiel. Corrigé : `POST` exige désormais une annonce publiée (`marketplace_listings`) pour CE tenant
précis (même condition que la page publique) ; `GET`/`DELETE` filtrent aussi par `tenant_id`, en défense
en profondeur. Confirmé en base : 0 favori existant n'enfreignait déjà la règle. Vérifié en direct par
jeton forgé (compte réel, tenant 136) : unité d'un autre tenant → 404 ; unité publiée du même tenant →
201 ; `GET /favorites` ne renvoie que la bonne. Favori de test retiré après vérification.

**2. Double paiement possible (dépense fournisseur / immobilisation / IRF)** — `POST
/api/accounting/expenses/:id/pay`, `POST /api/accounting/fixed-assets/:id/pay`
(`routes/accounting.js`) et `payIrf` (`services/gl/glIrfService.js`) vérifiaient le statut « déjà réglé »
AVANT d'ouvrir la transaction, sans verrou — un double-clic ou une requête relancée pouvait régler deux
fois la même dette (deux écritures GL pour un seul vrai paiement), contrairement à `rent_payments`/
`utility_payments` qui étaient déjà protégés. Corrigé : verrou `SELECT ... FOR UPDATE` + `UPDATE ...
WHERE payment_status = 'unpaid'` (vérifié via `affectedRows`) pour dépenses/immobilisations, même schéma
que l'existant côté loyers. Pour l'IRF (solde dérivé d'une somme sur `gl_entry_lines`, pas une ligne à
verrouiller directement) : verrouillage du compte 442 (`gl_accounts`) puis relecture du solde SOUS ce
verrou avant de décider — même principe que le correctif déjà en place pour les versements propriétaires
(audit A2). `getIrfBalance` renvoie désormais `{accountId, balance}` (était un nombre brut) — site
d'appel `routes/gl/glIrf.js` et les tests ajustés en conséquence. Vérifié : nouveau test de concurrence
réelle (`Promise.allSettled` sur deux `payIrf` simultanés, un seul réussit, solde final correct) ; en
direct par HTTP, deux requêtes `curl` strictement simultanées sur la même dépense puis la même
immobilisation — une seule aboutit (204), l'autre 409, une seule écriture « Règlement fournisseur » en
base dans les deux cas. Données de test nettoyées.

**3. Double extourne comptable possible** — `extourneEcriture` (`services/gl/glReversalService.js`)
lisait le statut de l'écriture sans verrou puis faisait un `UPDATE` inconditionnel — deux extournes
lancées en même temps sur la MÊME écriture pouvaient toutes les deux réussir, chacune créant sa propre
écriture miroir et inversant l'effet économique deux fois, silencieusement (aucune erreur). Corrigé :
`SELECT ... FOR UPDATE` sur l'écriture cible + `UPDATE ... WHERE status = 'validee'` (vérifié via
`affectedRows`). Les 3 appelants (annulation d'un paiement de loyer, réouverture d'un état des lieux de
sortie déjà finalisé, bouton « Extourner » manuel) appellent déjà `extourneEcriture` à l'intérieur de leur
propre transaction — aucun changement nécessaire côté appelants. Vérifié : nouveau test de concurrence
réelle (deux extournes simultanées sur la même écriture via deux connexions séparées) — une seule
réussit, l'autre échoue en « déjà été extournée », une seule écriture miroir existe en base.

**4. Aucun rafraîchissement automatique du jeton de session** — `JWT_ACCESS_TTL` (15 minutes) côté
backend n'était jamais renouvelé côté frontend : `lib/auth/auth-context.tsx` ne rafraîchissait le jeton
qu'une seule fois, au montage de la page. N'importe quel onglet laissé ouvert plus de 15 minutes tombait
en erreur « Session invalide ou expirée » sur chaque appel API, sans redirection ni récupération
automatique — l'utilisateur devait deviner qu'il fallait recharger la page. Corrigé, sans toucher à
`apiFetch` ni aux ~100 sites d'appel existants (qui lisent tous le jeton via le contexte React, donc
profitent automatiquement d'un jeton mis à jour en state) : un nouvel `useEffect` dans `AuthProvider`
rafraîchit silencieusement le jeton toutes les 10 minutes (confortablement sous les 15 minutes de durée
de vie), ET dès que l'onglet redevient visible (`visibilitychange`) — ce second déclencheur couvre le cas
d'un ordinateur mis en veille plus longtemps qu'un `setInterval` seul ne peut le détecter (il ne tourne
pas pendant la veille). Un échec de rafraîchissement dû à une simple panne réseau passagère ne déconnecte
jamais personne (seule une vraie `ApiError` — cookie de refresh réellement révoqué/expiré côté serveur —
déclenche une déconnexion) ; un garde anti-chevauchement évite deux rafraîchissements concurrents (qui
auraient pu se marcher dessus, le refresh token étant à usage unique). Vérifié en direct (Selenium) : un
événement `visibilitychange` déclenche bien un appel réseau réel `POST /api/auth/refresh` (confirmé dans
les logs backend, HTTP 200), sans casser la session ni la navigation.

**Vérifié globalement** : suite backend **267/267** (2 nouveaux tests de concurrence : IRF et extourne) ;
`tsc`/`eslint` frontend propres. Non commité au moment de l'audit (fusionné dans `main` depuis, voir
commit `f1a352b`).

### Correctifs sévérité moyenne (suite, même audit)

Sur décision explicite de l'utilisateur (« on traite ça en même temps »), les constats sévérité moyenne
ont été traités dans la foulée, un par un avec vérification en direct après chacun. `/uploads` servi sans
authentification a été explicitement laissé en risque documenté (décision utilisateur — l'entropie forte
du nom de fichier atténue déjà le risque ; refactoriser des dizaines de composants frontend pour ajouter
une auth dessus est jugé disproportionné à ce stade).

**Erreur de calcul de commission d'un jour** — `resolveCommissionRate` (`glAccountResolver.js`) comparait
`ends_on > atDate` (strict) alors que `owners.js` écrit `ends_on` comme le DERNIER JOUR INCLUS de l'ancien
taux : ce jour précis retombait à 0 % dans le grand livre au lieu de l'ancien taux, désynchronisé de
`services/commission.js` (tableau de bord, garde-fou de versement) qui utilisait déjà la bonne borne
inclusive. Corrigé (`>=`) ; nouveau test dédié `test/gl/commissionRateBoundary.test.js` (4 cas : jour
frontière, lendemain, milieu de plage, avant tout taux).

**`charges.js` ignorait le cloisonnement par agent** — contrairement à l'audit initial qui accusait aussi
`utilityReadings.js` (vérification directe : ce fichier avait déjà 13 usages corrects de
`resolvePropertyScope`, ce constat-là était erroné), `routes/charges.js` n'appliquait vraiment aucun
filtre agent sur aucune de ses routes (liste, détail, paiements, résumé mensuel). Corrigé : même schéma que
le reste de l'application (`resolvePropertyScope` + jointure jusqu'à `properties.agent_id`, 404 plutôt que
403 en cas de hors-périmètre). Vérifié en direct avec un agent de test restreint à un seul Bien : liste,
détail et résumé mensuel ne montrent plus que les charges de son périmètre.

**Clôture de mois non reverrouillée dans la transaction d'écriture (course)** — `assertPeriodOpen` était
un simple `SELECT` exécuté AVANT `conn.beginTransaction()` dans les ~22 sites d'appel (`leases.js`,
`owners.js`, `utilityReadings.js`, `gl/glIrf.js`, `accounting.js`, `charges.js`) : rien n'empêchait une
clôture de mois de se glisser entre cette vérification et l'écriture réelle, laissant potentiellement
passer une écriture antidatée dans un mois qui vient d'être clôturé. Corrigé par une nouvelle fonction
`assertPeriodOpenLocked(conn, tenantId, dateStr)` (`services/accountingPeriods.js`) qui pose un verrou de
« gap » InnoDB (`SELECT ... FOR UPDATE` sur la clé UNIQUE `(tenant_id, period)` de `accounting_periods`,
même sans ligne existante) — appelée une seconde fois, DANS la transaction, juste après
`conn.beginTransaction()`, sur chacun des 22 sites. La route de clôture elle-même
(`POST /api/accounting/periods`) a été réécrite pour acquérir ce même verrou avant son propre `INSERT`,
ce qui sérialise correctement clôture et écriture l'une contre l'autre (et corrige au passage une double
clôture concurrente qui remontait auparavant une 500 brute au lieu d'une 409 propre). Deux routes
(`PATCH`/`DELETE /api/accounting/expenses/:id`, `DELETE /api/owners/:id/charge-remittances/:remittanceId`,
`DELETE /api/charges/:id`) n'avaient encore aucune transaction du tout et ont été enveloppées dans une
pour pouvoir participer au même verrou.

Effet de bord découvert en vérifiant en direct (5 créations de dépense + 1 clôture de mois lancées
strictement en parallèle sur le même mois, tenant 1594) : sous forte contention sur ce même verrou,
InnoDB détecte parfois un cycle d'attente entre transactions et en annule une lui-même
(`ER_LOCK_DEADLOCK`) — jamais une corruption (MySQL garantit qu'aucune des deux transactions n'est
appliquée à moitié), mais rien dans le code ne traduisait ce cas : l'utilisateur recevait une 500 brute
avec le message MySQL en anglais. Corrigé dans le gestionnaire d'erreurs central
(`middleware/error.js`) : `ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT` sont désormais traduits en une 409
propre (« Conflit temporaire… merci de réessayer »), quel que soit le verrou concerné — bénéficie aussi
au verrou pré-existant de `seedGeneralLedger.js` repéré plus tôt dans le même audit. Revérifié après ce
correctif : même course en parallèle → les créations concurrentes reçoivent soit 201 (validées avant la
clôture) soit 409 propre (deadlock OU période déjà clôturée), la clôture aboutit, et aucune dépense
n'est jamais retrouvée datée dans un mois déjà clôturé. Données de test nettoyées après vérification.

**Vérifié** : suite backend **271/271** ; `node -c` propre sur les 8 fichiers touchés.

**Lien de paiement marqué « payé » sans vérifier le montant confirmé** — `verifyAndRecordKkiapay`
(`services/paymentVerification.js`) marquait `payment_links.status = 'paid'` pour toute transaction
KKiaPay confirmée, sans jamais comparer son montant à `payment_links.amount` (le montant réellement dû).
Un montant insuffisant (transaction mal formée, ou une autre transaction réelle du même compte marchand
soumise ici) affichait quand même « réglé » au personnel. Corrigé : le lien ne passe à `'paid'` que si
`verification.amount >= link.amount` ; l'argent reçu reste de toute façon toujours crédité au bail/à la
facture dans les deux cas (jamais refusé), seul le badge du lien distingue réglé/en attente. Nouveau
fichier de test `test/paymentVerification.test.js` (2 cas : montant insuffisant → crédité mais lien
« pending » ; montant suffisant → lien « paid »), `kkiapay.verifyTransaction` mocké via `node:test`.

**Plaintes sans clé d'idempotence** — ni `routes/complaints.js` (personnel) ni `routes/portal.js`
(locataire) ne protégeaient contre un double envoi sur reconnexion instable, contrairement à tous les
enregistrements d'argent (étape 36). Risque concret côté personnel : `lib/api/complaints.ts` met en file
hors-ligne (IndexedDB) tout envoi en échec réseau et le rejoue au retour de connexion — si le premier
envoi avait en fait réussi côté serveur mais que sa réponse s'était perdue, le rejeu créait un doublon
silencieux. Corrigé en réutilisant tel quel le garde-fou déjà en place pour l'argent
(`claimIdempotencyKey`, `services/paymentGuards.js`) : nouveau champ optionnel `idempotencyKey` sur les
deux schémas (`validators/complaints.js`, `validators/portal.js`), réclamé dans la transaction des deux
routes (celle de `portal.js` n'avait d'ailleurs encore aucune transaction — ajoutée). Côté frontend, une
seule clé est générée par envoi et réutilisée telle quelle pour la mise en file hors-ligne — c'est cette
réutilisation qui ferme vraiment la faille (`lib/api/complaints.ts`, et le formulaire du portail locataire
`app/portail/[token]/portail-view.tsx` via le hook déjà existant `useIdempotencyKey`). Le message d'erreur
générique de doublon (`DUPLICATE_MESSAGE`) parlait spécifiquement de « paiement » — généralisé
(« Cet envoi a déjà été enregistré… ») puisqu'il sert maintenant aussi aux plaintes. Vérifié en direct
(tenant 1594) : même clé envoyée deux fois → 201 puis 409 propre, une seule plainte en base, une seule
clé consommée. `tsc`/`eslint` frontend propres, suite backend **273/273**.

**Page Relances : décalage entre le profil admis par la page et ce que chaque section accepte
réellement** — `RequireAuth permission={["locataires","comptabilite","charges"]}` (OR) est en réalité
correct dans son principe (la page sert bien 3 profils différents, chaque section ayant sa propre
permission côté backend : `/arrears` et `/predictive-alerts` → locataires OU comptabilite ;
`/utility-arrears` → charges OU comptabilite) — ce n'était donc pas la liste de permissions elle-même le
problème, mais l'absence de dégradation propre par section : un agent avec UNIQUEMENT `charges` (sans
`locataires` ni `comptabilite`) recevait un 403 sur `/arrears`, affiché comme une vraie panne
(« Impossible de charger les impayés. ») au lieu d'être traité comme une section non applicable à son
profil — exactement comme la section charges le fait déjà silencieusement pour un profil sans `charges`.
Corrigé (`app/espace/relances/relances-view.tsx`) : la section loyer/pénalités ne tente même plus l'appel
et reste simplement absente pour un profil sans `locataires` ni `comptabilite` (calculé côté client via
`user.role`/`user.permissions`, même logique que `RequireAuth`), au lieu de se rabattre sur une erreur ou
un « aucun retard » trompeur après coup. `tsc`/`eslint` propres. Vérifié en direct (Selenium, tenant
1594, agent de test avec la seule permission `charges`) : page accessible, aucune bannière d'erreur,
aucun « Chargement… » bloqué, section loyer totalement absente, section charges SONEB/SBEE correctement
peuplée (7 factures). Agent de test supprimé après vérification.

**Purge des conversations de l'assistant IA jamais planifiée** — `purgeExpired`
(`services/assistant/conversations.js`) n'était appelée qu'opportunistement après chaque échange
(`services/assistant/chat.js`), et seulement pour le tenant qui vient de discuter : un cabinet qui a
discuté une fois puis plus jamais gardait ses anciennes conversations indéfiniment, au-delà du délai de
conservation affiché (`AI_RETENTION_DAYS`, 90 jours par défaut). Corrigé : nouveau
`jobs/assistantPurgeJob.js` (même patron que les 5 tâches planifiées existantes —
`tenantIds`/pas d'argument = tous les cabinets, une erreur sur un cabinet n'interrompt jamais les
suivants), enregistré dans `jobs/scheduler.js` à 03h00 chaque jour (heure creuse). La purge opportuniste
reste en place en complément (aucune régression si le job planifié tombe en panne un jour). 3 nouveaux
tests dans `test/assistant.test.js` : balayage de deux cabinets (dont un qui n'a jamais rediscuté depuis)
avec des conversations vieillies directement en base ; une conversation récente n'est jamais touchée ; un
identifiant de cabinet en tête de liste ne bloque jamais le passage aux suivants.

**Vérifié** : suite backend **276/276** (271 → 273 avec les correctifs KKiaPay/plaintes → 276 avec la
purge planifiée) ; `node -c` propre sur les 3 fichiers touchés/créés ; scheduler démarré manuellement en
isolation (`startScheduler()`, 6 tâches désormais enregistrées) sans erreur.

**Tous les constats sévérité moyenne de l'étape 49 sont désormais traités.** Deux constats bas/notes
laissés tels quels sur décision assumée (jamais des bugs à proprement parler) : `/uploads` sans
authentification (voir plus haut, choix utilisateur explicite après une question posée en cours de
session — l'entropie forte du nom de fichier atténue déjà le risque, refactoriser des dizaines de
composants frontend pour ajouter une auth dessus étant jugé disproportionné à ce stade) ; cache hors-ligne
(IndexedDB) non chiffré (compromis pré-existant, documenté dans le code) ; `updateUnit`/
`updateAssignedTask` (fonctions API frontend jamais appelées) laissées sans suite, ambigu s'il s'agit d'un
écran manquant — pas de suppression ni de nouvel écran sans consigne explicite.

**Récapitulatif étape 49 (audit + tous les correctifs)** : 4 sévérité haute + 7 sévérité moyenne corrigés
et vérifiés en direct (concurrence réelle, Selenium, ou curl selon le cas) ; suite backend passée de
267/267 (avant tout correctif) à **276/276** ; `tsc`/`eslint` frontend propres tout du long ; aucune
modification sur KIko Store (tenant 8), tout testé sur le tenant jetable 1594 avec nettoyage systématique
des données de test. Non commité au moment de la rédaction (branche `main`, en plus des commits déjà
en place localement pour les étapes 39-48).

## Étape 50 — les 3 derniers constats de l'audit (étape 49), sur demande explicite (« on va régler ça aussi »)

Les 3 derniers points de l'étape 49, laissés en risque documenté faute de décision produit, ont été
tranchés par l'utilisateur (3 questions posées) puis implémentés. Détail complet dans la mémoire projet
(`general-security-audit.md`), résumé ici.

### 1. `/uploads` sans authentification — corrigé (choix : fetch + blob)

**Découverte en cours de route, avant tout code** : le site public Quick Immo (`quick-immo/`, app externe
séparée) affiche des photos d'unités à des visiteurs anonymes
(`listing-card.tsx`, `mon-compte/page.tsx`) — impossible donc de rendre TOUT `/uploads` authentifié sans
casser la marketplace publique. Vérification du code (`routes/marketplace.js`) : les photos d'annonces
marketplace vivent dans un dossier SÉPARÉ (`tenants/<id>/marketplace/<unitId>/`) des photos de Bien
utilisées par la fiche CRM (`tenants/<id>/properties/<id>/`) — aucun conflit, seules les photos
marketplace + le logo d'entreprise doivent rester publics.

**Backend** :
- `routes/files.js` (nouveau) — `GET /api/files/*`, exige `requireAuth`, borne strictement au tenant de
  la session (`tenants/<tenantId>/…`), rejette toute tentative de traversée de répertoire, liste blanche
  d'extensions.
- `app.js` — le montage `express.static('/uploads', …)` ne sert plus QUE le logo (motif `logo-*.{png,jpg,jpeg,webp}`
  à la racine `tenants/<id>/`) et les photos marketplace (`tenants/<id>/marketplace/**`) ; tout le reste
  renvoie 404 sur `/uploads/…` désormais.
- `utils/uploads.js` — nouveaux `toProtectedFileUrl(rel)`/`stripFileUrlPrefix(url)`, utilisés par les 15
  endroits qui construisaient une URL `/uploads/…` dans une réponse JSON (`auth.js`, `accounting.js`,
  `settings.js`, `properties.js`, `complaints.js`, `leases.js`, `leaseContract.js`, `inspection.js`) —
  sauf les 7 qui restent volontairement publics (logo ×5, photos marketplace ×2). `services/pdf.js`
  (génère les PDF en lisant directement sur disque, jamais via HTTP) adapté pour résoudre indifféremment
  un chemin `/uploads/…` ou `/api/files/…`.

**Frontend** (choix explicite de l'utilisateur : fetch + blob plutôt qu'URL signée) :
- `components/ui/authenticated-image.tsx` (nouveau) — `<img>` de remplacement : récupère le fichier en
  blob avec l'en-tête `Authorization`, affiche une URL objet locale ; gère aussi nativement un `src` déjà
  local (`blob:`/`data:`, aperçu avant envoi) sans le re-télécharger.
- `openAuthenticatedPdf` (déjà existant, `lib/api/client.ts`) réutilisé tel quel pour les liens
  « voir/ouvrir » (marche pour n'importe quel type de fichier, pas seulement les PDF).
- 9 composants adaptés : `espace-sidebar.tsx` (avatar — le logo, lui, reste public et inchangé),
  `bien-view.tsx`, `plainte-view.tsx`, `parametres-view.tsx`, `mon-compte-view.tsx`,
  `comptabilite-view.tsx`, `signature-block.tsx` (+ ses 3 appelants : contrat/état des lieux
  entrée/sortie), `inspection-form.tsx`, `inspection-readonly.tsx`. `accessToken` propagé en prop
  jusqu'aux sous-composants qui ne l'avaient pas encore (`SignatureBlock`, `ItemRow`/`ZoneSection`
  dans `inspection-form.tsx`, `FinalizedView` dans `contrat-view.tsx`). `marketplace-view.tsx` (photo
  d'annonce, employé) volontairement PAS touché — même dossier public que Quick Immo.

**Vérifié** : 5 scénarios en direct (curl, tenant 1594) — ancienne URL `/uploads/…` sur un fichier privé
→ 404 ; nouvelle route sans jeton → 401 ; avec le bon jeton → 200 + contenu binaire identique (MD5) ;
traversée de répertoire → 404 ; jeton valide d'un tenant demandant un fichier d'un AUTRE tenant → 404 ;
logo et photo marketplace restent 200 sans jeton. Selenium (navigateur réel) : upload d'avatar,
enregistrement, RECHARGEMENT de page (donc sans aperçu local, fetch authentifié pur) — l'avatar s'affiche
correctement dans la sidebar ET la fiche « Mon compte », capture d'écran à l'appui. `tsc`/`eslint`
frontend propres, suite backend **276/276**. Données de test nettoyées (avatar, colonne `avatar_path`,
fichiers logo/marketplace placés manuellement pour le test).

### 2. Chiffrement du cache hors-ligne (IndexedDB) — corrigé (choix : clé en mémoire uniquement)

`lib/offline/crypto.ts` (nouveau) — AES-GCM 256 bits via Web Crypto natif (aucune dépendance), clé de
session générée au premier besoin, **jamais persistée** (ni `localStorage`, ni `sessionStorage`, ni
IndexedDB) : c'est le choix explicite de l'utilisateur (protection plus forte contre une extraction brute
des fichiers du navigateur), accepté en connaissance de cause que toute donnée déjà chiffrée devienne
irrécupérable dès qu'une nouvelle clé est générée — en particulier un rechargement de page perd la file de
paiements/plaintes pas encore synchronisés. `lib/offline/db.ts` chiffre désormais `body` (les deux
magasins) et `summary` (file — contient des noms/montants lisibles) ; le reste (id, url, kind, method,
path, status, error, dates) reste en clair, ce sont des métadonnées de synchronisation, non des données
métier. Entièrement transparent pour les appelants (`cacheGet`/`queueList` renvoient toujours du JSON
déchiffré) — zéro changement dans `lib/offline/queue.ts` ni dans les composants qui affichent la file
(`connection-indicator.tsx`, `espace-sidebar.tsx`).

Un piège technique rencontré en écrivant `queueUpdate` : une opération Web Crypto asynchrone intercalée
entre un `get` et un `put` sur la MÊME transaction IndexedDB risque de tomber hors de sa fenêtre de vie
(auto-commit) — corrigé en séparant lecture et écriture sur deux transactions distinctes, le chiffrement
se faisant entre les deux, hors de toute transaction ouverte.

Une entrée de la file devenue illisible (clé perdue) est retirée silencieusement de `queueList()` (avec
un `console.warn` pour le diagnostic) plutôt que de laisser une entrée fantôme s'accumuler indéfiniment.
`clearOfflineData()` (déconnexion) force aussi une nouvelle clé pour la session suivante, par principe.

**Vérifié en direct** (Selenium, tenant 1594) : après navigation normale dans l'app, lecture directe
d'IndexedDB — les 5 lignes du cache ne contiennent plus que `{url, encBody, cachedAt}` (jamais de champ
`body` en clair), le contenu de `encBody` est un blob base64 opaque, et aucune sous-chaîne reconnaissable
du contenu réel (prénom, nom, téléphone d'un locataire) n'apparaît dans le JSON stocké. Résiduel repéré
(hors périmètre de ce correctif) : l'URL elle-même sert de clé d'indexation IndexedDB et reste donc en
clair par nécessité — pour UN endpoint précis (`GET /api/auth/role-titles?phone=...`, appelé pendant la
saisie du formulaire de connexion, avant authentification), le numéro de téléphone tapé apparaît donc en
clair dans cette clé de cache. Effet mineur (l'app le faisait déjà avant ce correctif, la donnée cachée
elle-même — le libellé du poste — n'est pas sensible), non traité ici (le corriger exigerait de hacher les
URLs utilisées comme clé, un changement de conception plus large que ce qui a été demandé). La file de
mutations, elle, n'a pas pu être testée en conditions RÉELLEMENT hors-ligne (Selenium/Firefox headless ne
simule pas fiablement une coupure réseau) — sa logique de chiffrement est strictement la même
(`encryptValue`/`decryptValue`) que celle du cache de lecture, déjà vérifiée en direct, et `tsc`/`eslint`
sont propres sur `db.ts`/`crypto.ts`/`queue.ts`.

### 3. Formulaires `updateUnit`/`updateAssignedTask` — corrigé (les 2 formulaires manquants construits)

Backend déjà prêt et testé des deux côtés (aucune modification nécessaire) — juste l'UI manquait.

**Unité locative** (`app/espace/biens/[id]/bien-view.tsx`) : nouveau bouton « Modifier » (icône crayon)
sur chaque ligne du tableau des unités, toujours visible quel que soit le statut (contrairement à
« Libérer »/« Publier », mutuellement exclusifs selon le statut). Ouvre `EditUnitForm` (nouveau composant,
même gabarit que `NewUnitForm` déjà existant), pré-rempli avec les valeurs actuelles de l'unité :
désignation, loyer, compteurs SONEB/SBEE, meublé. Le statut n'est volontairement PAS éditable ici pour ne
pas entrer en conflit avec le workflow dédié déjà en place (« Libérer » qui termine le bail actif).

**Tâche assignée** (`app/espace/taches/taches-view.tsx`) : nouveau bouton « Modifier » (DG uniquement,
même garde que « Supprimer »), qui remplace l'affichage de la ligne par un formulaire d'édition inline
(`EditTaskForm`, nouveau composant) — titre, description, employé assigné, date limite.

**Vérifié en direct** (Selenium, tenant 1594) : création d'une tâche de test puis modification de son
titre → le nouveau titre s'affiche, l'ancien disparaît (capture d'écran à l'appui). Modification du loyer
d'une unité réelle du portefeuille (AUD-001-U02, 100 000 → 123 456 FCFA) → toast de confirmation, nouveau
montant affiché dans le tableau (capture d'écran à l'appui) ; loyer restauré à sa valeur d'origine après
vérification. Employé de test et tâches de test supprimés. `tsc`/`eslint` propres.

---

**Étape 50 entièrement terminée** : les 3 derniers constats de l'audit (étape 49) sont désormais tous
traités — `/uploads` authentifié, cache hors-ligne chiffré, formulaires d'édition manquants construits.
Suite backend **276/276**, `tsc`/`eslint` frontend propres sur l'ensemble du projet (une seule erreur
eslint résiduelle, dans `next-env.d.ts`, fichier auto-généré par Next.js sans rapport avec ce travail).
Non commité. Rien de tout ce travail n'a touché KIko Store (tenant 8) — uniquement le tenant jetable 1594,
avec nettoyage systématique des données de test après chaque vérification.

## Étape 51 — audit du cœur comptable, sur demande explicite (« vérifie toutes les fonctionnalités comptables »)

Demande directe de l'utilisateur, distincte de l'audit sécurité (étape 49) : un audit du cœur COMPTABLE
lui-même (justesse des calculs, pas la sécurité). Mené en 6 agents parallèles en lecture seule (loyers/
retards/pénalités, commissions/versements/séquestre, charges SONEB/SBEE, module GL SYSCOHADA, dépenses/
immobilisations, cautions + cohérence croisée entre les vues). Synthèse : **5 constats critiques, 8
« Haute », 5 « Moyenne »**. Sur décision explicite de l'utilisateur (« Critiques + Haute d'un coup »), les
13 constats les plus sérieux sont traités dans cette même étape.

### Les 5 correctifs CRITIQUES

**1. Prorata d'entrée jamais réinjecté dans le calcul de retard** — `baselineMonthOf`
(`services/rentTracking.js`) utilisait toujours `startDate` brut du bail comme point de départ du suivi
mensuel classique, même quand un prorata d'entrée (étape 42) avait été réglé à part. Un locataire entré
le 25 (échéance le 5) apparaissait « en retard de 25 jours » **le jour même de son emménagement**, sur un
mois déjà couvert par le prorata — répercuté dans la relance groupée, les alertes prédictives, et figé
pour toujours dans les photos de solde à la clôture (`snapshotLeaseBalances`). Corrigé : `baselineMonthOf`
accepte désormais `entryProration`/`rentDueDay` et démarre le suivi à `firstRegularDueDate(...)` quand
`entryProration === 'prorata'` — correctif porté par la fonction PARTAGÉE elle-même (pas par chacun de ses
~17 points d'appel individuellement) pour ne jamais en oublier un. 5 nouveaux tests dans
`rentTracking.test.js`. Vérifié en direct (tenant 1594) : bail créé le 25/09 avec prorata → `status:
"current"`, `daysLate: -5`, absent de la relance groupée.

**2. Double déduction de commission en mode `gl_commission_timing = 'reversement'`** —
`getEscrowBalances`/`assertPayoutWithinBalance` (`services/commission.js`) déduisaient TOUJOURS la
commission au fil de l'eau, même quand ce réglage (Comptabilité avancée → Règles comptables, réellement
activable côté UI) reporte la déduction au moment du reversement effectif. Le solde séquestre affiché
était donc déjà net, et la commission se retrouvait prélevée une SECONDE fois par l'écriture GL du
reversement. Corrigé : le calcul du solde reste BRUT quand ce mode est actif. Nouveau test isolé dans
`commission.test.js`. **Vérifié en direct sur données réelles** (tenant 1594, déjà en mode
`'reversement'`) : solde séquestre = 550 000 FCFA (loyers bruts), alors que le taux réel est de 10 % —
confirme que le bug touchait déjà ce tenant avant le correctif.

**3. Aucun report à nouveau à la clôture d'exercice — le bilan était faux dès la 2ᵉ année d'activité** —
`computeBalanceSheet` (`services/gl/glFinancialStatements.js`) filtrait actif/passif sur le seul
`fiscal_year_id` de l'exercice consulté, alors que ces comptes PERSISTENT d'un exercice à l'autre (une
trésorerie ne repart jamais à zéro le 1er janvier) — et ce module ne génère jamais d'écriture de report à
nouveau (choix assumé, documenté). Corrigé en rendant `actif`/`passif` — et le résultat net utilisé pour
équilibrer le bilan — CUMULATIFS depuis le tout premier mouvement du tenant (même principe déjà établi et
correct pour la trésorerie dans `computeCashFlow`, juste étendu à tout le bilan). Libellés PDF/Excel
corrigés en conséquence (« Perte/Bénéfice cumulé(e) non affecté(e) », plus « de l'exercice »). 2 tests
existants corrigés (ils vérifiaient en fait le bug), 1 nouveau test de cumul avec activité sur 2 exercices
distincts.

**4. Sortie d'immobilisation — fonctionnalité totalement absente** — le schéma prévoyait
`fixed_assets.status = 'disposed'` depuis l'origine (migration 049), mais AUCUNE route ne permettait
jamais d'y accéder : un bien vendu/volé/mis au rebut restait indéfiniment « actif » avec sa valeur
résiduelle, faussant le bilan. Construit de zéro : nouveau compte SYSCOHADA 654 (« Valeurs comptables des
cessions d'immobilisations »), 3 nouvelles règles de comptabilisation `sortie_{informatique,mobilier,
transport}` (nouvelle formule `amortissement_cumule` dans `glAccountResolver.js` : solde l'amortissement
déjà pratiqué, passe la VNC résiduelle en charge, crédite l'actif pour son coût brut — toujours équilibré
par construction), nouvelle route `POST /api/accounting/fixed-assets/:id/dispose` (justification exigée,
acte définitif), colonnes `disposed_reason`/`disposed_by` (migration 075), bouton « Sortir » dans
`comptabilite-view.tsx`. Un tenant déjà actif en continu doit passer par le bouton « Resynchroniser les
règles » existant (nouvelle fonction `syncMissingAccounts`, appelée avant `syncMissingPostingRules` —
sinon une règle référençant un compte encore absent échouerait) pour récupérer le compte 654 et les 3
nouvelles règles. 8 tests dans `fixedAssets.test.js` (VNC partielle/nulle/totale — jamais de ligne à 0
FCFA). **Vérifié en direct de bout en bout** (tenant 1594) : création → 2 mois d'amortissement (33 334
cumulés) → sortie → écriture generée exactement équilibrée (28442 débit 33 334, 654 débit 566 666, 2442
crédit 600 000) ; double sortie et amortissement après sortie correctement rejetés (409).

**5. Résiliation anticipée bloquait définitivement l'accès aux cautions** — `PATCH /api/leases/:leaseId`
(raccourci de fin de bail, jamais appelé par le frontend actuel mais accessible par API directe à tout
agent avec le droit `locataires`) terminait le bail sans jamais toucher `deposit_status` ni les cautions
supplémentaires (SBEE/SONEB/peinture) — et une fois `status !== 'active'`, l'état des lieux de sortie
(SEULE voie qui régularise réellement tout ça, voir `finalizeAdditionalDeposits`) devient
DÉFINITIVEMENT inaccessible pour ce bail. Corrigé : ce raccourci refuse désormais de s'exécuter
(409) dès qu'une caution — loyer ou supplémentaire — est encore `held`, en renvoyant explicitement vers
le circuit normal (état des lieux de sortie). Le cas légitime (aucune caution en jeu) continue de
fonctionner. **Vérifié en direct** : bail de test avec caution de 50 000 FCFA → 409 ; bail réel sans
caution en jeu → 204 (restauré immédiatement après vérification pour ne pas perturber les données du
tenant de test).

**Vérifié globalement (5 critiques)** : suite backend passée de 267/267 (avant toute cette étape) à
**285/285** (14 nouveaux tests). Aucune modification sur KIko Store (tenant 8). Session interrompue une
fois en cours de route (redémarrage de l'environnement) — serveur backend relancé, repris sans perte de
travail (tous les fichiers déjà modifiés étaient sur disque). Non commité.

### Les correctifs « Haute sévérité » (sur 8)

**1. Annulation d'un paiement de loyer déjà reversé → solde séquestre négatif silencieux** —
`DELETE /api/leases/:leaseId/payments/:paymentId` (`routes/leases.js`) annulait n'importe quel paiement
sans jamais vérifier qu'il n'avait pas déjà été reversé au propriétaire entretemps : le solde séquestre de
ce propriétaire pouvait passer sous zéro sans aucun garde-fou (argent déjà sorti de la trésorerie du
cabinet). Corrigé avec le même schéma « verrou puis recalcul » que `assertPayoutWithinBalance` : la ligne
`owners` du propriétaire concerné est verrouillée (`FOR UPDATE`) dans la même transaction que
l'annulation, le solde séquestre est recalculé APRÈS l'annulation logique (`getEscrowBalances` voit déjà
l'écriture de suppression), et un solde négatif fait échouer la transaction (409, message explicite
renvoyant à la régularisation du reversement) plutôt que de la laisser filer.

**2. Divergence d'arrondi entre la fiche d'un Bien et le solde séquestre agrégé (propriétaire
multi-biens)** — `getEscrowBalances` (`services/commission.js`) arrondissait la commission une seule fois
sur le total agrégé du propriétaire, alors que la fiche de chaque Bien (`getRecetteProprietaire`)
l'arrondit BIEN PAR BIEN — pour un propriétaire à plusieurs biens, la somme des soldes affichés par bien
pouvait différer de quelques francs du solde séquestre global affiché sur sa fiche. Corrigé en
restructurant l'agrégation interne de `getEscrowBalances` par `(propriétaire, bien, mois)` — comme
`getRecetteProprietaire` — et en arrondissant la commission à CE niveau avant de sommer : les deux vues
sont désormais mathématiquement garanties cohérentes par construction, plus par coïncidence. Nouveau test
dans `commission.test.js` avec un propriétaire à 2 biens.

**3. Cautions SBEE/SONEB retenues à la sortie mélangeaient la trésorerie** —
`settleUnpaidUtilityCharges` (`services/leaseDeposits.js`) réglait la part retenue d'une caution SBEE/SONEB
en appelant `recordUtilityPayment` avec `paymentMethod: 'especes'` codé en dur, ce qui déclenchait la règle
`charge_locative_encaissee` : un débit de trésorerie (571) pour de l'argent qui, en réalité, avait déjà été
reçu à la signature du bail (`caution_supplementaire_recue`, qui a déjà débité 571 et crédité 165) — un
double encaissement fictif. Pire, le compte 165 (dette envers le locataire) n'était JAMAIS soldé pour la
part retenue : seule `caution_supplementaire_restituee` le débite, et uniquement pour la part réellement
rendue au locataire. Corrigé par une nouvelle règle dédiée `charge_locative_reglee_par_caution` (nouveau
`formula_param` réutilisant les lignes de répercussion propriétaire/frais de gestion identiques à
`charge_locative_encaissee`, mais débitant le compte 165 au lieu de la trésorerie) — un nouveau paramètre
`settledFromDeposit` sur `recordUtilityPayment` choisit la bonne règle et marque la ligne
`utility_payments.settled_from_deposit` (migration 076) pour que le rattrapage GL
(`glActivationService.js`, qui posait le même problème pour un tenant activant le module APRÈS avoir déjà
utilisé cette fonctionnalité) utilise lui aussi la bonne règle. Aucun nouveau compte requis (165 déjà
seedé depuis l'étape 43) — un tenant déjà actif récupère la nouvelle règle via le bouton
« Resynchroniser » existant. 2 nouveaux tests dans `leaseDeposits.test.js` (règlement direct : débit 165 +
crédit 411, zéro écriture de trésorerie ; rattrapage historique : même règle appliquée rétroactivement).

**Vérifié (Haute 1-3)** : suite backend passée à **287/287** (+2 tests). Non commité.

**4. Chemin de paiement KKiaPay sans verrou de clôture de mois** — `verifyAndRecordKkiapay`
(`services/paymentVerification.js`), seul point d'entrée des 3 chemins KKiaPay (portail, lien de paiement,
webhook), n'appelait jamais `assertPeriodOpen`/`assertPeriodOpenLocked` — contrairement à TOUTES les autres
routes de paiement (loyer, charges). Corrigé avec le même schéma que partout ailleurs : vérification
rapide AVANT l'appel réseau à KKiaPay (`assertPeriodOpen`, sur la date du jour — un paiement en ligne ne
peut jamais être antidaté), puis re-vérification SOUS VERROU dans la transaction
(`assertPeriodOpenLocked`). 2 nouveaux tests dans `paymentVerification.test.js` (loyer ET charge, mois en
cours clôturé → rejeté, aucun enregistrement).

**5. Suppression d'une facture SONEB/SBEE déjà réglée sans garde-fou** — `DELETE /api/charges/:id`
n'avait jamais le même garde-fou que `PATCH /:id` (qui fige déjà le montant dès qu'un paiement existe) :
supprimer une facture déjà réglée (même partiellement) faisait disparaître son montant des impayés/soldes
sans jamais toucher l'écriture GL déjà posée (`charge_locative_encaissee`, qui a déjà crédité le
propriétaire) — même risque de solde séquestre négatif silencieux que le Haute #1. Corrigé par le même
garde-fou que PATCH (409 si un paiement existe). **Vérifié en direct** (tenant 1594) : facture jamais
réglée → 204 ; facture avec un règlement partiel → 409 explicite. Pas de route HTTP testée
automatiquement dans ce projet (aucune infrastructure supertest) — vérification live uniquement, données
de test nettoyées.

**6. Incohérence de `sourceTable` entre règlement en direct et rattrapage du module** —
`POST /expenses/:id/pay` et `POST /fixed-assets/:id/pay` (`routes/accounting.js`) postaient leur écriture
de règlement avec `sourceTable: 'expenses'`/`'fixed_assets'` — EXACTEMENT le même `(source_table,
source_id)` que l'écriture d'ENGAGEMENT de la même dépense/immobilisation — alors que
`glActivationService.js` (rattrapage) utilise depuis toujours `'expense_settlements'`/
`'fixed_asset_settlements'` pour ce même règlement, précisément pour ne jamais le confondre avec
l'engagement dans la déduplication (qui ne regarde QUE `source_table`+`source_id`, jamais
`operation_type`). Si le module était suspendu puis réactivé après qu'un tel règlement ait eu lieu EN
DIRECT, le rattrapage ne le reconnaissait jamais comme déjà fait et en reposait un second, en double.
Corrigé en alignant les deux routes sur la convention déjà établie par le rattrapage. Nouveau test dans
`activation.test.js` reproduisant le scénario exact (règlement posté en direct → suspension → réactivation
→ toujours une seule écriture). **Vérifié en direct** (tenant 1594) : dépense à crédit créée puis réglée →
2 écritures distinctes confirmées (`expenses` puis `expense_settlements`), données nettoyées.

**Vérifié (Haute 1-6)** : suite backend **290/290** (+3 tests sur ces 3 derniers). Non commité.

**7. Recette nette du cabinet pas vraiment en base caisse pour les dépenses à crédit** —
`getCabinetRevenue`/`getEscrowBalances`/`getRecetteNetteMaison` (`services/commission.js`) et le tableau de
bord (`routes/accounting.js`) déduisaient les dépenses sur `expense_date` (date d'ENGAGEMENT), jamais
`paid_at` (date de RÈGLEMENT réel) — alors que toutes les autres sources (loyer, dette initiale, prorata,
pénalités) sont déjà en base caisse (comptées à l'encaissement réel, jamais à la facturation). Une dépense
« à crédit » encore impayée réduisait donc à tort la recette nette d'un propriétaire, le solde séquestre ET
la recette du cabinet, le mois de son engagement — avant qu'aucun argent n'ait réellement quitté la
trésorerie — puis ne réduisait RIEN le mois de son règlement effectif (déjà « consommée » à tort plus tôt).
Corrigé dans les 5 requêtes concernées (filtrées sur `payment_status = 'paid' AND paid_at BETWEEN ...`,
`paid_at` valant déjà `expense_date` pour une dépense payée immédiatement — aucun changement dans ce cas
courant). Nouveau test isolé dans `commission.test.js` (dépense impayée engagée en juillet, réglée en
août : juillet reste à 0, août porte la déduction). **Vérifié en direct** (tenant 1594) : dépense à crédit
de 7000 FCFA engagée le 10/09 — absente du tableau de bord de septembre ; réglée le 05/10 — apparaît
alors dans le tableau de bord d'OCTOBRE, jamais septembre.

**8. Activation du module GL en concurrence pouvait dupliquer des écritures** — `backfillOne`
(`glActivationService.js`) vérifiait l'absence d'écriture (SELECT) AVANT `conn.beginTransaction()`, sans
aucun verrou, et `gl_entries` n'avait qu'un INDEX (pas une contrainte) sur `(tenant_id, source_table,
source_id)` : deux activations lancées en concurrence pour le même tenant (double-clic, requête relancée)
pouvaient toutes deux passer cette vérification avant que l'une ne commite, puis insérer chacune sa propre
écriture pour la même opération réelle. Corrigé par une contrainte UNIQUE au niveau base de données
(migration 077, `uq_gl_entries_active_source`) sur une colonne générée qui exclut volontairement une
écriture `extournee` (réversée) de l'unicité — sans cette exclusion, le mécanisme NORMAL d'extourne
(`glReversalService.js`, qui réutilise intentionnellement le même `source_id` pour l'écriture de
remplacement) aurait lui-même été bloqué à tort. `backfillOne` traite désormais un conflit `ER_DUP_ENTRY`
comme « déjà fait » (skipped), jamais une erreur. **Bug annexe trouvé et corrigé en implémentant ce
correctif** : `extourneEcriture` ne marquait l'écriture d'origine `'extournee'` qu'APRÈS avoir inséré
l'écriture miroir — les deux se retrouvaient donc brièvement actives en même temps sur le même
`(source_table, source_id)`, ce qui aurait fait échouer TOUTE extourne portant sur une opération avec
source (pas seulement la course visée). Réordonné : l'original est marqué `'extournee'` D'ABORD (son
propre `affectedRows` sert de filet de sécurité contre une double extourne concurrente, comme avant),
PUIS l'écriture miroir est insérée, PUIS `reversed_by_entry_id` est renseigné séparément. Nouveau test de
VRAIE concurrence (`Promise.all` sur deux `backfillHistoricalEntries` simultanés, deux connexions MySQL
distinctes) dans `activation.test.js`. 2 données de test orphelines trouvées sur le tenant 1594 pendant
l'investigation (artefacts d'une précédente vérification manuelle de cette même étape, avant le correctif
Haute #6) et nettoyées avant d'appliquer la contrainte.

**Vérifié (Haute 1-8, TOUS traités)** : suite backend **292/292** (286 tests de cette étape 51 +
1 regression fix sur `glReversalService.js` + 5 tests restant en échec, SANS LIEN avec cette étape — voir
note ci-dessous). Non commité.

**Note sans rapport avec cette étape** : 5 tests pré-existants (`test/assistant.test.js`,
`test/assistantTools.test.js`, `test/gl/rentPaymentCancellation.test.js`) ont commencé à échouer en cours
de session, non pas à cause d'un correctif ci-dessus, mais parce que le calendrier réel est passé du
2026-09-30 au 2026-10-01 PENDANT cette session — ces tests fixent un bail censé « déjà en retard » par
rapport à une date relative au jour réel de l'exécution, et le passage au mois suivant a changé ce calcul.
Confirmé en isolant chaque fichier : aucun ne touche `gl_entries`/la comptabilité, ce sont des fixtures de
`listPortfolioArrears` sensibles au calendrier réel, une fragilité préexistante sans rapport avec l'audit
comptable. Hors scope de cette étape (pas un des 18 constats) — non corrigé.

## Étape 51bis — relance de l'audit comptable, demande explicite (« quels sont les erreurs qu'on n'a pas encore corrigés »)

Les 5 constats « Moyenne sévérité » de l'étape 51 n'avaient jamais été détaillés par écrit (seul leur
nombre conservé). Sur demande de l'utilisateur, un audit ciblé en 4 agents parallèles (loyers/commissions/
séquestre, charges SONEB/SBEE, module GL SYSCOHADA, dépenses/immobilisations/cautions — chacun briefé sur
les 13 correctifs déjà faits pour ne jamais les re-signaler) a identifié **8 constats Moyenne et 7 Basse**
sévérité, traités un par un sur décision explicite de l'utilisateur (« on traite tout mais un à un »).

**1. Réattribuer le propriétaire d'un Bien réécrivait silencieusement tout son historique financier** —
`PATCH /api/properties/:id` changeait `owner_id` sans aucune trace, et TOUTE la comptabilité
(`getEscrowBalances`, `getRecetteProprietaire`/`getRecetteNetteMaison`, `getCabinetRevenue`) résolvait
systématiquement le propriétaire à partir de `properties.owner_id` ACTUEL — jamais celui en vigueur au
moment de chaque paiement/dépense. Réattribuer un Bien réécrivait donc tout son historique de loyers/
dépenses à l'ancien ou au nouveau propriétaire, pouvant rendre un solde séquestre négatif sans raison.

Corrigé par une nouvelle table `property_owner_history` (migration 078 — même principe que
`owner_commission_rates` : `starts_on`/`ends_on`, jamais écrasée, seulement clôturée), backfillée pour
tous les Biens existants (une période ouverte par Bien, démarrant à sa création — comportement inchangé
pour toute entreprise qui n'a jamais réattribué, l'écrasante majorité). `properties.owner_id` reste le
propriétaire ACTUEL (dénormalisé, utilisé partout où seul « aujourd'hui » compte — fiche Bien, portée
agent, etc.) ; seules les fonctions qui attribuent de l'ARGENT résolvent désormais le propriétaire EN
VIGUEUR à la date réelle de l'événement, via un nouveau `resolveOwnerAtDate`/des `LEFT JOIN
property_owner_history` avec repli sur `properties.owner_id` si aucune période ne couvre la date (un
paiement antidaté à avant la création du Bien — trouvé en vérifiant ce correctif en direct — ne doit
jamais disparaître silencieusement du total, l'ancien comportement imprécis étant préférable à une perte
d'argent dans l'agrégat).

`POST /api/properties` (création) ouvre désormais la première période ; `PATCH /api/properties/:id`,
quand `ownerId` change réellement, clôture la période en vigueur et en ouvre une nouvelle à la date du
jour dans la MÊME transaction (`FOR UPDATE` contre une double réattribution concurrente) — tout ce qui a
déjà été réellement perçu/dépensé reste attribué à l'ANCIEN propriétaire, seul l'avenir appartient au
nouveau. 2 nouveaux tests dans `commission.test.js` (réattribution en cours de mandat : janvier reste à
A, février va à B, taux de commission différents respectés chacun ; paiement antidaté : repli sur le
propriétaire actuel, jamais perdu). **Vérifié en direct** (tenant 1594) : Bien créé → propriétaire A,
réattribué à B via l'API réelle → `property_owner_history` montre bien 2 périodes (A clôturée le jour
même, B ouverte), `properties.owner_id` à jour ; données de test nettoyées.

**Vérifié** : suite backend **294/294** (289 passent + les 5 échecs calendaires déjà documentés, sans
rapport). Non commité.

**2. Le tableau de bord comptable ignorait les charges SONEB/SBEE partiellement payées** —
`computeAccountingDashboard` (routes/accounting.js, réutilisé par l'écran, le rapport PDF ET l'assistant
IA) filtrait `status = 'impayee'` seul, ignorant `status = 'partiellement_payee'` — une facture réglée à
moitié disparaissait ENTIÈREMENT du total "impayés", contrairement à `GET /api/charges/month-summary`
(déjà correct). Corrigé en reprenant exactement le même calcul : `status <> 'payee'` et le RESTE DÛ
(`amount - payé`), jamais le montant facturé en entier. Nouveau fichier `test/accountingDashboard.test.js`
(1 test). **Vérifié en direct** (tenant 1594) : facture de 10 000 FCFA réglée à 3 000 → le tableau de bord
affiche désormais +7 000 FCFA (le reste dû), jamais 0 ni 10 000 ; donnée nettoyée.

**Vérifié** : suite backend **295/295** (290 passent + les 5 échecs calendaires sans rapport).

**3. Création concurrente d'un tiers comptable pouvait faire échouer un paiement valide** —
`getOrCreateThirdParty` (services/gl/glThirdPartyService.js) faisait un SELECT puis un INSERT sans aucun
verrou — deux opérations concernant le MÊME tiers jamais encore vu en comptabilité (ex. deux loyers du
même locataire enregistrés au même instant) pouvaient toutes deux passer le SELECT avant que l'une des
deux ne commite, et la contrainte UNIQUE `uq_gl_third_parties_source` (migration 046, déjà existante)
faisait alors échouer la SECONDE transaction en bloc — un paiement par ailleurs valide perdu dans une 500.
Corrigé en rattrapant `ER_DUP_ENTRY` à l'INSERT et en re-sélectionnant la ligne gagnante, même principe
déjà appliqué à `gl_entries` (étape 51, Haute #8). Nouveau fichier `test/gl/thirdParty.test.js` (2 tests,
dont une VRAIE concurrence via deux connexions MySQL distinctes et `Promise.all`).

**Vérifié** : suite backend **297/297** (292 passent + les 5 échecs calendaires sans rapport).

**4. Les écritures manuelles et l'extourne ignoraient le verrou de clôture de mois** —
`POST /api/gl/entries/manual` et `POST /api/gl/entries/:id/extourne` (routes/gl/glEntries.js) ne vérifiaient
jamais `assertPeriodOpen`/`assertPeriodOpenLocked`, contrairement à TOUTES les autres routes qui postent
des écritures (loyers, charges, dépenses, versements, IRF, KKiaPay — Haute #4). Un comptable pouvait saisir
ou extourner une écriture datée dans un mois déjà clôturé, violant silencieusement l'invariant « aucune
écriture financière ne peut plus y être ajoutée » et faussant un mois censé être figé. Corrigé avec le même
schéma partout ailleurs (check avant `beginTransaction()`, re-check sous verrou dans la transaction) ;
pour l'extourne, c'est la date de L'ÉCRITURE MIROIR qui est vérifiée (pas celle de l'originale — voir
`glReversalService.js`, l'extourne peut légitimement tomber dans un exercice différent). **Vérifié en
direct** (tenant 1594) : mois d'octobre clôturé temporairement → saisie manuelle ET extourne toutes deux
rejetées (403) ; mois rouvert → les deux réussissent normalement ; données de test nettoyées.

**5. Supprimer une dépense déjà comptabilisée ne contre-passait jamais son écriture GL** —
`DELETE /api/accounting/expenses/:id` soft-supprimait la dépense sans jamais chercher ni extourner son
écriture GL — la dépense disparaissait du tableau de bord simple (filtré sur `deleted_at`), mais restait
indéfiniment dans le bilan/compte de résultat SYSCOHADA, une divergence permanente entre les deux vues.
Corrigé avec le même précédent que l'annulation d'un paiement de loyer
(`DELETE /:leaseId/payments/:paymentId`, routes/leases.js) : extourne, datée du jour de la suppression,
TOUTES les écritures `validee` trouvées pour `source_table IN ('expenses', 'expense_settlements')` — une
dépense « à crédit » déjà réglée (Haute #6) voit donc son ENGAGEMENT et son RÈGLEMENT tous deux
contre-passés, pas seulement l'un des deux. **Vérifié en direct** (tenant 1594) : dépense payée simple
supprimée → son écriture passe à `extournee` avec une écriture miroir ; dépense à crédit réglée puis
supprimée → les DEUX écritures (engagement + règlement) correctement extournées chacune avec son miroir ;
données de test nettoyées.

**6. Dépassement de la caution peinture perdu si on rouvre un PV de sortie pour le corriger** —
`checkAdditionalDepositRefunds` (services/leaseDeposits.js) ne regarde que les cautions encore `held` pour
calculer `peintureOverflow` (dépassement de la retenue peinture au-delà de SA PROPRE caution, ajouté aux
retenues de la caution de LOYER) — sur une CORRECTION (réouverture d'un PV déjà finalisé pour corriger un
détail SANS RAPPORT), la caution peinture est déjà `returned` depuis la première finalisation
(`finalizeAdditionalDeposits` n'est jamais rejouée sur correction), donc le recalcul retombait TOUJOURS à
0 — un dépassement légitimement facturé la première fois disparaissait silencieusement, rendant le
remboursement recalculé trop généreux. Corrigé par une nouvelle colonne
`move_out_reports.peinture_overflow_amount` (migration 079) : persistée à CHAQUE finalisation, mais sur une
correction, relue (jamais recalculée) au lieu d'appeler `checkAdditionalDepositRefunds`. **Vérifié en
direct de bout en bout** (tenant 1594, lease jetable 6445) : caution peinture 3000, retenue saisie 5000 →
1ʳᵉ finalisation : `totalDeductions=2000` (le dépassement), `netRefund=48000`, persisté correctement ;
réouverture pour corriger un montant SANS RAPPORT (+500 FCFA « autres retenues ») → re-finalisation :
`totalDeductions=2500` (500 + les 2000 de dépassement PRÉSERVÉS), `netRefund=47500` — AVANT le correctif,
cela aurait donné `totalDeductions=500`/`netRefund=49500`, 2000 FCFA remboursés en trop au locataire.
Données de test (bail, PV, GL, fichiers de signature) entièrement nettoyées.

**7. Une retenue peinture saisie sans caution peinture sur le bail n'avait aucun effet réel** —
`checkAdditionalDepositRefunds`/`finalizeAdditionalDeposits` ignorent silencieusement tout type de caution
sans ligne `held` correspondante — un agent pouvait saisir `peintureDeductionAmount` sur un bail SANS
caution peinture (le PV l'affiche comme une retenue bien réelle), mais ce montant n'entrait jamais dans
`totalDeductions`/`netRefund` ni dans aucune écriture GL : une retenue fantôme sur un document officiel.
Corrigé en bloquant (400) dès la saisie (`PATCH /:leaseId/move-out-report`) si `peintureDeductionAmount > 0`
sans caution peinture `held` sur ce bail. **Vérifié en direct** (tenant 1594, bail jetable 6572, aucune
caution peinture) : tentative de saisie → 400 explicite ; saisie sans peinture → 200 normal ; données
nettoyées.

**8. L'alerte prédictive de retard confondait versements partiels et mois distincts** —
`listPredictiveLateAlerts` (services/rentTracking.js) comptait les 3 derniers VERSEMENTS bruts, jamais les
3 derniers MOIS COUVERTS distincts — `allocateRentPayment` autorise pourtant plusieurs versements pour le
même mois (règlement partiel puis complément plus tard). Un seul mois réglé en deux fois comptait donc à
tort pour 2 « retards » distincts, déclenchant une fausse alerte de « retard récurrent » sur la base d'un
SEUL évènement réel. Corrigé en extrayant une nouvelle fonction PURE `recentMonthlyLateCount` (agrège
d'abord par `coversMonth`, retient la date du DERNIER versement qui a soldé chaque mois pour juger du
retard) — testée par 3 nouveaux tests déterministes dans `rentTracking.test.js` (aucune dépendance à la
date réelle, contrairement à la fonction appelante elle-même, qui ne peut pas être testée de façon fiable
pour cette raison précise — voir la note sur les 5 échecs calendaires plus haut). Route
`GET /api/accounting/predictive-alerts` testée en direct (tenant 1594) : répond normalement, sans erreur.

**LES 8 CONSTATS « MOYENNE SÉVÉRITÉ » SONT TOUS TRAITÉS.**

### Les 7 constats « Basse sévérité »

**1. Numérotation des quittances par `COUNT(*)` non verrouillé** — `nextReceiptNumber`
(routes/leases.js) pouvait calculer le même numéro pour deux paiements de BAUX DIFFÉRENTS enregistrés au
même instant (le verrou posé sur le bail ne sérialise que les paiements d'un MÊME bail), faisant échouer
le second sur la contrainte UNIQUE `uq_receipts_number`. Corrigé par un nouveau `insertReceiptForPayment`
qui retente avec le numéro suivant sur `ER_DUP_ENTRY` au lieu de laisser l'erreur remonter — même
philosophie que les autres garde-fous de concurrence de cette étape. Testé par VRAIE concurrence (2
connexions MySQL, `Promise.all`, deux baux distincts). Vérifié en direct : un paiement normal continue de
générer sa quittance normalement.

**Vérifié** : suite backend **301/301** (296 passent + les 5 échecs calendaires sans rapport).

**2. Arrondi de répartition des pertes SONEB/SBEE laissant un résidu non distribué** —
`POST /api/utility-batches/:id/validate` (routes/utilityReadings.js) arrondissait chaque part de l'écart
compteur principal/décompteurs INDÉPENDAMMENT — leur somme ne retombait pas forcément exactement sur
l'écart total (quelques FCFA perdus), laissant filer un résidu au propriétaire même quand la politique
'prorata' voulait que 100 % de l'écart retombe sur les locataires. Corrigé en extrayant une fonction PURE
`distributeLossShares` (imputant le résidu d'arrondi à la plus grosse ligne facturable), testée par 3
nouveaux tests déterministes dans `test/lossShareDistribution.test.js`.

**Vérifié** : suite backend **304/304** (299 passent + les 5 échecs calendaires sans rapport).

**3. Une charge supprimée restait visible « fantôme » sur l'écran du relevé de compteurs** —
`loadRows` (routes/utilityReadings.js) joint `utility_charges` SANS filtrer `deleted_at IS NULL`,
contrairement à toutes les autres vues (registre, point des charges, carnet propriétaire) — supprimer une
facture générée par un relevé la laissait affichée comme « impayée » sur l'écran du relevé, alors qu'elle
avait disparu partout ailleurs. Corrigé en filtrant la jointure et en distinguant `live_charge_id`
(jointure filtrée) de la colonne brute `charge_id` (jamais effacée par la suppression logique). **Vérifié
en direct** (tenant 1594, relevé jetable sur le bien AUD-002) : 3 charges générées à la validation, une
supprimée → l'écran du relevé montre immédiatement `charge: null` pour cette unité, les deux autres
restent affichées normalement ; données nettoyées.

**4. Numérotation des écritures GL potentiellement non-chronologique après suspension/réactivation —
EXAMINÉ, AUCUN CORRECTIF NÉCESSAIRE.** L'audit signalait qu'une écriture rétroactive découverte au
rattrapage (après une réactivation) peut recevoir un numéro plus élevé qu'une écriture déjà postée datée
plus tard. Après examen : `gl_entry_number_counters` a pour exigence documentée d'être continue et SANS
TROU (obligation comptable réelle), pas nécessairement chronologique terme à terme. Le scénario décrit
correspond exactement à la pratique comptable réelle (une écriture de régularisation découverte
tardivement prend le numéro du jour, jamais insérée rétroactivement dans la séquence déjà émise) —
renuméroter des écritures déjà attribuées pour « corriger » ce cas violerait une règle plus importante
encore (un numéro de pièce comptable émis ne doit jamais être réutilisé ni déplacé). Aucun changement de
code : comportement jugé correct, pas un bug.

**5. Nom d'un tiers comptable jamais mis à jour après un renommage** — `getOrCreateThirdParty`
(glThirdPartyService.js) n'écrivait `display_name` qu'à la CRÉATION de la ligne auxiliaire — un locataire/
propriétaire/fournisseur renommé ensuite (pas supprimé, juste renommé) gardait indéfiniment son ANCIEN nom
sur tous les rapports comptables (grand livre auxiliaire, détail d'écriture). Corrigé : rafraîchi à chaque
appel si le nom a changé. Testé (persistance en base vérifiée, pas seulement la valeur de retour).

**Vérifié** : suite backend **305/305** (300 passent + les 5 échecs calendaires sans rapport).

**6. Aucune validation de cohérence des dates pour l'amortissement/la sortie d'immobilisation** —
`POST /fixed-assets/:id/depreciate` et `/dispose` n'empêchaient ni un amortissement daté AVANT
l'acquisition, ni une sortie antérieure à l'acquisition ou à un amortissement déjà enregistré pour un mois
plus tardif. Corrigé par 3 nouvelles validations (400 explicite dans chaque cas).

**🔴 Bug plus sérieux trouvé EN vérifiant ce point en direct** : la sortie d'immobilisation
(`POST /fixed-assets/:id/dispose`) postait son écriture GL avec `sourceTable: 'fixed_assets'` — EXACTEMENT
le même `(source_table, source_id)` que l'écriture d'ACQUISITION, qui reste `validee` indéfiniment (la
sortie ne la réverse jamais, c'est un évènement qui s'AJOUTE). Depuis l'ajout de la contrainte UNIQUE
`uq_gl_entries_active_source` (migration 077, Haute #8, plus tôt dans cette même étape), **TOUTE sortie
d'immobilisation échouait en 500** (`ER_DUP_ENTRY`) pour n'importe quelle entreprise ayant le module GL
actif — régression bloquante à 100 %, jamais détectée car la fonctionnalité de sortie (Critique #4) n'a
jamais été retestée après l'ajout de la contrainte. Corrigé en alignant sur la convention déjà établie
pour ce même cas de figure (`expense_settlements`, `lease_deposits_return`...) : nouveau label
`sourceTable: 'fixed_asset_disposals'`, distinct de l'acquisition.

**Vérifié en direct, bout en bout** (tenant 1594, 2 immobilisations jetables) : amortissement avant
acquisition → 400 ; sortie avant acquisition → 400 ; sortie avant un amortissement déjà enregistré pour un
mois postérieur → 400 (testé isolément sur une 2ᵉ immobilisation) ; sortie à une date valide → échouait en
500 AVANT le correctif `sourceTable`, réussit normalement APRÈS (acquisition ET sortie coexistent
désormais comme deux écritures `validee` distinctes, vérifié en base) ; données nettoyées.

**7. Le total dû à un fournisseur ignorait les immobilisations à crédit** —
`GET /api/accounting/suppliers` ne sommait que `expenses.payment_status='unpaid'`, jamais les
immobilisations achetées « à crédit » (même flux `supplier_id`) — un fournisseur UNIQUEMENT lié à une
immobilisation impayée affichait `totalOwed: 0`. Corrigé par deux sous-requêtes corrélées (jamais un
second `LEFT JOIN` direct, qui aurait multiplié dépenses × immobilisations du même fournisseur et faussé
la somme). **Vérifié en direct** (tenant 1594) : fournisseur jetable avec UNIQUEMENT une immobilisation
impayée (45 000 FCFA) → `totalOwed: 45000` (était 0 avant) ; ajout d'une dépense impayée du même
fournisseur (7 000 FCFA) → `totalOwed: 52000` (somme correcte, pas de doublon) ; données nettoyées.

**LES 15 CONSTATS DE L'ÉTAPE 51BIS SONT TOUS TRAITÉS** (7 Basse corrigées, 1 examinée et jugée non-bug).
Suite backend finale : **305/305** (300 passent + les 5 échecs calendaires préexistants, sans rapport).
