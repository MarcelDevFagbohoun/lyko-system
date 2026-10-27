import { Handshake } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Pastille « Partenaire » : affichée partout où l'abonnement d'une entreprise partenaire apparaît. */
export function PartnerBadge({ className }: { className?: string }) {
  return (
    <Badge variant="primary" className={className} data-testid="partner-badge">
      <Handshake size={12} aria-hidden />
      Partenaire
    </Badge>
  );
}
