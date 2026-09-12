import { CloudOff } from "lucide-react";

/**
 * Bandeau réutilisé sur tous les formulaires de création d'une fiche à code
 * auto-généré (bien, locataire/bail, propriétaire, employé, charge...) —
 * ces créations ne sont jamais mises en file hors-ligne (étape 11, décision
 * explicite) : le code séquentiel ne peut être attribué que par le serveur.
 */
export function OfflineNotice({ action = "cette création" }: { action?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning/10 px-3 py-2.5 text-body-sm text-warning-fg">
      <CloudOff size={16} className="shrink-0" />
      Hors-ligne : {action} nécessite une connexion (un identifiant est généré par le serveur). Réessayez une fois la
      connexion revenue.
    </div>
  );
}
