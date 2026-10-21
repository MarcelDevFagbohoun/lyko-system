# Paiements sortants (FedaPay) — sécurité et traçabilité

Activation : Paramètres → « Paiements sortants (FedaPay) » (DG). Désactivé par défaut : rien ne change.

## Règles centrales
- Envoi d'argent : **DG uniquement**, mot de passe re-saisi à chaque envoi (5 échecs → blocage 15 min), clé d'idempotence obligatoire (un double-clic ne paie jamais deux fois), plafond par paiement et par jour.
- L'effet métier (versement propriétaire / fiche de paie / dépense / écritures comptables) n'est appliqué **qu'après relecture du statut `sent` chez FedaPay par le serveur**, une seule fois (verrou + `applied_at`). Un statut venant du navigateur ou d'un tiers n'est jamais cru.
- Montant confirmé ≠ montant demandé → anomalie, rien n'est enregistré. Mois clôturé → l'argent est parti mais l'ordre reste « à régulariser » (bouton « Réessayer »).
- Le solde dû à un propriétaire tient compte des envois en cours (réservation) : pas de dépassement par deux ordres simultanés.

## Données
- Clé secrète FedaPay chiffrée (AES-256-GCM), écriture seule, jamais renvoyée ni journalisée.
- Numéros masqués partout (listes, avis PDF, journaux), adresses e-mail masquées dans le journal des notifications.
- Journal d'audit en ajout seul, **chaîné par hachage** : toute modification se détecte (Paiements → « Vérifier le journal »).
- Entrées validées strictement (champ inconnu refusé), requêtes SQL paramétrées, isolation par entreprise (404 pour un autre cabinet), e-mails échappés + garde contre l'injection d'en-têtes.

## E-mails et documents
- Bénéficiaire (salaire, reversement, autre) : e-mail automatique à la confirmation, avis de paiement PDF.
- Locataire : e-mail automatique à chaque loyer/charge encaissé (saisie manuelle ou KKiaPay) ; quittance de loyer et reçu de charges téléchargeables dans son portail.

## À valider en sandbox FedaPay réel
La valeur `mode` pour Moov Bénin et l'enveloppe JSON des réponses (gérées défensivement). Les paiements sortants n'ont pas de webhook documenté : le serveur relit le statut (job chaque minute + bouton « Actualiser »).

## Tests
`backend/test/paymentOrders.test.js` (20 tests : droits, IDOR, injections, secrets, mot de passe, rejeu, anomalie, chaîne d'audit, e-mails, portail).

## Encaissement des locataires via FedaPay (remplace KKiaPay dans l'interface)
- Le locataire est **redirigé vers la page de paiement hébergée FedaPay** : aucune clé n'est exposée au navigateur.
- Le serveur crée d'abord une *intention* (référence aléatoire 128 bits liée à un bail, une facture ou un lien) ; le montant d'une charge est le reste dû calculé côté serveur, celui d'un loyer est borné (≤ 12 mois).
- Au retour (page `/paiement/retour`) ou sur webhook signé, le serveur **relit la transaction chez FedaPay** : statut `approved`, montant identique, référence de l'intention présente — sinon rien n'est enregistré. Enregistrement unique (clé `fedapay:<id>`).
- Webhook `POST /api/webhooks/fedapay/<id du cabinet>` : signature HMAC-SHA256 (secret du cabinet, chiffré), tolérance 10 min ; le corps du webhook n'est jamais cru, il ne fait que déclencher la relecture.
- Réglage : Paramètres → « Paiements en ligne (FedaPay) » (interrupteur « Encaisser les loyers et charges en ligne » + secret du webhook). Dans FedaPay, déclarer l'URL du webhook : `<API>/api/webhooks/fedapay/<id du cabinet>`.
- Les paiements KKiaPay déjà enregistrés restent intacts ; le code KKiaPay n'est plus utilisé par l'interface.
