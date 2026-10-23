# Mise en service du SaaS — liste de contrôle

## 1. Déploiement (aucun changement de comportement tant que les verrous sont éteints)
1. Déployer la branche, appliquer les migrations **105 à 110** (`npm run db:migrate`).
   Les entreprises existantes passent en offre « interne » (accès complet, sans limite ni échéance).
2. Variables d'environnement (backend) :
   | Variable | Rôle |
   |---|---|
   | `PLATFORM_FEDAPAY_SECRET_KEY` | clé secrète du compte FedaPay **de Africa Immo Management** (distinct des clés des entreprises) |
   | `PLATFORM_FEDAPAY_WEBHOOK_SECRET` | secret du webhook de ce compte |
   | `PLATFORM_FEDAPAY_SANDBOX` | `false` en production (défaut : sandbox) |
   | `PLATFORM_ADMIN_EMAIL` | reçoit les demandes de remboursement |
   | `PLATFORM_REFUND_FEE_PERCENT` | estimation des frais retenus au remboursement (défaut 3, ajustable à chaque validation) |
   | `PLATFORM_ADMIN_JWT_SECRET` | optionnel ; sinon dérivé de la clé JWT existante |
   | `SUBSCRIPTIONS_ENFORCED` | `true` pour appliquer offres, limites et coupure (défaut `false`) |
   | `ASSISTANT_FEATURE_ENABLED` | `false` : assistant IA désactivé (version ultérieure) |
   Frontend : `NEXT_PUBLIC_ASSISTANT_ENABLED` (laisser vide).
3. Dans le compte FedaPay de la plateforme : déclarer le webhook `https://<api>/api/billing/webhook`.
4. Créer l'administrateur : `PLATFORM_ADMIN_PASSWORD=<12 caractères min> node scripts/create-platform-admin.js "Nom" email`
   puis se connecter sur `/admin`.

## 2. Essai en sandbox avant d'activer (à faire une fois, à la main)
- Achat Démarrage 1 mois → paiement Mobile Money sandbox → abonnement actif, facture PDF.
- Achat Pro 4 mois (tarif fondateur 49 000) → renouvellement (65 000, période prolongée).
- Demande de remboursement → accepter dans `/admin` → lien reçu par courriel → saisie du numéro → envoi du virement.
  **Point à confirmer avec FedaPay** : valeur de `mode` pour Moov et enveloppe JSON des paiements sortants (déjà signalé dans `fedapay.js`).
- Entreprise expirée : espace bloqué, page Abonnement accessible, locataires peuvent toujours payer.

## 3. Activation
1. Passer `SUBSCRIPTIONS_ENFORCED=true`.
2. Les entreprises existantes restent « interne ». Pour en faire des clients payants : `/admin` → Entreprises → « Attribuer une offre » (et « Passer en interne » pour l'inverse)
   (ou passer leur `plan_key` en base).
3. Les nouvelles inscriptions arrivent sur l'écran « choisir une offre » et paient avant d'accéder à leur espace.

## 4. Points restant ouverts (décisions à prendre)
- **Export des données pendant la coupure** : non implémenté (l'entreprise expirée n'a plus accès à rien tant qu'elle ne renouvelle pas).
- **Mentions légales, CGV, TVA** sur les factures : à fournir (la facture actuelle est acquittée, sans TVA).
- **Prix proposés non confirmés** : limites Pro (200 unités / 60 propriétaires / 8 utilisateurs), Entreprise (180 000 / 4 mois, 520 000 / an),
  annuels Démarrage 120 000 et Pro 180 000 — modifiables dans le back-office (`/admin` → « Offres et prix ») ; `constants/plans.js` ne sert plus que de valeurs d'origine.
- **Changement d'offre en cours de période** : repart de la date du paiement, sans proratisation.
- **Frais de remboursement** : montant fixé à la main à chaque validation (estimation par défaut).

## 5. Modifier les offres (back-office → « Offres et prix »)
- Nom, offre recommandée, durées et prix, limites (vide = illimité), fonctions incluses, tarif fondateur (offre, durée, prix, nombre de places), délai de remboursement.
- **Prix** : seulement pour les achats futurs (chaque paiement garde le montant payé). **Limites et fonctions** : effet immédiat pour toutes les entreprises de l'offre ; une limite abaissée ne supprime rien, elle empêche d'en créer de nouveaux.
- Chaque enregistrement est tracé (qui, quand, avant/après). « Revenir aux valeurs d'origine » restaure le code.
- Cache de 10 s par processus.

## 6. Domaine et adresse d'envoi
Actuellement : domaine `cabinetmconseil.com`, expéditeur `service@cabinetmconseil.com` (valeur par défaut de `EMAIL_FROM_ADDRESS`).
Tout est réglé par variables d'environnement, aucun changement de code n'est nécessaire le jour où vous achetez le domaine d'Africa Immo Management :
1. Variables : `PUBLIC_APP_URL` (= `FRONTEND_URL` / `CORS_ORIGIN`), `PUBLIC_API_URL`, `EMAIL_FROM_ADDRESS`.
2. Resend : vérifier le nouveau domaine d'envoi (enregistrements DNS) avant de changer l'expéditeur, sinon les courriels (code de vérification, rappels, remboursements) ne partent plus.
3. FedaPay : redéclarer les adresses de webhook avec le nouveau domaine (`/api/billing/webhook` pour la plateforme, et celle affichée dans Paramètres pour chaque entreprise).
4. Les liens déjà envoyés par courriel (retour de paiement, lien de remboursement) pointent vers l'ancien domaine : garder l'ancien actif quelques semaines.
5. Les liens de portail locataire/propriétaire déjà partagés suivent `FRONTEND_URL` : prévenir les clients ou garder une redirection.


## Revue du 21/10/2026 — points ajoutés

- **Coupure côté serveur** : avec `SUBSCRIPTIONS_ENFORCED=true`, toute requête authentifiée d'une entreprise sans abonnement actif reçoit 402, sauf connexion, abonnement et pages publiques.
- **Réconciliation** : toutes les 10 minutes, les paiements d'abonnement restés « en attente » sont relus chez FedaPay (rattrapage si le webhook est perdu).
- **Identité légale** : renseigner `PLATFORM_LEGAL_RCCM/IFU/ADDRESS` (factures) et `NEXT_PUBLIC_LEGAL_*` (pages /cgu, /confidentialite, /mentions-legales, figées au build web). Les textes légaux sont des brouillons à faire valider par un juriste ; changer `TERMS_VERSION` à chaque modification.
- **Inscription** : la case d'acceptation est obligatoire ; la date et la version acceptées sont conservées (`tenants.terms_accepted_at/terms_version`).
- **Production** : `/diagnostics` est introuvable et `/api/health/db` ne renvoie plus de détail technique.
- **Tests** : `npm test` (dans `backend`) utilise la base `<DB_NAME>_test` créée automatiquement ; il refuse de tourner sur la base de développement.
- Paiements en ligne : tout passe par FedaPay (enregistrés en Mobile Money). KKiaPay a été entièrement retiré (voir Lot 8).

## Lot 3 — back-office

- **Migration 110** : double authentification (TOTP) des administrateurs et journal d'audit (`platform_admin_audit`).
- **Activer la 2FA** : back-office > onglet « Sécurité » > scanner le QR code avec Google Authenticator/Authy. Ensuite chaque connexion demande le code. Le journal (onglet « Journal ») garde connexions, refus, remboursements, attributions et modifications d'offres.
- **Dépassement de limites** : si une offre est abaissée sous l'usage d'une entreprise, celle-ci voit un bandeau et le back-office l'indique dans « Entreprises ».
- **Identifiants conservés volontairement** (les changer casserait des données ou des sessions en cours) : nom de base `lyko_system` et utilisateur `lyko`, `JWT_ISSUER`, cookie `lyko_refresh`, métadonnée FedaPay `lyko_reference`, base hors-ligne `lyko-offline`. Aucun n'est visible par un utilisateur.

## Lot 4 — cautions chez le propriétaire, notes en bulles, vocabulaire comptable

- Migrations à appliquer : `111_owner_deposit_transfers.sql` (reversement des cautions), `112_entity_notes.sql` (notes datées ; reprend les anciennes notes locataire/propriétaire comme première bulle).
- Comptabilité avancée : nouveau compte 4673 et deux règles (`caution_reversee_proprietaire`, `caution_recuperee_proprietaire`) créés automatiquement au premier reversement.

## Lot 5 — états des lieux : point de sortie complet, signatures à la main

- Migration `113_move_out_statement.sql` (lignes libres, loyers dus bruts, solde négatif et sa résolution).
- Les états des lieux d'entrée et de sortie n'ont plus de signature numérique : le PDF comporte deux cadres vides (locataire / cabinet) à signer après impression. Les anciens PV déjà signés gardent leurs signatures. Le contrat de bail reste signé numériquement.
- Sortie : loyers impayés repris automatiquement ; si les dettes dépassent la caution, le locataire doit régler la différence ou effectuer les réparations avant la finalisation (le règlement encaissé reste à régulariser manuellement en comptabilité, comme les retenues).

## Lot 6 — menu « Paiements » unique, FedaPay obligatoire quand il est activé

- Migration `114_unified_payments.sql` : nouvel objet de paiement `reversement_charges` (reversement des charges SONEB/SBEE par FedaPay) et n° Mobile Money + opérateur mémorisés sur la fiche de l'employé (toujours affichés masqués).
- Le menu « Salaires » disparaît (l'ancienne adresse redirige vers « Paiements »). Page unique : historique de toutes les opérations avec reçu (salaires, reversements propriétaires, reversements de charges, dépenses payées, restitutions de caution) + onglet « Personnel & salaires ».
- **FedaPay activé** : la saisie manuelle d'un salaire, d'un reversement propriétaire ou d'un reversement de charges est refusée par le serveur (409) ; tout passe par FedaPay avec mot de passe, plafonds et journal d'audit. **FedaPay désactivé** : saisie du paiement effectué, avec récapitulatif de confirmation (mode de règlement, date, effet comptable).
- Reçus : fiche de paie (salaire manuel), avis de paiement (tout ordre FedaPay), reçu PDF généré pour les autres opérations manuelles. Les salaires restent visibles du seul directeur général.

## Lot 7 — charges SONEB/SBEE ajoutées au solde du propriétaire

- Migration `115_charge_credit_to_owner_balance.sql` (colonne `kind` sur `owner_charge_remittances`).
- Les charges payées par les locataires restent chez le cabinet. Le bouton « Créditer le solde » crée un transfert interne (partiel possible, plafonné aux charges encaissées non encore ajoutées) : le solde du propriétaire augmente, puis tout est versé depuis le menu Paiements (FedaPay ou saisie manuelle).
- Comptabilité avancée : nouvelle règle `charge_ajoutee_solde_proprietaire` (débit 411, crédit 4671 du propriétaire), ajoutée automatiquement au premier transfert, à valider par l'expert-comptable. Annulation possible avec motif tant que le solde n'est pas déjà versé ; l'écriture est alors extournée.
- Les anciens reversements de charges réellement payés restent dans l'historique (`kind = cash`) et ne modifient pas le solde.
- Part répercutée : le montant créditable au solde d'un propriétaire tient compte du réglage « % répercuté » (Paramètres → Charges SONEB / SBEE, 100 % par défaut). Le reste des charges encaissées est affiché « Gardé par le cabinet (frais de gestion) ». Le pourcentage actuel s'applique à l'ensemble des encaissements (pas d'historique des changements de réglage).

## Lot 8 — réglages généraux élargis, KKiaPay retiré

- Migration `116_remove_kkiapay.sql` **à appliquer au déploiement** : les anciens paiements « kkiapay » deviennent « mobile_money », la colonne `kkiapay_transaction_id` devient `online_transaction_id`, les clés KKiaPay des entreprises sont supprimées.
- Paramètres généraux (accessibles sans comptabilité avancée) : % de charges SONEB/SBEE répercuté, moment de comptabilisation de la commission, seuil d'alerte de dépense. Ces réglages sont pris en compte en comptabilité simple. La retenue IRF et la proratisation de l'amortissement restent en Comptabilité avancée.

## Lot 9 — parcours d'abonnement d'un nouvel inscrit

- Inscription → code e-mail → connexion : tant que l'entreprise n'a jamais payé, le directeur est redirigé vers la page « Choisissez votre offre » (aucun accès à l'espace avant le premier paiement).
- Menu Tarifs : le bouton d'une offre mémorise le choix, mène à l'inscription, et après connexion l'offre est ouverte directement sur le récapitulatif de paiement.
- Après paiement confirmé (renvoi FedaPay ou webhook), e-mail au directeur : offre, durée, montant, date d'échéance, avantages et limites. Aucune migration.

## Lot 10 — e-mails professionnels et reçu d'abonnement vérifiable

- Migration `117_subscription_receipt_verification.sql` **à appliquer** (type de document `recu_abonnement`).
- Gabarit commun de tous les e-mails refondu (en-tête de marque, texte d'aperçu, version texte, pied de page légal) ; expéditeur affiché « Africa Immo Management ».
- Après chaque paiement d'abonnement : e-mail avec le **reçu PDF en pièce jointe**, son numéro (AIM-AAAA-NNNNNN) et un **code de vérification** (XXXX-XXXX-XXXX) contrôlable publiquement sur `/verifier`. Même reçu téléchargeable depuis la page Abonnement.
- Renseigner `PLATFORM_LEGAL_ADDRESS`, `PLATFORM_LEGAL_RCCM` et `PLATFORM_LEGAL_IFU` pour qu'ils figurent dans le pied des e-mails et sur le reçu.
- Prérequis d'envoi : domaine vérifié dans Resend (SPF, DKIM) et `EMAIL_FROM_ADDRESS` sur ce domaine.

## Lot 11 — comptes employés renforcés, mot de passe oublié de l'admin

- Migration `118_employee_job_title_password_reset.sql` **à appliquer** (poste de l'employé, postes ajoutés par l'entreprise, champs de réinitialisation).
- Identifiant employé généré sur 12 caractères (`XXXX-XXXX-XXXX`) ; les anciens identifiants restent valables. Mot de passe temporaire : changement obligatoire à la première connexion (déjà en place).
- Poste obligatoire à la création : choix dans les suggestions ou nouveau poste (mémorisé pour l'entreprise), affiché à l'employé (barre latérale) et dans le message d'identifiants (WhatsApp/e-mail).
- « Mot de passe oublié ? » sur la connexion admin : code à 8 chiffres envoyé à l'e-mail vérifié (15 min, 5 essais), nouveau mot de passe, toutes les sessions fermées. Les employés demandent un nouveau mot de passe à leur admin.

## Lot 12 — annulation d'abonnement, e-mails au logo, écran de paiement isolé

- Migration `119_subscription_cancellation.sql` **à appliquer** (type de demande, jours restants, coordonnées complètes du bénéficiaire, paiement manuel).
- Le DG demande l'annulation depuis la page Abonnement (motif obligatoire). Tant que l'admin AIM n'a pas répondu, le bouton affiche « Examen en cours ». Refus : e-mail avec la réponse, bouton de nouveau disponible. Acceptation : **accès coupé aussitôt** et e-mail avec un lien (7 jours, usage unique) vers le formulaire nom, prénom, type de compte (MTN, Moov, Celtiis, banque, autre), numéro et intitulé.
- Montant remboursé : prorata des jours restants à partir du jour de la demande. Dans les 15 jours de garantie, le premier paiement est remboursé en entier. Frais retenus : 3 % par défaut, modifiables par l'admin à l'acceptation.
- Versement : FedaPay (MTN et Moov uniquement) ou « Marquer comme payé » avec une référence pour les autres comptes (route `POST /api/admin/refunds/:id/mark-paid`).
- Pendant un abonnement actif, seul le renouvellement de la même offre est possible (409 sinon) ; il démarre à l'échéance en cours, sans coupure.
- E-mails : logo servi depuis `FRONTEND_URL/brand/logo-mark.png` (le site doit être en ligne et public), mise en page type facture, textes réécrits sans tirets longs. Reçu PDF refait dans le même style, avec logo et code de vérification.
- Une entreprise qui n'a jamais acheté d'abonnement n'a plus accès qu'à l'écran de choix et de paiement (sans menu, avec déconnexion).
