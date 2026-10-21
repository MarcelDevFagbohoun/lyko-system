# Lyko System en SaaS — plan technique

Statut : décisions du 21/10/2026 intégrées, rien n'est encore codé. Les prix en gras sont ceux fixés par Marcel ; le reste est une proposition.

Décisions prises : pas d'essai gratuit (on paie, avec remboursement possible sous 15 jours) ; Pro est l'offre principale ; on peut commencer par Démarrage à 15 000 FCFA (1 mois) ou 25 000 FCFA (2 mois) ; après expiration, les locataires peuvent toujours payer leur loyer mais l'entreprise n'a plus accès à son espace, **coupure automatique sans délai de grâce** ; remboursement **moins les frais FedaPay** ; **l'assistant IA est mis de côté au lancement** (désactivé dans le code, réintégré dans une version ultérieure).

## 1. Offres

| | **Démarrage** | **Pro** | **Entreprise** |
|---|---|---|---|
| Prix | **25 000 FCFA / 2 mois** ou **15 000 FCFA / 1 mois** (au démarrage) | **65 000 FCFA / 4 mois** | 180 000 FCFA / 4 mois (proposé) |
| Annuel | 120 000 (proposé) | 180 000 (proposé) | 520 000 (proposé) |
| Unités | **50** | 200 (proposé) | illimité |
| Propriétaires | **10** | 60 (proposé) | illimité |
| Utilisateurs (DG + employés) | 2 | 8 | 20 |
| Remboursement | **15 jours, 1re souscription** | idem | idem |

Fonctions (clés techniques entre parenthèses) :

| Fonction | Démarrage | Pro | Entreprise |
|---|---|---|---|
| Biens, propriétaires, locataires, baux, loyers, quittances, charges SONEB/SBEE, relances, tâches, plaintes, états des lieux, portail locataire, comptabilité simple (dépenses, autres entrées, clôture du mois) (`core`) | oui | oui | oui |
| Paiement des loyers par les locataires via FedaPay (`tenant_collect`) | oui | oui | oui |
| Fiches de paie et salaires (payroll) (`payroll`) | non | oui | oui |
| Paiements sortants FedaPay : salaires, reversements, paiements libres (`payouts`) | non | oui | oui |
| Relevé propriétaire, portail propriétaire (`owner_portal`) | non | oui | oui |
| Biens à vendre (`sale_properties`) | non | oui | oui |
| Assistant IA (`ai_assistant`) | **reporté** : désactivé au lancement pour toutes les offres, prévu dans une version ultérieure | | |
| Comptabilité avancée SYSCOHADA (`advanced_accounting`) | non | non | oui |
| Journal d'audit complet, support prioritaire (`audit_full`) | non | non | oui |

## 2. Ce qui existe déjà et ce qui manque

Existe :
- Multi-entreprises : toutes les tables portent `tenant_id`, chaque requête est filtrée par entreprise.
- Inscription : `POST /api/auth/register`, code email à 8 chiffres, session émise après vérification. Elle crée l'entreprise et son DG.
- Rôles `dg` / `comptable` / `agent` et permissions par module (`user_permissions`, `requirePermission`).
- Drapeaux par entreprise : `gl_module_enabled`, `assistant_enabled`, `fedapay_enabled`, `fedapay_collect_enabled`.
- Assistant IA : quota mensuel **fixe à 150 messages pour tout le monde** (`services/assistant/usage.js`), garde d'accès dans `services/assistant/access.js`.
- Client FedaPay maison (paiements sortants et encaissement), webhook signé, relecture serveur du statut, journal d'audit chaîné, chiffrement des clés (AES-256-GCM), tâches planifiées (`jobs/scheduler.js`).
- Page d'accueil marketing, sans page de tarifs.

Manque :
- Aucune notion d'abonnement, d'offre, de limite ni d'expiration.
- Aucun rôle « administrateur de la plateforme » : chaque DG est seul maître de son entreprise.
- Les clés FedaPay sont **par entreprise** ; il en faut une paire **propre à Lyko** pour encaisser les abonnements.

## 3. Modèle de données (migration 105 et suivantes)

Les offres vivent dans le code (`backend/src/constants/plans.js`) : prix, durées, limites, fonctions. Pro est l'offre principale mise en avant ; Démarrage sert de porte d'entrée. Pas de table de configuration à synchroniser, et chaque changement de prix est versionné dans git.

Tables :
- `tenant_subscriptions` : `tenant_id` (unique), `plan_key` (`demarrage|pro|entreprise|interne`), `status` (`active|expired|cancelled|refunded`) ; `expired` et `refunded` = accès entreprise coupé, `period_months`, `started_at`, `current_period_end`, `first_purchase_at`, `refund_eligible_until` (= premier paiement + 15 jours).
- `subscription_payments` : `id`, `tenant_id`, `plan_key`, `period_months`, `amount`, `reference` (128 bits, non devinable), `fedapay_transaction_id`, `status` (`pending|approved|failed|refunded`), `paid_at`, `invoice_number`. Contrainte d'unicité sur la transaction FedaPay (idempotence).
- `subscription_refunds` : `payment_id`, `requested_by`, `reason`, `status` (`requested|approved|awaiting_payee_details|rejected|paid`), `decided_by`, `decided_at`, `rejection_reason`, `payee_phone`, `payee_operator` (chiffrés), `payee_token_hash`, `payee_token_expires_at`, `payout_reference`.
- `platform_admins` : comptes séparés des utilisateurs d'entreprise (voir section 7).
- `subscription_events` : trace de tout changement (qui, quand, avant/après), réutilisant le journal chaîné existant.

Entreprises existantes : migration de rattrapage, toutes passent en `interne` (accès complet, sans expiration) ; l'offre est ensuite ajustée à la main. Cabinet M Conseils reste en `interne`.

## 4. Application des limites (toujours côté serveur)

Un service unique `services/entitlements.js` :
- `getEntitlements(tenantId)` : offre, statut, limites, fonctions.
- `assertFeature(tenantId, 'payouts')` et middleware `requireFeature('payouts')`.
- `assertWithinLimit(conn, tenantId, 'units')` : compte les unités actives **dans la transaction de création**, avec verrou sur la ligne d'abonnement pour qu'une rafale de requêtes ne dépasse pas la limite.

Points d'application :
- Création d'unité, de propriétaire, d'employé : limite correspondante.
- Routes de paiements sortants, fiches de paie, relevés et portail propriétaire, biens à vendre : `requireFeature`.
- Activation de la comptabilité avancée (`routes/gl/glActivation.js`) : `advanced_accounting`.
- Assistant IA : **désactivé au lancement** (voir section 4bis). Quand il reviendra, `blockReason` ajoutera « offre » et `MONTHLY_QUOTA` deviendra le quota de l'offre.
- Menu et boutons masqués côté interface selon l'offre, **mais jamais comme seule protection**.

Dépassement : l'ajout est refusé avec un message clair et un lien « passer à l'offre au-dessus ». Les données existantes ne sont jamais supprimées. Si une entreprise redescend d'offre au-dessus de ses limites, ses données restent, seul l'ajout est bloqué.

## 4bis. Assistant IA mis de côté au lancement

Décision du 21/10/2026 : l'assistant n'est pas vendu au lancement et sera réintégré dans une version ultérieure, avec ses quotas par offre.
- Désactivation **réversible** par un indicateur unique côté serveur (`ASSISTANT_FEATURE_ENABLED`, faux par défaut) : routes non montées, aucun appel à l'API d'IA, aucune dépense.
- Interface : bouton, panneau, réglage de la direction et permission « Assistant IA » masqués quand l'indicateur est faux.
- Le code, les tables et les tests de l'assistant sont **conservés** (non supprimés) pour le remettre en service sans réécriture.
- Effet sur les prix : la seule dépense variable importante par client disparaît ; les marges de Démarrage et de Pro n'en dépendent plus.

## 5. Expiration

- Rappels par email et bandeau dans l'application : J-14, J-7, J-1.
- À l'échéance : **coupure automatique, sans délai de grâce**. L'**accès de l'entreprise à son espace est coupé** (DG et employés : connexion refusée avec un message « abonnement expiré » et un lien pour renouveler, sans accès aux données).
- **Les locataires, eux, continuent de payer** : le portail locataire, les liens de paiement et le paiement FedaPay des loyers et charges restent actifs. L'argent va directement sur le compte FedaPay de l'entreprise (ses propres clés), donc il n'est jamais bloqué par Lyko.
- Les paiements reçus pendant la coupure sont **enregistrés normalement** (webhook et relecture serveur, quittance envoyée au locataire) pour que la comptabilité soit complète au retour de l'entreprise.
- Les données ne sont jamais supprimées. Au renouvellement, l'accès est rétabli à l'identique.
- Seuls restent actifs côté entreprise : la page de renouvellement et le paiement de l'abonnement.
- Technique : un contrôle d'accès à la connexion, au rafraîchissement du jeton et sur chaque route des espaces entreprise ; les routes publiques du portail et des webhooks ne sont pas concernées.
- Point à confirmer : possibilité de demander un export des données à Lyko pendant la coupure.

## 6. Facturation de l'abonnement par FedaPay

- Nouvelles variables d'environnement : clé secrète FedaPay Lyko, secret du webhook, mode sandbox/live. Séparées des clés des entreprises.
- Réutilise `services/payments/fedapay.js` et le schéma déjà validé pour l'encaissement des locataires : transaction créée côté serveur, montant et référence lus en base (jamais envoyés par le client), redirection vers la page hébergée FedaPay, retour client, **webhook signé (HMAC)** et **relecture du statut côté serveur**, vérification montant et référence, idempotence.
- Webhook : `/api/webhooks/fedapay-platform/` (route distincte de celle des entreprises).
- Pas de prélèvement automatique : le Mobile Money ne le permet pas de façon fiable. Le renouvellement est un paiement manuel, d'où les rappels de la section 5.
- À chaque paiement : prolongation de `current_period_end`, facture PDF (reçu d'abonnement) au modèle unique du reste des documents, email automatique avec le PDF, téléchargement depuis Paramètres → Abonnement.
- Changement d'offre en cours de période : montée immédiate avec crédit proportionnel du temps restant (à valider) ; descente effective à l'échéance.
- Fiscalité : mentions et taux de TVA éventuels de la facture **à faire valider par un comptable** avant la mise en ligne. Rien n'est supposé ici.

## 7. Back-office de la plateforme

Espace `/admin` distinct, hors des espaces entreprise :
- Comptes `platform_admins` séparés, connexion dédiée, mot de passe fort, double authentification recommandée, limitation de tentatives.
- Liste des entreprises, offre, statut, consommation (unités, utilisateurs, questions IA).
- Actions : prolonger, offrir une période, changer d'offre, suspendre ; chacune exige un motif et est tracée.
- File des demandes de remboursement : approuver ou refuser.
- Aucune lecture des données métier des entreprises (locataires, montants) sans motif et sans trace.

## 8. Remboursement

Règle : 15 jours après le premier paiement, une seule fois par entreprise, première souscription uniquement.

Parcours :
1. L'entreprise clique sur « Demander un remboursement » dans Paramètres → Abonnement, avec un **motif obligatoire** (visible seulement pendant les 15 jours).
2. La demande arrive dans la file de l'administrateur Lyko System.
3. L'administrateur **valide ou refuse selon que la raison est acceptable**. Un refus exige une explication, envoyée par email à l'entreprise.
4. Si la demande est acceptée, **un email est envoyé au DG avec un lien sécurisé** pour saisir ses coordonnées de paiement (numéro Mobile Money et opérateur). Le lien est à usage unique, expire (par exemple 7 jours) et ne donne accès qu'à ce formulaire.
5. Le DG saisit ses coordonnées ; l'administrateur les vérifie et déclenche le versement par l'envoi d'argent FedaPay déjà intégré (mêmes contrôles, mêmes traces). À vérifier : FedaPay propose-t-il un remboursement direct d'une transaction ? À défaut, envoi classique.
6. À la décision d'accepter : l'accès de l'entreprise est coupé (statut `refunded`) et, si la demande est ensuite payée, tout est tracé (qui, quand, montant, référence du versement).

Sécurité du lien et des coordonnées : jeton aléatoire stocké haché, usage unique, expiration, limitation de débit, coordonnées chiffrées en base, jamais renvoyées en clair après saisie ; le versement ne part que vers le numéro saisi via ce lien.

Montant : **le prix payé moins les frais FedaPay** de la transaction d'origine (décision du 21/10/2026). Le calcul est fait côté serveur à partir des frais réels relus chez FedaPay ; il est affiché à l'entreprise avant la demande.

## 9. Interface

- Page publique `/tarifs` : trois cartes (Pro mise en avant), tableau comparatif, durées, prix en FCFA, FAQ remboursement (15 jours).
- Inscription : choix de l'offre (Pro mise en avant ; Démarrage à 15 000 FCFA pour 1 mois ou 25 000 FCFA pour 2 mois comme porte d'entrée), paiement de la première période par FedaPay avant l'activation. Pas d'essai gratuit : la garantie de remboursement sous 15 jours la remplace.
- Paramètres → Abonnement : offre actuelle, date de fin, barres de consommation (unités, propriétaires, utilisateurs, questions IA), renouveler, changer d'offre, factures, demande de remboursement.
- Bandeaux d'alerte avant expiration ; écran dédié « abonnement expiré » après la coupure.
- Invitations contextuelles : « cette fonction est dans l'offre Pro ».

## 10. Sécurité et traçabilité

- Toute limite et toute fonction vérifiées côté serveur ; le client n'est jamais cru.
- Le montant d'un abonnement vient du catalogue serveur, jamais du navigateur.
- Webhook : signature HMAC, comparaison à temps constant, relecture du statut, idempotence par transaction.
- Requêtes SQL paramétrées uniquement ; validation stricte de chaque entrée (zod).
- Limitation de débit sur le paiement, la demande de remboursement et la connexion admin.
- Journal d'audit chaîné pour tout changement d'abonnement, de limite ou de remboursement.
- Isolation par entreprise testée explicitement.

## 11. Tests à écrire

- Catalogue : prix, limites et fonctions de chaque offre.
- Limites : dépassement refusé, rafale concurrente qui ne dépasse pas la limite, descente d'offre sans perte de données.
- Fonctions : chaque route protégée refuse une offre inférieure (403 clair), accepte la bonne.
- Paiement d'abonnement : succès, montant altéré, référence d'une autre entreprise, webhook rejoué, webhook à signature invalide, paiement non approuvé.
- Expiration : rappels, coupure sans délai de grâce, accès entreprise refusé (connexion, jeton, routes) tout en laissant fonctionner le portail locataire, les liens de paiement et les webhooks ; paiements reçus pendant la coupure bien enregistrés ; accès rétabli au renouvellement.
- Remboursement : montant = prix − frais FedaPay (arrondi et frais relus côté serveur) ; hors des 15 jours refusé, deuxième demande refusée, refus avec motif, lien de saisie des coordonnées (usage unique, expiré, rejoué, mauvais jeton), versement uniquement vers le numéro saisi, accès coupé.
- Back-office : un utilisateur d'entreprise ne peut jamais appeler les routes admin ; actions tracées.
- Rattrapage : les entreprises existantes passent bien en `interne`.
- Assistant : indicateur faux = aucune route, aucun bouton, aucun appel d'IA ; code et tests conservés.

## 12. Étapes de réalisation

1. **Fondations** : `plans.js`, tables, migration de rattrapage, service d'entitlements, application des limites et des fonctions, désactivation réversible de l'assistant IA. Tests associés.
2. **Facturation** : paiement FedaPay des abonnements, webhook, factures PDF, emails, rappels et expiration (accès coupé, locataires toujours capables de payer).
3. **Back-office et remboursement** : comptes admin, espace `/admin`, demandes de remboursement (validation sur motif, email de collecte des coordonnées, versement).
4. **Interface publique** : page `/tarifs`, choix de l'offre à l'inscription, écran Paramètres → Abonnement, bandeaux.
5. **Durcissement** : revue de sécurité, tests de charge légers, relecture des textes et des conditions de vente par un juriste, essai complet en sandbox FedaPay.

Chaque étape est livrable et testée seule, comme pour les paiements.

## 13. Décisions

Prises le 21/10/2026 :
- Pas d'essai gratuit ; paiement puis remboursement possible sous **15 jours**.
- Remboursement validé par l'administrateur de Lyko System si la raison est acceptable, puis email pour récupérer les coordonnées de paiement. Montant = prix moins les frais FedaPay.
- Coupure automatique à l'échéance, sans délai de grâce.
- Assistant IA reporté à une version ultérieure.
- Après expiration : les locataires peuvent payer, l'entreprise n'a plus accès à son espace.
- Pro est l'offre principale ; on peut commencer par Démarrage à 15 000 FCFA (1 mois) ou 25 000 FCFA (2 mois).

Restent à trancher :
1. Prix de lancement et limites de Pro et d'Entreprise (voir la discussion du 21/10 sur un tarif de lancement).
2. Export des données à la demande pendant la coupure.
3. Entreprises existantes : tout en `interne`, ou certaines à basculer sur une vraie offre.
4. Facturation : TVA et mentions légales, à valider avec un comptable.
5. Qui administre la plateforme (comptes `platform_admins`).
