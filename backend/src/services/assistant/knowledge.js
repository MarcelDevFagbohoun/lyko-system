'use strict';

/**
 * Ce que l'assistant sait de la plateforme (étape A : aide, sans accès aux données du cabinet).
 *
 * RÈGLE : chaque phrase ici correspond à une fonction réellement construite (docs/AVANCEMENT.md,
 * écrans). Ne rien ajouter qui n'existe pas : un assistant qui invente un bouton ou une étape est
 * pire que pas d'assistant. En cas de doute, l'assistant est instruit de le dire.
 */

const PLATFORM_KNOWLEDGE = `
# Plan de la plateforme (espace connecté)

- Tableau de bord — /espace/tableau-de-bord (direction) : loyers encaissés, impayés locataires, impayés SONEB/SBEE, solde net du mois, plaintes en cours, alertes du suivi des charges.
- Nos biens — /espace/biens ; création /espace/biens/nouveau ; fiche d'un bien /espace/biens/{id} : unités, agent responsable, compteurs et fluides (SONEB/SBEE), localisation sur la carte, recette du mois du bien.
- Propriétaires — /espace/proprietaires ; fiche /espace/proprietaires/{id} : taux de commission (avec dates d'effet), versements, relevé mensuel PDF, lien du portail propriétaire, solde que le cabinet détient pour lui (séquestre), carnet des charges.
- Locataires — /espace/locataires ; création /espace/locataires/nouveau ; fiche /espace/locataires/{id} : bail, frise des 12 derniers mois de loyer, enregistrement des paiements, quittances PDF, plaintes, état des lieux, sortie.
- Relances — /espace/relances : locataires en retard de loyer et factures SONEB/SBEE impayées ; bouton « Relancer » (ouvre WhatsApp avec un message prêt) ; option « Pénalité ».
- Plaintes — /espace/plaintes ; nouvelle plainte /espace/plaintes/nouveau ; suivi ouverte → en cours → résolue → fermée (une note de résolution est obligatoire pour résoudre).
- Tâches — /espace/taches : tâches du jour et tâches assignées.
- Comptabilité — /espace/comptabilite : période, loyers encaissés, versements aux propriétaires, dépenses (bouton « Nouvelle dépense »), export Excel, rapport mensuel PDF, clôture du mois (bouton « Clôturer le mois », réservé à la direction).
- Comptabilité avancée — /espace/comptabilite-avancee : module OPTIONNEL sur le plan SYSCOHADA (grand livre, balance, bilan, compte de résultat, rapprochement bancaire, exercices) ; la direction l'active dans les Réglages.
- Charges SONEB/SBEE — /espace/charges ; relevés /espace/charges/releves ; bouton « Nouveau relevé » ; « le point » /espace/charges/point (facture mère payée par le propriétaire, encaissé chez les locataires, impayés, reste à charge, reversement au propriétaire).
- Employés — /espace/employes (direction) : créer des comptes agent ou comptable et choisir leurs permissions ; le mot de passe temporaire doit être changé à la première connexion.
- Journal — /espace/journal (direction) : qui a fait quoi et quand. Historique — /espace/historique : l'historique personnel d'un employé non-direction.
- Réglages — /espace/parametres (direction) : comptabilité avancée, catalogue de facturation des états des lieux, noms des postes, convention de paiement du loyer par défaut (d'avance ou à terme échu), paiement en ligne KKiaPay, assistant.
- Mon compte — /espace/mon-compte : signature de l'employé.

# Fonctionnement à connaître

- Rôles : la direction a tous les droits ; un comptable et un agent n'ont que les modules cochés par la direction. Un agent peut être limité aux biens qui lui sont attribués.
- Paiement d'un loyer : fiche du locataire → « Enregistrer un paiement » (espèces, Mobile Money, virement ou chèque). Une quittance PDF numérotée est générée. Si un mois n'est payé qu'en partie, le bouton « Payer le reste » règle la différence. Un paiement envoyé deux fois par erreur ne s'enregistre qu'une fois ; un paiement mal saisi peut être annulé et l'annulation reste tracée.
- Convention de loyer : chaque bail suit « d'avance » ou « à terme échu » ; la valeur par défaut se règle dans les Réglages.
- Charges SONEB/SBEE : le propriétaire paie la facture mère, le cabinet encaisse les locataires puis fait le point ; le cabinet ne garde rien sur les charges, il reverse ce qu'il a encaissé.
- Clôture mensuelle : un mois clôturé est verrouillé définitivement (plus aucun paiement, dépense ou versement ne peut y être ajouté ni modifié).
- Portails : le locataire et le propriétaire consultent un espace personnel, sans mot de passe, via un lien secret généré par le cabinet (lecture seule). Le paiement en ligne (Mobile Money ou carte via KKiaPay) est facultatif et activé par la direction.
- Hors connexion : les pages déjà ouvertes restent consultables ; seuls l'enregistrement d'un paiement de loyer et le signalement d'une plainte peuvent se faire hors connexion (synchronisés au retour du réseau). Créer un bien, un locataire, un propriétaire, un employé ou une charge demande une connexion.
- Documents : quittances, contrats de bail et relevés portent un code de vérification contrôlable sur la page publique « Vérifier un document ».
`.trim();

module.exports = { PLATFORM_KNOWLEDGE };
