import * as React from "react";
import { cn } from "@/lib/utils";

/** Glossaire comptable : terme technique + aide discrète (infobulle au survol / focus, soulignement pointillé). */
export const GLOSSARY: Record<string, string> = {
  caution: "Dépôt de garantie : somme appartenant au locataire, conservée en dette envers lui (compte 165) jusqu'à sa sortie.",
  mandants: "Fonds des propriétaires détenus par le cabinet pour leur compte (compte 4671 — comptes courants des mandants).",
  commission: "Honoraires de gestion du cabinet, prélevés sur les loyers encaissés (produit du cabinet).",
  cloture: "Arrêté des comptes du mois : bilan figé, contrôles de cohérence, période verrouillée.",
  tresorerie: "Mouvements réels d'argent (encaissements et décaissements) : caisse, banque, mobile money.",
  grandLivre: "Détail de toutes les écritures classées par compte comptable.",
  balance: "Total des débits et crédits de chaque compte ; doit toujours s'équilibrer.",
  partieDouble: "Chaque opération est enregistrée deux fois, en débit et en crédit, pour un même montant.",
  imputation: "Rattachement d'un paiement à la période (mois) ou à la dette qu'il règle.",
};

export function Term({ k, children, className }: { k: keyof typeof GLOSSARY; children: React.ReactNode; className?: string }) {
  return (
    <abbr title={GLOSSARY[k]} className={cn("cursor-help underline decoration-dotted decoration-ink-faint underline-offset-2", className)}>
      {children}
    </abbr>
  );
}
