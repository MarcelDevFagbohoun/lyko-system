# Lyko System en SaaS — plan technique

Statut : proposition à valider. Rien n'est encore codé. Les prix en gras sont ceux fixés par Marcel ; le reste est une proposition.

## 1. Offres

| | **Démarrage** | **Pro** | **Entreprise** |
|---|---|---|---|
| Prix | **25 000 FCFA / 2 mois** (1 mois possible au début : 15 000, à confirmer) | **65 000 FCFA / 4 mois** | 180 000 FCFA / 4 mois (proposé) |
| Annuel | 120 000 (proposé) | 180 000 (proposé) | 520 000 (proposé) |
| Unités | **50** | 200 (proposé) | illimité |
| Propriétaires | **10** | 60 (proposé) | illimité |
| Utilisateurs (DG + employés) | 2 | 8 | 20 |
| Remboursement | **30 jours, 1re souscription** | idem | idem |

Fonctions (clés techniques entre parenthèses) :

| Fonction | Démarrage | Pro | Entreprise |
|---|---|---|---|
| Biens, propriétaires, locataires, baux, loyers, quittances, charges SONEB/SBEE, relances, tâches, plaintes, états des lieux, portail locataire, comptabilité simple (dépenses, autres entrées, clôture du mois) (`core`) | oui | oui | oui |
| Paiement des loyers par les locataires via FedaPay (`tenant_collect`) | oui | oui | oui |
| Employés et fiches de paie (`payroll`) | non | oui | oui |
| Paiements sortants FedaPay : salaires, reversements, paiements libres (`payouts`) | non | oui | oui |
| Relevé propriétaire, portail propriétaire (`owner_portal`) | non | oui | oui |
| Biens à vendre (`sale_properties`) | non | oui | oui |
| Assistant IA (`ai_assistant`) | non | 100 questions/mois (proposé) | 1 000 questions/mois (proposé) |
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

Les offres vivent dans le code (`backend/src/constants/plans.js`) : prix, durées, limites, fonctions. Pas de table de configuration à synchroniser, et chaque changement de prix est versionné dans git.

Tables :
- `tenant_subscriptions` : `tenant_id` (unique), `plan_key` (`demarrage|pro|entreprise|interne`), `status` (`active|grace|expired|cancelled|refunded`), `period_months`, `started_at`, `current_period_end`, `grace_until`, `first_purchase_at`, `refund_eligible_until`.
- `subscription_payments` : `id`, `tenant_id`, `plan_key`, `period_months`, `amount`, `reference` (128 bits, non devinable), `fedapay_transaction_id`, `status` (`pending|approved|failed|refunded`), `paid_at`, `invoice_number`. Contrainte d'unicité sur la transaction FedaPay (idempotence).
- `subscription_refunds` : `payment_id`, `requested_by`, `reason`, `status` (`requested|approved|rejected|paid`), `decided_by`, `decided_at`, `payout_reference`.
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
- Assistant : `blockReason` ajoute « offre » ; `MONTHLY_QUOTA` devient le quota de l'offre (100 / 1 000).
- Menu et boutons masqués côté interface selon l'offre, **mais jamais comme seule protection**.

Dépassement : l'ajout est refusé avec un message clair et un lien « passer à l'offre au-dessus ». Les données existantes ne sont jamais supprimées. Si une entreprise redescend d'offre au-dessus de ses limites, ses données restent, seul l'ajout est bloqué.

## 5. Expiration

- Rappels par email et bandeau dans l'application : J-14, J-7, J-1.
- À l'échéance : période de grâce de 7 jours, tout fonctionne.
- Après la grâce : **lecture seule**. Consultation, export des données et téléchargement des documents restent possibles ; création, paiements et envois sont bloqués.
- Jamais de suppression de données à l'expiration.
- Décision à confirmer : en lecture seule, les locataires peuvent-ils encore payer leur loyer par FedaPay ? Recommandation : oui pendant 30 jours, pour ne pas pénaliser les locataires.

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

- Fenêtre de 30 jours après le premier paiement, une seule fois par entreprise, première souscription uniquement.
- Bouton « Demander un remboursement » dans Paramètres → Abonnement, motif obligatoire.
- Validation manuelle par l'administrateur (recommandé au début).
- Montant : à trancher entre intégral et déduction des frais FedaPay.
- Versement par l'envoi d'argent FedaPay déjà intégré (mêmes contrôles, mêmes traces). À vérifier : FedaPay propose-t-il un remboursement direct d'une transaction ? À défaut, envoi classique.
- À l'approbation : l'accès passe en `refunded` (lecture seule), un export complet des données est mis à disposition 30 jours, la décision est tracée.

## 9. Interface

- Page publique `/tarifs` : trois cartes, tableau comparatif, durées, prix en FCFA, FAQ remboursement.
- Inscription : choix de l'offre, paiement de la première période par FedaPay avant l'activation (ou période d'essai si décidée, voir décisions).
- Paramètres → Abonnement : offre actuelle, date de fin, barres de consommation (unités, propriétaires, utilisateurs, questions IA), renouveler, changer d'offre, factures, demande de remboursement.
- Bandeaux d'alerte avant expiration et en lecture seule.
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
- Expiration : rappels, grâce, passage en lecture seule, export toujours possible.
- Remboursement : hors fenêtre refusé, deuxième demande refusée, approbation et versement, accès coupé.
- Back-office : un utilisateur d'entreprise ne peut jamais appeler les routes admin ; actions tracées.
- Rattrapage : les entreprises existantes passent bien en `interne`.
- Assistant : quota selon l'offre.

## 12. Étapes de réalisation

1. **Fondations** : `plans.js`, tables, migration de rattrapage, service d'entitlements, application des limites et des fonctions, quota IA par offre. Tests associés.
2. **Facturation** : paiement FedaPay des abonnements, webhook, factures PDF, emails, rappels et expiration (grâce, lecture seule).
3. **Back-office et remboursement** : comptes admin, espace `/admin`, demandes de remboursement et versement.
4. **Interface publique** : page `/tarifs`, choix de l'offre à l'inscription, écran Paramètres → Abonnement, bandeaux.
5. **Durcissement** : revue de sécurité, tests de charge légers, relecture des textes et des conditions de vente par un juriste, essai complet en sandbox FedaPay.

Chaque étape est livrable et testée seule, comme pour les paiements.

## 13. Décisions à trancher avant de coder

1. Pro est-elle l'offre principale (volume) ou doit-elle être plus nettement séparée de Démarrage ? L'écart actuel n'est que de 3 750 FCFA par mois.
2. Prix et limites de Pro et d'Entreprise (propositions ci-dessus), et prix d'un mois de Démarrage (15 000 ?).
3. Essai gratuit : oui ou non, sur quelle offre, combien de jours.
4. Remboursement : validation manuelle ou automatique ; intégral ou frais FedaPay déduits.
5. Lecture seule après expiration : les locataires peuvent-ils encore payer leur loyer ?
6. Entreprises existantes : tout en `interne`, ou certaines à basculer sur une vraie offre.
7. Facturation : TVA et mentions légales, à valider avec un comptable.
8. Qui administre la plateforme (comptes `platform_admins`).
