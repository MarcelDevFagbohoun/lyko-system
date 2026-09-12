# Test d'intrusion — Lyko System (étape 12, audit sécurité)

**Date** : 2026-09-10 · **Cible** : API locale `http://localhost:4000` (`NODE_ENV=development`)
**Méthode** : boîte grise (code lu au préalable), harnais automatisé `backend/scripts/pentest.js`
— cabinets jetables uniquement, supprimés en fin de passe (données réelles jamais touchées).

**Résultat initial** : 167 contrôles OK · 2 FAIL · 4 WARN → 6 trouvailles (1 moyenne, 5 faibles).
**Après corrections** : **172 contrôles OK · 0 FAIL · 1 WARN** (le WARN restant = trouvaille #6,
acceptée et documentée). Voir « Corrections appliquées » en bas.

---

## Posture confirmée solide (167 contrôles)

| Domaine | Vérifications passées |
|---|---|
| **Isolation multi-tenant** | 35+ tentatives IDOR (lire / modifier / supprimer les ressources d'un autre cabinet sur **tous** les modules : locataires, baux, paiements, quittances PDF, biens, unités, propriétaires, versements, plaintes, dépenses, charges, employés) → **404 systématique**. Création croisée (louer l'unité d'un autre tenant, rattacher un bien à son propriétaire) → refusée. Listes → aucune donnée d'un autre cabinet. |
| **Authentification** | Accès sans token → 401 partout. JWT `alg:none`, signature retirée, signature altérée, payload modifié non re-signé, signé avec le secret *refresh*, expiré, mauvais `issuer` → **tous 401**. |
| **Autorisation** | `agent` → 403 sur employés / paramètres / tableau de bord / comptabilité / clôtures. `comptable` → 403 sur création locataires / biens / propriétaires (paiements & versements OK). `agent` sans permission → 403 sur tous les modules à permission dédiée. |
| **Injection SQL** | `' OR '1'='1`, `UNION SELECT`, `';--`, backslash, hex… sur tous les `?q=` (biens, propriétaires, plaintes, locataires) et `:id` exotiques → **aucune 500, aucune fuite, aucun résultat anormal**. Requêtes 100 % paramétrées confirmées. |
| **Traversée de chemin** | `/uploads/../…`, `..%2f`, `%2e%2e`, `....//` → 404, aucun fichier hors `uploads/` exposé. |
| **Prototype pollution** | `__proto__` / `constructor.prototype` dans le corps JSON → `Object.prototype` intact. |
| **DoS applicatif** | Corps > 1 Mo → **413**. JSON profond (20 000 niveaux) → pas de 500. `qs` array-bomb (3 000 clés) et bracket-depth (500) → pas de 500, < 3 s (CVE `qs` neutralisées par l'override 6.16). |
| **CORS** | `Origin: http://evil.example` → **pas** d'`Access-Control-Allow-Origin`. Origine légitime → autorisée. |
| **Rate-limiting** | Brute-force `/login` → **429 dès la 9ᵉ tentative** (ralentisseur par compte + limiteur IP). |
| **Clôture comptable** | Mois clôturé → paiement / dépense / modification / suppression = 403. |
| **En-têtes & fuites** | `x-powered-by` absent ; `nosniff`, `X-Frame-Options: DENY`, HSTS, CSP (API `default-src 'none'`) présents. Erreur JSON malformé → **pas de stack ni de chemin** dans la réponse. |
| **CSRF** | `POST /auth/refresh` sans cookie → 401. Mutations métier via `Authorization: Bearer` (jamais cookie) → non exploitables. Aucune mutation en GET. |

---

## Trouvailles

### 1 — 🟠 Moyenne · Cachet & signature accessibles sans authentification

`/uploads/tenants/<id>/stamp.png` et `signature.png` sont servis par `express.static`
**sans token**, et l'`<id>` de cabinet est un **entier séquentiel** → énumération triviale
(`/uploads/tenants/1/…`, `/2/…`, …). Ces images sont apposées sur les **attestations de
loyer et quittances officielles** : leur récupération par un tiers permet de forger des
documents au nom du cabinet. Les logos passent par le même mécanisme (moins sensibles).

**Recommandation** — au choix, par robustesse décroissante :
1. Servir cachet/signature (idéalement tout `/uploads`) via une **route authentifiée**
   qui vérifie `req.user.tenantId` contre le chemin.
2. Nommer les fichiers de façon **aléatoire** (UUID en base) au lieu de `stamp.<ext>` sous
   `tenants/<id-séquentiel>/`.

La génération PDF lit ces fichiers **sur disque** (`fs`), pas via HTTP → aucun impact.

### 2 — 🟡 Faible-moyenne · Doublons de paiement de loyer en concurrence

6 `POST /api/leases/:id/payments` identiques simultanés → **1 à 2 acceptés** (non
déterministe). Aucune contrainte d'unicité `(lease_id, covers_month)`, aucun verrou.
Conséquence : quittances en double (`QT-2026-0001`, `QT-2026-0002` pour le même loyer),
total « encaissé » gonflé, dérive comptable.

**Recommandation** : migration ajoutant `UNIQUE KEY (tenant_id, lease_id, covers_month)` sur
`rent_payments` + capture de l'erreur de doublon → `409`. **À confirmer d'abord** : les
paiements partiels (2 versements le même mois) sont-ils un cas métier légitime ? Si oui,
verrou applicatif (`SELECT … FOR UPDATE` sur le bail) plutôt qu'unicité stricte.

### 3 — 🟡 Faible-moyenne · Pas de borne supérieure sur les montants → 500

`amount: "1e12"` ou `"9".repeat(20)` passe la validation
(`z.coerce.number().int().nonnegative()`) puis **casse à l'INSERT MySQL**
(`Out of range value for column 'amount'`) → **500** au lieu d'un `400` propre. Concerne
paiements, versements propriétaires, dépenses, charges, caution, retenues de sortie.

**Recommandation** : ajouter `.max(1_000_000_000, 'Montant trop élevé')` aux schémas de
montant partagés (`validators/renters.js`, `owners.js`, `expenses.js`, `charges.js`).

### 4 — 🟢 Faible · Validation d'upload basée sur le Content-Type déclaré

multer ne vérifie que le `Content-Type` **fourni par le client**. Un fichier texte annoncé
`image/png` est accepté et stocké en `stamp.png` / `logo.png`. Servi avec `nosniff` → non
exécutable ; SVG déjà rejeté (hors allowlist) → **pas de XSS stocké**. Impact réel :
stockage de contenu arbitraire / image cassée à l'affichage.

**Recommandation** : contrôler les **octets magiques** après réception (PNG `89 50 4E 47`,
JPEG `FF D8 FF`, WEBP `RIFF…WEBP`), rejeter si incohérent. Concerne `auth.js` (logo),
`settings.js` (cachet/signature), `properties.js` / `complaints.js` / `accounting.js`
(photos / justificatifs).

### 5 — 🟢 Faible · `jwt.verify` sans allowlist `algorithms`

Un token signé en **HS512** (au lieu de HS256) est accepté. Impact pratique **nul** : secret
symétrique (HS256/384/512 partagent le même secret, l'attaquant ne l'a pas), et
jsonwebtoken v9 refuse déjà `none` et la confusion RS→HS avec une clé de type chaîne. Reste
une non-conformité aux bonnes pratiques.

**Recommandation** : `algorithms: ['HS256']` dans `verifyAccessToken` et
`verifyRefreshToken` (`utils/jwt.js`).

### 6 — 🟢 Faible (accepté) · Fenêtre ≤ 15 min après désactivation d'un employé

À la désactivation, les refresh tokens sont **révoqués immédiatement**, mais l'access token
en cours reste valide jusqu'à expiration (≤ 15 min).

**Recommandation** : documenter comme risque accepté (fenêtre courte), **ou** vérifier
`status` / un `tokenVersion` dans `requireAuth` pour les routes sensibles, **ou** un petit
denylist en mémoire alimenté à la désactivation.

---

## Corrections appliquées (étape 12a)

| # | Correction | Fichiers |
|---|---|---|
| **1** | **Noms de fichiers aléatoires** pour tous les téléversements (`randomFileName`, `utils/uploads.js`) : `logo-<20 hex>.png`, `stamp-…`, `signature-…`, photos, justificatifs. Le chemin prévisible `/uploads/tenants/<id>/stamp.png` renvoie désormais 404 → énumération impossible. L'ancien fichier est supprimé au remplacement du cachet/de la signature. *(Modèle « URL non devinable » : le fichier reste lisible pour qui possède l'URL exacte, révélée seulement par l'API authentifiée du cabinet — équivalent d'un objet S3 privé partagé par lien. Une route 100 % authentifiée reste possible en évolution.)* | `utils/uploads.js`, `routes/auth.js`, `routes/settings.js`, `routes/properties.js`, `routes/complaints.js`, `routes/accounting.js` |
| **2** | Enregistrement d'un paiement : `SELECT … FOR UPDATE` sur le bail (sérialise les requêtes concurrentes) + **garde anti-doublon** (paiement identique mois/montant/date < 2 min → `409`). Les **versements partiels** (montants ou dates différents) restent permis. Double-soumission de 6 requêtes identiques → 1 acceptée, 5 × 409. | `routes/leases.js` |
| **3** | Borne haute sur tous les schémas de montant (`.max(1e9)` pour l'argent, index compteur `≤ 9 999 999`, prix unitaire `≤ 9 999`). `amount: "1e12"` → **400 propre** au lieu de 500. | `validators/renters.js`, `owners.js`, `expenses.js`, `charges.js` |
| **4** | Contrôle des **octets magiques** après réception (`assertUploadType`, `utils/uploads.js`) : PNG / JPEG / WEBP (+ PDF pour les justificatifs de dépense). Un fichier texte annoncé `image/png` est désormais rejeté (400). | `utils/uploads.js` + les 5 routes d'upload |
| **5** | `jwt.verify` : `algorithms: ['HS256']` explicite. Un token HS512 est rejeté. | `utils/jwt.js` |
| **6** | *(Accepté, non corrigé)* Fenêtre ≤ 15 min après désactivation d'un employé. Documenté ici comme risque assumé : le refresh est révoqué immédiatement, l'access token expire en ≤ 15 min. Renforcement possible (contrôle `status` dans `requireAuth`) si le modèle de menace l'exige. | — |

## Rejouer le test

```bash
cd backend                 # pour la résolution des modules (mysql2, jsonwebtoken)
node /chemin/vers/pentest.js
```

- Ne pas relancer plus de ~2 fois par heure : le limiteur `/register` (10/h par IP) bloque
  la création des cabinets jetables. Un redémarrage du backend (nodemon) réinitialise le
  compteur (état en mémoire).
- En cas d'interruption, un nettoyage de secours supprime les cabinets `PENTEST-%`.
