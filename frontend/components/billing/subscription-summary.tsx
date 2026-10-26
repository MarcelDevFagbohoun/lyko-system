import { Check, Minus } from "lucide-react";
import { FEATURE_LABELS, FEATURE_ORDER, offerLabel, type PublicPlan, type Subscription } from "@/lib/api/billing";
import { limitsSummary } from "@/lib/billing-plans";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMeter } from "@/components/billing/usage-meter";
import { cn, formatDateLabel } from "@/lib/utils";

/** « Votre offre » : où j'en suis (offre, échéance, consommation, fonctions incluses). */
export function SubscriptionSummary({ plan, sub }: { plan: PublicPlan; sub: Subscription }) {
  const totalDays = sub.periodMonths ? sub.periodMonths * 30 : null;
  const daysLeft = sub.daysLeft === null ? null : Math.max(0, sub.daysLeft);
  const remainingRatio = totalDays && daysLeft !== null ? Math.min(1, daysLeft / totalDays) : null;
  const endingSoon = daysLeft !== null && daysLeft <= 7;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Offre {plan.label}</CardTitle>
          <Badge variant={endingSoon ? "warning" : "success"}>{endingSoon ? "Se termine bientôt" : "Actif"}</Badge>
          {sub.founderPrice && <Badge variant="info">Tarif fondateur</Badge>}
        </div>
        <CardDescription>
          {sub.currentPeriodEnd ? `Valable jusqu'au ${formatDateLabel(sub.currentPeriodEnd.slice(0, 10))}` : "Sans échéance"}
          {sub.periodMonths ? ` · dernière période : ${offerLabel(sub.periodMonths)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          {daysLeft !== null && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm text-ink-soft">Temps restant</span>
                <span className={cn("font-label-md", endingSoon ? "text-warning-fg" : "text-ink")}>
                  {daysLeft} jour{daysLeft > 1 ? "s" : ""}
                </span>
              </div>
              {remainingRatio !== null && (
                <div
                  role="progressbar"
                  aria-label={`${daysLeft} jours restants`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(remainingRatio * 100)}
                  className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                >
                  <div className={cn("h-full rounded-full", endingSoon ? "bg-warning-fg" : "bg-primary")} style={{ width: `${remainingRatio * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {sub.usage && (
            <div className="flex flex-col gap-3">
              <UsageMeter label="Unités" used={sub.usage.units} max={plan.limits.units} />
              <UsageMeter label="Propriétaires" used={sub.usage.owners} max={plan.limits.owners} />
              <UsageMeter label="Utilisateurs" used={sub.usage.users} max={plan.limits.users} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-label-md text-ink">Inclus dans votre offre</p>
          <p className="text-body-sm text-ink-muted">
            {limitsSummary(plan.limits)}
          </p>
          <ul className="flex flex-col gap-1.5 text-body-sm text-ink-soft">
            {FEATURE_ORDER.filter((k) => plan.features.includes(k)).map((k) => (
              <li key={k} className="flex gap-2">
                <Check size={14} className="mt-1 shrink-0 text-success-fg" />
                {FEATURE_LABELS[k]}
              </li>
            ))}
            <li className="flex gap-2 text-ink-faint">
              <Minus size={14} className="mt-1 shrink-0" />
              <span>{FEATURE_LABELS.ai_assistant} <Badge variant="neutral">Bientôt disponible</Badge></span>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
