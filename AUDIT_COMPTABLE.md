# Audit comptable — Lyko System (comptabilité simple & comptabilité avancée SYSCOHADA)

**Date :** 2026-09-23
**Auditeur :** Claude (assistant IA), aucune validation par un expert-comptable humain
**Périmètre :** code source du dépôt tel qu'il se trouve sur la branche `audit-comptable` (créée à partir de `main`, dernier commit `d01807e`)
**Environnement de test :** base de données locale de développement, **entreprise jetable dédiée `Audit Comptable Test` (tenant id 1594)** créée pour cet audit — **KIko Store (tenant id 8, seule entreprise réelle) n'a reçu aucune écriture de test**, conformément à la règle de sécurité.

**Mise à jour du 23/09/2026 — Étape 6 (corrections)** : après validation par l'utilisateur, les anomalies **A1, A2, A3, B1, B4** ont été corrigées sur la branche `audit-comptable`, un commit par anomalie, chacun avec un test qui prouve la correction (voir le détail de chaque anomalie ci-dessous). **B2 et B3 restent des points de méthode comptable à faire trancher par un expert-comptable, volontairement non codés.** Suite complète relancée après corrections : **130/130 tests backend**, `tsc`/`eslint` frontend propres.

**Important — limites de cet audit :** je ne suis pas un expert-comptable et ne peux pas certifier la conformité SYSCOHADA du plan comptable. Chaque fois qu'une règle comptable métier n'était pas déjà explicitement tranchée dans le code (souvent annotée `À VALIDER` par les développeurs eux-mêmes), je le signale comme point à faire valider plutôt que de trancher moi-même. Cet audit n'est pas exhaustif : le système compte plusieurs dizaines d'écrans ; j'ai testé en profondeur le cœur du cycle locatif (loyers, charges, dépenses, caution, dette initiale, frais d'agence, pénalités, reversements, immobilisations, clôtures, extournes) via l'API réelle, avec des valeurs calculées à la main et comparées au résultat produit. Je n'ai pas testé : KKiaPay (paiement en ligne), le portail locataire/propriétaire, la messagerie WhatsApp, les rapports PDF/Excel export (au-delà de vérifier qu'ils existent), ni les permissions par rôle en détail.

---

## Étape 1 — Comment fonctionnent les deux modes

### Comment le mode est choisi
- Stocké sur `tenants.gl_module_enabled` (0/1), **par entreprise**, jamais par utilisateur ni par abonnement.
- Activé/désactivé exclusivement par le DG, depuis **Paramètres** (`backend/src/routes/gl/glActivation.js`, `POST /api/gl/activation`).
- **La comptabilité simple n'est jamais optionnelle** — elle fonctionne toujours, pour toutes les entreprises. La comptabilité avancée (SYSCOHADA) est une couche **additive** optionnelle, jamais un remplacement.

### Ce que fait chacun des deux modes

| | Comptabilité SIMPLE | Comptabilité AVANCÉE (SYSCOHADA) |
|---|---|---|
| Principe | Lecture **recalculée à la volée** à partir des tables métier existantes (`rent_payments`, `expenses`, `utility_payments`, `owner_payouts`, `leases.opening_debt_amount`, `leases.entry_fee_amount`, `late_fees`…) | Partie double classique : chaque opération métier génère une **écriture immuable** (`gl_entries`/`gl_entry_lines`) au moment où elle se produit |
| Tables propres | Aucune table comptable dédiée — tout est déduit des tables métier | `gl_accounts`, `gl_journals`, `gl_posting_rules`(+lignes), `gl_entries`(+lignes), `gl_fiscal_years`, `gl_third_parties` |
| Écrans | Tableau de bord Comptabilité, fiche propriétaire (recette/commission/séquestre), Relances (impayés) | Comptabilité avancée : journaux, grand livre, balance, extournes, immobilisations, IRF, rapprochement bancaire, états financiers |
| Calculs | Recette nette, commission, part propriétaire, arriérés (`services/commission.js`, `services/rentTracking.js`) | Résolution dynamique compte/montant par règle (`gl_posting_rules`), moteur `genererEcriture()` (`services/gl/glPostingService.js`) |

### Ce qui est commun aux deux
Les **mêmes routes métier** (`routes/leases.js`, `routes/charges.js`, `routes/owners.js`, `routes/renters.js`, `routes/accounting.js`) sont le point d'entrée unique. Chaque route qui enregistre une opération financière appelle `isModuleActive(conn, tenantId)` juste après l'écriture métier (dans **la même transaction SQL**) ; si vrai, elle appelle en plus `genererEcriture()`. La comptabilité simple ne dépend donc **jamais** du module avancé — elle lit directement les tables métier, qu'elles aient ou non généré une écriture GL en parallèle.

### Ce qui est propre à chacun
- Simple : commission par propriétaire historisée par date (`owner_commission_rates`), séquestres, arriérés, dette initiale, frais d'agence — aucun équivalent SYSCOHADA formel.
- Avancée : exercices comptables (`gl_fiscal_years`, statut ouvert/clos), extourne, IRF, immobilisations/amortissements, rapprochement bancaire, tiers auxiliaires (`gl_third_parties`).

### Que se passe-t-il en changeant de mode ?
- **Aucune donnée métier n'est jamais convertie ni perdue** — les tables métier (`rent_payments`, etc.) sont indépendantes du statut du module.
- **Activation** (`glActivationService.activateModule`) : crée le plan comptable si absent (idempotent), crée les exercices comptables nécessaires, puis **rejoue rétroactivement** toutes les opérations métier déjà enregistrées qui n'ont pas encore d'écriture GL (vérifié une par une via `(source_table, source_id)`, jamais de doublon).
- **Désactivation** (`deactivateModule`) : bascule juste `gl_module_enabled = 0`. Rien n'est supprimé, l'historique GL déjà généré reste consultable.
- **Réactivation** : rejoue le rattrapage pour la période d'inactivité — voir anomalie **B4** ci-dessous pour un cas où ce rattrapage échoue silencieusement.

---

## Étape 2 — Mode SIMPLE : fonctionnalités testées

| Fonctionnalité | Cas testés | Statut |
|---|---|---|
| Paiement de loyer (nominal) | 1 mois plein | ✅ |
| Paiement de loyer (partiel) | 40 000 sur 100 000 | ⚠️ voir **A1** |
| Paiement de loyer (trop-perçu) | 250 000 = mois pleins + reliquat | ✅ (l'algorithme lui-même est correct — voir A1 pour la cause du comportement inattendu observé) |
| Montant zéro | 0 FCFA | ✅ rejeté (400) |
| Double-saisie (même mois/date/mode, <2 min) | resoumission immédiate | ✅ rejeté (409) |
| Annulation d'un paiement de loyer | — | ❌ voir **A3** (fonctionnalité absente) |
| Caution (réception) | 60 000 FCFA, espèces | ✅ |
| Dette initiale à l'entrée (règlement partiel) | 40 000/90 000 | ✅ |
| Dette initiale (sur-règlement) | 60 000 alors que 50 000 restants | ✅ rejeté (400) |
| Frais d'agence à l'entrée | 30 000, mobile money | ✅ |
| Pénalité de retard | 5 000 FCFA | ✅ |
| Charge SONEB/SBEE (calcul par index) | consommation 150 × 100 = 15 000 | ✅ |
| Règlement de charge en plusieurs fois | 5 000 + 10 000 = 15 000 | ✅ statut correctement `payee` |
| Dépense cabinet | 8 000 FCFA | ✅ |
| Dépense rattachée à un Bien | 12 000 FCFA | ✅ |
| Dépense à crédit + règlement ultérieur | 20 000 FCFA | ✅ |
| Double règlement de la même dépense à crédit | — | ✅ rejeté (409) |
| Suppression logique d'une dépense (avec/sans justification) | — | ✅ |
| Recette propriétaire (mois sans loyer réel) | — | ✅ (0 correctement, pas de faux calcul) |
| Reversement propriétaire (nominal) | 60 000 FCFA | ✅ |
| Reversement propriétaire (dépassant largement le solde détenu) | 5 000 000 FCFA | ❌ voir **A2** (aucune garde-fou) |
| Taux de commission historisé + « taux futur affiché comme actif » | — | ✅ (déjà corrigé lors d'une session précédente, revérifié : correct) |

---

## Étape 3 — Mode AVANCÉ : fonctionnalités testées

| Fonctionnalité | Cas testés | Statut |
|---|---|---|
| Équilibre débit=crédit | 18+ écritures, 10 types d'opération | ✅ (garanti structurellement par le moteur, `glPostingService.js:113-118`, testé sans faille) |
| Comptes SYSCOHADA utilisés | 401, 411, 442, 521, 552, 571, 706, 707, 165, 2442/28442, etc. | ✅ pour la grande majorité — voir **B2** et **B3** pour deux points à faire valider |
| Reversement propriétaire avec commission différée + IRF | 100 000 → 10 000 commission + 10 000 IRF + 80 000 net | ✅ arithmétiquement — voir **B3** pour la base de calcul de l'IRF |
| Extourne (contrepassation) | écriture `loyer_encaisse` | ✅ écriture originale jamais modifiée, seulement liée (`reversed_by_entry_id`), extourne exactement inverse (mêmes comptes, mêmes montants, sens inversé), double-extourne rejetée |
| Clôture d'exercice + blocage des écritures postérieures | loyer + immobilisation datés dans l'exercice clos | ✅ rejetés proprement |
| Immobilisation + amortissement linéaire | 600 000 FCFA / 3 ans | ✅ 16 667/mois exact, valeur nette mise à jour, double amortissement du même mois rejeté |
| Balance générale | export trial-balance | ✅ total débit = total crédit |
| Gestion des erreurs métier (règle manquante, exercice manquant, etc.) | — | ❌ voir **B1** (systémique) |
| Réactivation après une période d'inactivité | opération datée dans un exercice depuis clos | ⚠️ voir **B4** |

---

## Étape 4 — Cohérence entre les deux modes

Les deux modes lisent/écrivent des données **dérivées du même événement métier** (même transaction SQL) : par construction, ils ne peuvent normalement pas diverger sur ce qui a réellement été enregistré. Deux vraies exceptions trouvées :

- **Divergence confirmée (liée à B4)** : si le module est désactivé, qu'une opération est enregistrée pendant cette période, puis que l'exercice comptable correspondant est clôturé **avant** la réactivation, la comptabilité simple continue de refléter correctement l'opération (elle ne dépend jamais du module) tandis que la comptabilité avancée **ne la rattrape jamais** — écart permanent entre les deux vues.
- **Défaut partagé (A2)** : l'absence de garde-fou sur les reversements affecte les deux modes de façon identique et cohérente (le même montant absurde apparaît dans `owner_payouts` ET dans l'écriture GL, parfaitement équilibrée) — ce n'est pas un écart entre modes, mais un défaut commun aux deux.

Changement de mode en cours d'utilisation : testé (désactivation → opération → réactivation) — le rattrapage fonctionne correctement dans le cas général (confirmé : une opération enregistrée pendant l'inactivité est bien reprise à la réactivation), sauf dans le cas de fond d'exercice clos ci-dessus.

---

## Anomalies détaillées

### A1 — Un paiement partiel de loyer efface silencieusement le solde restant du mois — ✅ CORRIGÉ (commit `ce5a78a`)
- **Mode :** simple · **Gravité :** ❌ grave · **Fichier :** `backend/src/services/rentTracking.js:59-61` (`computeArrears`), utilisé par `listPortfolioArrears` et `recordRentPayment` (`backend/src/routes/leases.js`)
- **Explication :** `paidThroughMonth` retient le mois **le plus récent pour lequel au moins une ligne `rent_payments` existe**, sans jamais comparer le montant cumulé de ce mois au loyer dû. Un paiement partiel (`isPartial: true`) est calculé et renvoyé à l'écran au moment de la saisie, mais **jamais stocké** (`rent_payments` n'a pas de colonne `is_partial`) ni réutilisé par le calcul des arriérés.
- **Exemple chiffré (reproduit) :** bail à 100 000 FCFA/mois. Le locataire paie 40 000 pour octobre (partiel, reste dû 60 000). Un paiement suivant, quel qu'il soit, est automatiquement affecté à **novembre**, jamais à la complétion d'octobre — les 60 000 manquants pour octobre ne sont plus jamais comptés dans les impayés, ni dans le module Relances, pour toujours.
- **Impact :** les fonctionnalités « Impayés locataires » (tableau de bord, fiche locataire) et « Relances » **sous-estiment structurellement** la dette réelle dès qu'un paiement partiel a eu lieu. C'est un défaut central puisque le suivi des impayés est une promesse centrale du produit.
- **Correction proposée (à valider) :** soit (a) stocker et faire respecter un solde restant par mois (nouvelle colonne ou table de suivi du cumul par `covers_month`), soit (b) n'avancer `nextDueMonth` que lorsque le cumul des paiements pour ce mois atteint le loyer dû. Impact large : touche `computeArrears`, `allocateRentPayment`, `listPortfolioArrears`, potentiellement l'affichage du reçu.

### A2 — Un reversement à un propriétaire peut dépasser sans limite ce que le cabinet détient réellement pour lui — ✅ CORRIGÉ (commit `befcb33`)
- **Mode :** simple ET avancé (défaut partagé) · **Gravité :** ❌ grave · **Fichier :** `backend/src/routes/owners.js:362` (`POST /:id/payouts`)
- **Explication :** la route valide uniquement le format du montant (`createPayoutSchema` : entier positif, plafond haut) — **aucune comparaison** avec `getEscrowBalances()` (qui est pourtant déjà calculé et affiché sur la même fiche propriétaire).
- **Exemple chiffré (reproduit) :** propriétaire B, solde séquestre réel ≈ 0 (aucun loyer réellement encaissé pour ses biens dans le test). Un reversement de **5 000 000 FCFA** a été accepté sans aucune erreur, faisant passer son solde à **-5 072 000 FCFA**. L'écriture GL générée (`reversement_proprietaire`) est parfaitement équilibrée (débit 4671 5 000 000 / crédit 521 5 000 000) — la partie double ne protège en rien contre une opération financièrement absurde.
- **Impact :** une erreur de saisie (ou un usage malveillant) peut faire « sortir » de l'argent que le cabinet n'a jamais réellement collecté, sans aucun signal.
- **Correction proposée (à valider) :** ajouter dans la route un contrôle `amount <= balance` (issu de `getEscrowBalances`) avant l'insertion, avec une erreur 400 explicite ; envisager une confirmation explicite du DG si un dépassement est parfois légitime (avance de trésorerie ?) — **point à discuter avec l'utilisateur avant de coder**, car interdire tout dépassement pourrait bloquer un cas d'usage réel non anticipé (ex. avance sur loyers futurs).

### A3 — Aucune fonctionnalité pour annuler ou corriger un paiement de loyer déjà enregistré — ✅ CORRIGÉ (commit `14d28bf`)
- **Mode :** simple · **Gravité :** ⚠️ significatif · **Fichier :** `backend/src/routes/leases.js` (recherche exhaustive : aucune route `PATCH`/`DELETE` sur `rent_payments`, contrairement à `expenses` qui a une suppression logique avec justification)
- **Explication :** une fois un paiement de loyer inséré, il n'existe **aucun chemin applicatif** pour le corriger (mauvais montant, mauvaise date, mauvais bail) ou l'annuler. Seule une intervention technique directe en base résoudrait une erreur de saisie réelle.
- **Impact :** une erreur de saisie sur un loyer (fréquente en usage réel) n'a aucune voie de correction dans l'application, contrairement aux dépenses et aux charges SONEB/SBEE qui, elles, ont une suppression logique tracée.
- **Correction proposée (à valider) :** ajouter une suppression logique symétrique à celle des dépenses (`deleted_at`/`deleted_by`/`deleted_reason`), avec la même vérification `assertPeriodOpen`, et une extourne GL correspondante si une écriture existe déjà. Nécessite une décision produit (qui peut annuler ? dans quelle fenêtre de temps ?) avant de coder.

### B1 — Toute erreur métier du moteur comptable avancé devient une erreur serveur générique, message caché en production — ✅ CORRIGÉ (commit `5f8d781`)
- **Mode :** avancé · **Gravité :** ❌ grave (systémique) · **Fichiers :** `backend/src/services/gl/glPostingService.js`, `glAccountResolver.js`, `glThirdPartyService.js`, `glClosingService.js`, `glReversalService.js` — **au moins 24 sites** utilisant `throw new Error(...)` au lieu de `throw new ApiError(<code>, ...)`
- **Explication :** `backend/src/middleware/error.js:24` : `const status = err.status || ... || 500`. Une `ApiError` porte un `.status` explicite (400/404/409…) ; une simple `Error` n'en a pas → toujours 500. Et ligne 30 : `error: status >= 500 && config.isProd ? 'Erreur interne du serveur' : err.message` — **en production, le message réel est remplacé par un texte générique** dès que le statut est ≥ 500.
- **Exemple concret (reproduit dans ce test)** : tenter un paiement daté dans un mois sans exercice comptable créé renvoie en développement `"Aucun exercice comptable ne couvre la date 2027-01-06 — créez-le depuis Comptabilité avancée."` (message parfaitement actionnable) — **en production, le DG verrait uniquement « Erreur interne du serveur »**, sans aucune indication de ce qu'il faut faire. Même chose pour : règle comptable manquante, compte introuvable, écriture déséquilibrée, exercice déjà clos, écriture déjà extournée, etc.
- **Impact :** dès que survient l'un de ces cas — tous parfaitement anticipables et déjà dotés d'un message clair dans le code — l'utilisateur final est bloqué sans aucune explication, et l'équipe technique reçoit une alerte de niveau « erreur serveur » pour ce qui n'est qu'une validation métier ordinaire.
- **Correction proposée :** remplacer systématiquement `throw new Error(...)` par `throw new ApiError(400, ...)` (ou 409 selon le cas) dans les fichiers listés. Mécanique, sans ambiguïté métier — bon candidat pour l'étape 6.

### B2 — Le compte 411 (Clients) est utilisé pour la part reversée d'une charge SONEB/SBEE, pas seulement pour une créance locataire classique — *à valider par un expert-comptable*
- **Mode :** avancé · **Fichier :** `backend/src/db/seedGeneralLedger.js`, règle `charge_locative_encaissee`
- **Explication :** je ne suis pas certain que réutiliser 411 pour représenter la part d'une charge d'eau/électricité reversée au locataire (plutôt qu'une créance client classique) soit la pratique SYSCOHADA correcte, ou si un autre compte serait plus approprié. Le reste du plan comptable est cohérent avec les usages standards.

### B3 — Base de calcul de l'IRF (impôt sur le revenu foncier) — *à valider*
- **Mode :** avancé · **Fichier :** `backend/src/services/gl/glAccountResolver.js` (`computeReversementDeductions`), déjà annoté `hypothèse #10, À VALIDER` dans le code lui-même
- **Explication :** l'IRF est calculé sur le **montant brut reversé**, indépendamment de la commission déjà déduite (10 % de 100 000 = 10 000 dans mon test, peu importe que la commission ait aussi pris 10 000). Je ne peux pas confirmer si c'est la base légale réelle au Bénin (brut vs. net de commission) sans un expert-comptable.

### B4 — Le rattrapage après réactivation échoue silencieusement (hors un compteur) si l'exercice concerné est déjà clos — ✅ CORRIGÉ (commit `2b43f53`)
- **Mode :** avancé (avec effet croisé sur la cohérence entre modes) · **Gravité :** ⚠️ modéré · **Fichier :** `backend/src/services/gl/glActivationService.js` (`backfillOne`), UI : `frontend/app/espace/parametres/parametres-view.tsx:780-783`
- **Explication :** si le module est désactivé, qu'une opération survient, puis que l'exercice correspondant est clos, la réactivation tente de rattraper cette opération et échoue (`errors` dans la réponse). L'écran affiche bien un compte (« X opération(s) n'ont pas pu être reprises — contactez le support technique ») mais jamais la raison ni une action de récupération.
- **Correction proposée :** afficher la raison de chaque échec (déjà disponible côté API) et/ou fournir un bouton « réessayer après avoir rouvert l'exercice » pour le DG/comptable.

---

## Notes de fiabilité

### Mode simple : **6/10**
Le cœur du cycle (encaissement, allocation multi-mois, caution, dette initiale, frais d'agence, pénalités, charges au relevé, dépenses avec/sans crédit, suppression tracée) est **solide et bien testé** — tous les cas limites que j'ai pu couvrir (montant zéro, double-saisie, sur-règlement, double règlement) se comportent correctement. Mais deux défauts concentrés sont sérieux : le suivi des impayés (A1) sous-estime structurellement la dette réelle dès qu'un paiement partiel survient — c'est une fonctionnalité centrale du produit — et l'absence de garde-fou sur les reversements (A2) est un risque financier réel. L'absence de correction de paiement (A3) est gênante mais plus périphérique.

### Mode avancé : **6.5/10**
Le moteur de partie double est **rigoureux** : équilibre garanti structurellement, extourne correcte et jamais destructive, clôture d'exercice qui bloque vraiment les écritures, amortissements exacts au centime. C'est un travail de qualité. Ce qui abaisse la note : un défaut systémique de gestion des erreurs (B1) qui rendrait le module difficile à utiliser en production dès qu'une situation imprévue (mais anticipée dans le code !) survient — masquant des messages déjà écrits et utiles derrière une erreur générique. Plus deux points de méthode comptable qu'un professionnel doit trancher (B2, B3), et un angle mort de récupération (B4).

---

## Points à faire valider par un expert-comptable
1. Le compte 4671 (« Propriétaires mandants ») pour le mandat de gestion locative — déjà signalé dans le code comme une approximation (SYSCOHADA ne prévoit pas de compte officiel dédié).
2. L'usage du compte 411 pour la part reversée d'une charge SONEB/SBEE (B2).
   *Complément (2026-09-25) :* le reversement au propriétaire des charges encaissées (étape 31) n'est volontairement **pas** comptabilisé automatiquement en comptabilité avancée — le compte à débiter dépend de cette même décision. À trancher avec l'expert-comptable avant d'automatiser.
3. La base de calcul de l'IRF — brut vs. net de commission (B3).
4. La comptabilité de trésorerie pure pour le loyer (`loyer_encaisse` constate le produit à l'encaissement effectif, jamais de créance 411 à l'échéance) — déjà annoté « hypothèse majeure à valider » dans le code.
5. Toute règle métier de correction proposée pour A1/A2/A3 ci-dessus, qui touche à la fois la comptabilité et la relation commerciale avec les locataires/propriétaires.

---

## Résumé — Étape 6 (corrections appliquées, 23/09/2026)
| ID | Titre | Gravité | Mode | Statut | Commit |
|---|---|---|---|---|---|
| A1 | Paiement partiel efface le solde restant du mois | ❌ grave | Simple | ✅ Corrigé | `ce5a78a` |
| A2 | Reversement sans garde-fou sur le solde détenu | ❌ grave | Simple + Avancé | ✅ Corrigé | `befcb33` |
| A3 | Aucune annulation de paiement de loyer | ⚠️ significatif | Simple | ✅ Corrigé | `14d28bf` |
| B1 | Erreurs métier GL → 500 générique, message caché en prod | ❌ grave | Avancé | ✅ Corrigé | `5f8d781` |
| B4 | Rattrapage silencieusement incomplet si exercice clos | ⚠️ modéré | Avancé | ✅ Corrigé | `2b43f53` |

*(B2/B3 restent des points de méthode comptable à faire trancher par un professionnel — volontairement non codés.)*

Un commit distinct (`395a2c6`) contient un correctif sans rapport avec cet audit (taux de commission futur affiché comme actif), déjà validé avec l'utilisateur avant le début de la mission — séparé pour ne pas polluer l'historique des corrections d'audit.

**Vérification finale (un commit par anomalie, un test par anomalie, comme demandé) :**
- Suite de tests backend complète : **130/130** (dont 27 tests nouveaux ajoutés pour ces 5 corrections).
- `tsc --noEmit` (frontend) : propre.
- `eslint` (fichiers touchés) : propre.
- Chaque correction revérifiée en direct sur l'entreprise jetable de l'audit (jamais sur KIko Store) : paiement partiel + complément tombant bien sur le même mois (A1) ; reversement de 5 000 000 FCFA désormais rejeté (A2) ; annulation d'un paiement avec extourne GL générée (A3) ; code HTTP réel au lieu de 500 (B1) ; raison affichée lors d'un rattrapage partiel (B4).

**Fin du rapport.**
