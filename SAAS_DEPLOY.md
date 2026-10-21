# Mise en service du SaaS — liste de contrôle

## 1. Déploiement (aucun changement de comportement tant que les verrous sont éteints)
1. Déployer la branche, appliquer les migrations **105 à 108** (`npm run db:migrate`).
   Les entreprises existantes passent en offre « interne » (accès complet, sans limite ni échéance).
2. Variables d'environnement (backend) :
   | Variable | Rôle |
   |---|---|
   | `PLATFORM_FEDAPAY_SECRET_KEY` | clé secrète du compte FedaPay **de Lyko System** (distinct des clés des entreprises) |
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
2. Les entreprises existantes restent « interne ». Pour en faire des clients payants : `/admin` → Entreprises → Attribuer
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
