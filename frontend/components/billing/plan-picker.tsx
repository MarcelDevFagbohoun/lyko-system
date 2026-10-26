"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import {
  FEATURE_LABELS, FEATURE_ORDER, offerLabel, pricePerMonth,
  type Catalog, type PlanKey, type PublicPlan, type Subscription, type UpgradeOption,
} from "@/lib/api/billing";
import { limitsSummary, planActionLabel, planRelation } from "@/lib/billing-plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatFcfa } from "@/lib/utils";

/**
 * Comparaison des offres : une carte par offre, une durée à choisir sur chaque carte, un bouton dont le sens
 * dépend de l'offre en cours (Choisir / Renouveler / Passer à… / Disponible à l'échéance).
 * Les prix viennent du serveur ; le montant réellement payé est recalculé par le serveur (devis) au clic.
 */
export function PlanPicker({
  catalog,
  sub,
  upgrades,
  firstPurchase,
  busyKey,
  onChoose,
}: {
  catalog: Catalog;
  sub: Subscription | null;
  upgrades: UpgradeOption[];
  /** Aucun paiement encore : le tarif fondateur s'applique au premier achat. */
  firstPurchase: boolean;
  busyKey: string | null;
  onChoose: (plan: PlanKey, months: number) => void;
}) {
  const keys = catalog.plans.map((p) => p.key);
  const currentKey = sub?.active && sub.planKey !== "interne" ? sub.planKey : null;
  const [selected, setSelected] = React.useState<Partial<Record<PlanKey, number>>>({});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {catalog.plans.map((plan) => (
        <PlanCard
          key={plan.key}
          plan={plan}
          catalog={catalog}
          relation={planRelation(keys, currentKey, plan.key)}
          months={selected[plan.key] ?? defaultMonths(plan, sub)}
          onMonths={(m) => setSelected((s) => ({ ...s, [plan.key]: m }))}
          upgrades={upgrades}
          firstPurchase={firstPurchase}
          busy={!!busyKey}
          busyThis={busyKey?.startsWith(`${plan.key}:`) ?? false}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}

/** Durée présélectionnée : la dernière période payée si l'offre la propose, sinon la première. */
function defaultMonths(plan: PublicPlan, sub: Subscription | null) {
  if (sub?.planKey === plan.key && sub.periodMonths && plan.offers.some((o) => o.months === sub.periodMonths)) return sub.periodMonths;
  return plan.offers[0].months;
}

function PlanCard({
  plan, catalog, relation, months, onMonths, upgrades, firstPurchase, busy, busyThis, onChoose,
}: {
  plan: PublicPlan;
  catalog: Catalog;
  relation: ReturnType<typeof planRelation>;
  months: number;
  onMonths: (m: number) => void;
  upgrades: UpgradeOption[];
  firstPurchase: boolean;
  busy: boolean;
  busyThis: boolean;
  onChoose: (plan: PlanKey, months: number) => void;
}) {
  const offer = plan.offers.find((o) => o.months === months) ?? plan.offers[0];
  const f = catalog.founder;
  const isFounder = firstPurchase && f.remaining > 0 && plan.key === f.planKey && offer.months === f.months;
  const price = isFounder ? f.price : offer.price;
  const upgrade = relation === "upgrade" ? upgrades.find((u) => u.planKey === plan.key && u.months === offer.months) : undefined;
  const disabled = busy || relation === "downgrade";

  return (
    <Card className={cn("flex flex-col", plan.featured && relation !== "current" && "border-primary ring-1 ring-primary", relation === "current" && "border-success-border bg-success-bg/20")}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.label}</CardTitle>
          {relation === "current" ? <Badge variant="success">Offre actuelle</Badge> : plan.featured ? <Badge variant="primary">Recommandé</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {plan.offers.length > 1 && (
          <div role="radiogroup" aria-label={`Durée ${plan.label}`} className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-surface-muted p-1">
            {plan.offers.map((o) => (
              <button
                key={o.months}
                type="button"
                role="radio"
                aria-checked={o.months === offer.months}
                onClick={() => onMonths(o.months)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-body-sm transition-colors",
                  o.months === offer.months ? "bg-surface font-label-md text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {offerLabel(o.months)}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-headline-md text-ink">{formatFcfa(price)}</span>
            {isFounder && <span className="text-body-sm text-ink-faint line-through">{formatFcfa(offer.price)}</span>}
            <span className="text-body-sm text-ink-muted">pour {offerLabel(offer.months)}</span>
          </p>
          <p className="text-body-xs text-ink-faint">soit environ {formatFcfa(pricePerMonth({ months: offer.months, price }))} par mois</p>
          {isFounder && (
            <p className="text-body-xs text-success-fg">Tarif fondateur : plus que {f.remaining} place{f.remaining > 1 ? "s" : ""}.</p>
          )}
          {upgrade && (
            <p className="text-body-xs text-success-fg">
              Après déduction de vos {upgrade.creditDays} jour{upgrade.creditDays > 1 ? "s" : ""} restants : {formatFcfa(upgrade.price)}.
            </p>
          )}
        </div>
        <ul className="flex flex-col gap-1.5 text-body-sm text-ink-soft">
          <li className="font-label-md text-ink">
            {limitsSummary(plan.limits)}
          </li>
          {FEATURE_ORDER.filter((k) => plan.features.includes(k)).map((k) => (
            <li key={k} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-success-fg" />{FEATURE_LABELS[k]}</li>
          ))}
          <li className="flex gap-2 text-ink-faint">
            <Minus size={14} className="mt-1 shrink-0" />
            <span>{FEATURE_LABELS.ai_assistant} <Badge variant="neutral">Bientôt disponible</Badge></span>
          </li>
        </ul>
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Button
            variant={relation === "current" || relation === "downgrade" ? "secondary" : plan.featured || relation === "upgrade" ? "primary" : "secondary"}
            disabled={disabled}
            onClick={() => onChoose(plan.key, offer.months)}
          >
            {busyThis ? "Un instant…" : planActionLabel(relation, plan.label)}
          </Button>
          {relation === "downgrade" && (
            <p className="text-body-xs text-ink-muted">Vous pourrez choisir cette offre quand votre abonnement actuel arrivera à son terme.</p>
          )}
          {relation === "current" && (
            <p className="text-body-xs text-ink-muted">Le renouvellement commence à la fin de votre période, sans interruption.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
