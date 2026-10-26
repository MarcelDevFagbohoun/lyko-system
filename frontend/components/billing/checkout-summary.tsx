import { offerLabel, type Catalog, type Quote } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFcfa } from "@/lib/utils";

const KIND_TITLE = { purchase: "Nouvel abonnement", renewal: "Renouvellement", upgrade: "Changement d'offre" } as const;

/** Récapitulatif avant paiement : ce que l'on achète, le détail du prix, la garantie, puis le paiement. */
export function CheckoutSummary({
  quote, catalog, paying, onPay, onCancel,
}: {
  quote: Quote;
  catalog: Catalog;
  paying: boolean;
  onPay: () => void;
  onCancel: () => void;
}) {
  const planLabel = catalog.plans.find((p) => p.key === quote.planKey)?.label;
  const fromLabel = quote.fromPlan ? catalog.plans.find((p) => p.key === quote.fromPlan)?.label : null;
  return (
    <Card className="border-primary">
      <CardHeader>
        <CardTitle>{KIND_TITLE[quote.kind]}</CardTitle>
        <CardDescription>
          Offre {planLabel}, {offerLabel(quote.months)}
          {quote.kind === "upgrade" && fromLabel ? ` (depuis ${fromLabel})` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-1.5 text-body-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Prix de l&apos;offre</dt>
            <dd className="text-ink">{formatFcfa(quote.normalPrice)}</dd>
          </div>
          {quote.fullPrice < quote.normalPrice && (
            <div className="flex justify-between gap-3 text-success-fg">
              <dt>{quote.founder ? "Tarif fondateur" : "Offre promotionnelle"}</dt>
              <dd>−{formatFcfa(quote.normalPrice - quote.fullPrice)}</dd>
            </div>
          )}
          {quote.kind === "upgrade" && (
            <div className="flex justify-between gap-3 text-success-fg">
              <dt>Crédit de votre abonnement actuel ({quote.creditDays} jour{quote.creditDays > 1 ? "s" : ""} restants)</dt>
              <dd>−{formatFcfa(quote.credit)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <dt className="font-label-md text-ink">À payer</dt>
            <dd className="font-display text-headline-md text-ink">{formatFcfa(quote.price)}</dd>
          </div>
        </dl>
        {quote.kind === "upgrade" && <p className="text-body-sm text-ink-muted">La nouvelle offre démarre tout de suite.</p>}
        {quote.kind === "renewal" && <p className="text-body-sm text-ink-muted">Le renouvellement s&apos;ajoute à la fin de votre période actuelle.</p>}
        {quote.isFirstPurchase && (
          <p className="text-body-sm text-ink-muted">
            Garantie : remboursement possible pendant {catalog.refundWindowDays} jours, frais du prestataire de paiement déduits.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onPay} disabled={paying}>{paying ? "Redirection…" : "Payer avec Mobile Money / carte"}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={paying}>Annuler</Button>
        </div>
      </CardContent>
    </Card>
  );
}
