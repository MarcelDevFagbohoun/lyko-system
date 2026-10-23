"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { FEATURE_LABELS, limitLabel, offerLabel, type Catalog, type PlanKey, type PublicPlan } from "@/lib/api/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatFcfa } from "@/lib/utils";

const ORDER_FEATURES = ["core", "tenant_collect", "payroll", "payouts", "owner_portal", "sale_properties", "advanced_accounting", "audit_full", "ai_assistant"];

/**
 * Grille des offres. `onChoose(plan, months)` : affiche un bouton par durée (espace connecté) ; sans lui, un seul bouton
 * « Créer mon compte » est rendu par le parent via `footer` (page publique). Les prix viennent du serveur (catalogue) —
 * le tarif fondateur n'y est affiché que tant qu'il reste des places.
 */
export function PlanCards({
  catalog,
  onChoose,
  busyKey,
  footer,
  currentPlan,
}: {
  catalog: Catalog;
  onChoose?: (plan: PlanKey, months: number) => void;
  busyKey?: string | null;
  footer?: (plan: PublicPlan) => React.ReactNode;
  currentPlan?: string | null;
}) {
  const f = catalog.founder;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {catalog.plans.map((plan) => (
        <Card key={plan.key} className={cn("flex flex-col", plan.featured && "border-primary ring-1 ring-primary")}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{plan.label}</CardTitle>
              <div className="flex gap-1.5">
                {currentPlan === plan.key && <Badge variant="success">Offre actuelle</Badge>}
                {plan.featured && <Badge variant="primary">Recommandé</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              {plan.offers.map((o) => {
                const isFounder = f.remaining > 0 && plan.key === f.planKey && o.months === f.months;
                return (
                  <div key={o.months} className="flex items-baseline justify-between gap-2">
                    <span className="text-body-sm text-ink-muted">{offerLabel(o.months)}</span>
                    <span className="text-right">
                      {isFounder && <span className="mr-2 text-body-xs text-ink-faint line-through">{formatFcfa(o.price)}</span>}
                      <span className="font-display text-headline-sm text-ink">{formatFcfa(isFounder ? f.price : o.price)}</span>
                    </span>
                  </div>
                );
              })}
              {f.remaining > 0 && plan.key === f.planKey && (
                <p className="text-body-xs text-success-fg">
                  Tarif fondateur sur le premier achat de {offerLabel(f.months)} : plus que {f.remaining} place{f.remaining > 1 ? "s" : ""}.
                </p>
              )}
            </div>
            <ul className="flex flex-col gap-1.5 text-body-sm text-ink-soft">
              <li className="font-label-md text-ink">
                {limitLabel(plan.limits.units)} unités · {limitLabel(plan.limits.owners)} propriétaires · {limitLabel(plan.limits.users)} utilisateurs
              </li>
              {ORDER_FEATURES.filter((k) => plan.features.includes(k)).map((k) => (
                <li key={k} className="flex gap-2">
                  <Check size={14} className="mt-1 shrink-0 text-success-fg" />
                  {FEATURE_LABELS[k]}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-col gap-2 pt-2">
              {onChoose &&
                plan.offers.map((o) => (
                  <Button
                    key={o.months}
                    variant={plan.featured ? "primary" : "secondary"}
                    disabled={!!busyKey}
                    onClick={() => onChoose(plan.key, o.months)}
                  >
                    {busyKey === `${plan.key}:${o.months}` ? "Redirection…" : `Choisir ${offerLabel(o.months)}`}
                  </Button>
                ))}
              {footer?.(plan)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
