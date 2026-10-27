import { Check, Minus } from "lucide-react";
import { FEATURE_LABELS, FEATURE_ORDER, offerLabel, type Subscription } from "@/lib/api/billing";
import { limitsSummary } from "@/lib/billing-plans";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PartnerBadge } from "@/components/billing/partner-badge";
import { UsageMeter } from "@/components/billing/usage-meter";
import { cn, formatDateLabel } from "@/lib/utils";

/** « Votre abonnement partenaire » : badge, échéance, fonctions accordées. Aucun prix : l'abonnement est offert. */
export function PartnerSummary({ sub }: { sub: Subscription }) {
  const partner = sub.partner;
  if (!partner) return null;
  const daysLeft = sub.daysLeft === null ? null : Math.max(0, sub.daysLeft);
  const endingSoon = daysLeft !== null && daysLeft <= 7;
  const included = FEATURE_ORDER.filter((k) => partner.features.includes(k));
  const excluded = FEATURE_ORDER.filter((k) => !partner.features.includes(k));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Abonnement partenaire</CardTitle>
          <PartnerBadge />
          <Badge variant={endingSoon ? "warning" : "success"}>{endingSoon ? "Se termine bientôt" : "Actif"}</Badge>
        </div>
        <CardDescription>
          {sub.currentPeriodEnd ? `Offert jusqu'au ${formatDateLabel(sub.currentPeriodEnd.slice(0, 10))}` : "Sans échéance"}
          {sub.periodMonths ? ` · dernière attribution : ${offerLabel(sub.periodMonths)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          {daysLeft !== null && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-sm text-ink-soft">Temps restant</span>
              <span className={cn("font-label-md", endingSoon ? "text-warning-fg" : "text-ink")}>
                {daysLeft} jour{daysLeft > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {sub.usage && (
            <div className="flex flex-col gap-3">
              <UsageMeter label="Unités" used={sub.usage.units} max={partner.limits.units} />
              <UsageMeter label="Propriétaires" used={sub.usage.owners} max={partner.limits.owners} />
              <UsageMeter label="Utilisateurs" used={sub.usage.users} max={partner.limits.users} />
            </div>
          )}
          <p className="text-body-sm text-ink-muted">
            Aucun paiement n&apos;est nécessaire pendant cette période. À son terme, vous pourrez choisir une offre sur cette page.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-label-md text-ink">Fonctions accordées</p>
          <p className="text-body-sm text-ink-muted">{limitsSummary(partner.limits)}</p>
          <ul className="flex flex-col gap-1.5 text-body-sm text-ink-soft">
            {included.map((k) => (
              <li key={k} className="flex gap-2">
                <Check size={14} className="mt-1 shrink-0 text-success-fg" />
                {FEATURE_LABELS[k]}
              </li>
            ))}
            {excluded.map((k) => (
              <li key={k} className="flex gap-2 text-ink-faint">
                <Minus size={14} className="mt-1 shrink-0" />
                {FEATURE_LABELS[k]}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
