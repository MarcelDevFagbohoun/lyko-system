# Idées d'innovation — mises en réserve

Feuille de route des grandes idées, proposée le 2026-09-25. **Aucune n'est codée.** Chaque idée est
reprise une à la fois, sur décision de l'utilisateur, avec la règle habituelle : codée → testée → validée.

## Retenue par l'utilisateur (« parfait ») : n°3 — Travaux de bout en bout

**Statut : conception approuvée le 2026-09-25, MISE EN RÉSERVE — à reprendre plus tard. Aucun code écrit.**
Les trois décisions ci-dessous ne sont pas encore tranchées ; les recommandations valent par défaut.

### Pourquoi c'est peu coûteux : tout repose sur l'existant
- Une **dépense rattachée à un Bien** (`expenses.property_id`) réduit déjà la recette nette du propriétaire,
  donc son séquestre (`getEscrowBalances`). Le règlement d'un chantier n'ajoute AUCUN nouveau calcul d'argent.
- L'écriture SYSCOHADA d'une dépense (`genererEcriture`, catégorie `entretien`), les périodes clôturées, la
  clé d'idempotence et la dépense « à crédit » chez un fournisseur (`suppliers`) existent déjà.
- L'étape 7 (Plaintes) avait explicitement reporté : annuaire d'artisans, devis contradictoires, imputabilité,
  déduction sur le relevé propriétaire. Cette idée comble ce reste.

### Le parcours
1. **Plainte** (existante) → l'agent ouvre un « dossier de travaux » (code `TRAV-AAAA-NNNN`).
2. **Devis** : jusqu'à 3 par dossier (artisan, montant, délai, fichier), comparés côte à côte, un retenu.
3. **À la charge de** : propriétaire / locataire / à déterminer — choix MANUEL. Ne pas encoder de règle
   légale : l'utilisateur n'a pas confirmé la règle béninoise sur les réparations locatives.
4. **Validation propriétaire** : section « Travaux à valider » sur son portail (photos, devis retenu, effet
   sur sa part), Accepter / Refuser + motif. Le DG peut aussi enregistrer « validé par téléphone » + note.
5. **Exécution** : photos avant/après, puis « terminé ».
6. **Règlement** : création de la dépense rattachée au Bien (comptant ou à crédit) → séquestre et relevé
   propriétaire suivent tout seuls.
7. **Traçabilité** : chronologie (qui/quand) + 2 PDF (ordre de travaux pour l'artisan, procès-verbal de
   réception pour le propriétaire — mécanisme de code de vérification `document_issuances` réutilisable).

### Modèle de données envisagé (migration à venir, après 064)
- `work_orders` : tenant_id, complaint_id NULL, property_id, unit_id NULL, code, title, status
  (brouillon / devis / a_valider / valide / refuse / en_cours / termine / regle / annule),
  responsibility (proprietaire / locataire / a_determiner), approval channel (portail / telephone /
  non_requis) + horodatage + IP + motif de refus, chosen_quote_id, approved_amount, expense_id.
- `work_order_quotes` : work_order_id, supplier_id, amount, description, delay_days, file_path.
- Photos avant/après (même mécanisme que les photos de plaintes).
- `owners.repair_approval_limit` (seuil de validation, NULL = « toujours demander »).
- `suppliers` : ajouter un métier (plombier, électricien…) et un indicateur actif.

### Garde-fous
- Règlement impossible au-dessus du montant validé sans nouvelle validation (avenant).
- L'agent conduit le dossier (permission `plaintes`) ; le règlement exige la permission comptabilité ou le DG.
- Périmètre agent respecté (un agent ne voit que les Biens qui lui sont attribués).
- Règlement : périodes clôturées + clé d'idempotence, comme toutes les opérations d'argent.

### Points d'attention
- Le portail propriétaire est aujourd'hui **en lecture seule** : « Accepter » serait sa première action
  d'écriture ; l'autorité repose sur la possession du lien. Journaliser heure + IP + navigateur. Un code SMS
  serait plus solide mais exige un fournisseur SMS payant.
- Effet existant, non modifié : une dépense rattachée réduit aussi la base de commission du cabinet.

### Décisions encore à trancher (recommandations par défaut)
1. **Seuil de validation** : par propriétaire, « toujours demander » tant que le DG n'en fixe pas
   (recommandé) — ou seuil global unique.
2. **Artisans** : étendre `suppliers` avec un métier (recommandé) — ou vrai annuaire avec notes (plus tard).
3. **Périmètre de la v1** : dossier + devis + validation par portail + règlement + PDF (recommandé) ;
   notifications WhatsApp à chaque étape et suivi côté locataire = v2.

### Découpage prévu (3 étapes, comme pour les charges)
A. Modèle + règles + tests backend · B. Écrans du personnel (dossier sur la fiche plainte, comparaison
des devis) · C. Portail propriétaire (validation) + PDF.

## Autres innovations proposées (non retenues pour l'instant), par ordre de valeur
1. **Rapprochement Mobile Money** : coller/transférer le SMS MTN/Moov → montant, référence et numéro lus,
   locataire retrouvé, paiement proposé. Suppose l'unicité du téléphone (doublon KIko Store à corriger).
2. **Photo → donnée** : compteur, facture SONEB/SBEE, reçu MoMo lus par un modèle de vision, validation humaine.
4. **Assistant WhatsApp** locataire/propriétaire (API WhatsApp Business : coût + approbation).
5. **Copilote en langage naturel** sur les données du cabinet.
6. **Extension UEMOA** (mêmes règles SYSCOHADA, autres fournisseurs d'eau/électricité).
À vérifier juridiquement avant tout engagement : signature électronique des baux, partage d'historique de
locataires entre cabinets (données personnelles) — statut au Bénin non confirmé.

## À fermer avant de démarrer une nouvelle idée
- Commiter par sujet les fichiers en attente (étapes 32–38 de la 2ᵉ numérotation) ; rejouer la migration 064.
- Valider 12a (sécurité) et 12b (déploiement VPS), jamais validés sur le serveur.
- Nettoyer `AVANCEMENT.md` : étapes 30–32 en double, liste « reste à faire » de l'étape 13 périmée.
- Corriger le doublon de téléphone réel sur KIko Store, puis poser la contrainte en base.
- Décision expert-comptable sur l'écriture des reversements de charges (point B2 de l'audit).

## Écartée par l'utilisateur
- **Graphes** (encaissé vs attendu sur 12 mois, ancienneté des impayés, dépenses par catégorie, recette
  propriétaire, décomposition du point des charges, mini-courbes) : proposés le 2026-09-25, **laissés de côté**
  (« laissons les graphes »). Ne pas les reproposer sans qu'il y revienne. Si l'idée revient : SVG maison,
  teinte du cadre, un nouvel endpoint de séries mensuelles.
