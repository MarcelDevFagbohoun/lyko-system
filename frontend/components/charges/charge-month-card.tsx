"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getChargeMonthSummary, type ChargeMonthSummary } from "@/lib/api/charges";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedBar } from "@/components/ui/segmented-bar";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * « Ce mois-ci » côté charges SONEB/SBEE : ce qui a été facturé dans le mois,
 * ce qui est déjà réglé, ce qu'il reste à recevoir — et, à part, l'argent reçu
 * dans le mois (toutes factures) et ce qui traîne encore des mois précédents.
 */
export function ChargeMonthCard() {
  const { accessToken } = useAuth();
  const [data, setData] = React.useState<ChargeMonthSummary | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getChargeMonthSummary(accessToken)
      .then(setData)
      .catch(() => setData(null));
  }, [accessToken]);

  if (!data) return null;

  const nothing = data.billedCount === 0 && data.receivedCount === 0 && data.olderCount === 0;
  const pct = data.billed > 0 ? Math.round((data.paid / data.billed) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays size={18} className="text-primary" />
            Charges <span className="capitalize">{monthLabelFr(data.month)}</span>
          </CardTitle>
          {data.isCurrentMonth && <Badge variant="primary">Ce mois-ci</Badge>}
        </div>
        <CardDescription>Factures émises ce mois-ci, ce qui est réglé, et ce qu&apos;il reste à recevoir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {nothing ? (
          <p className="text-body-sm text-ink-muted">Aucune facture émise ce mois-ci, rien à recevoir.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Figure label="Facturé" value={formatFcfa(data.billed)} sub={data.billedCount > 0 ? plural(data.billedCount, "facture", "factures") : "aucune facture"} />
              <Figure label="Réglé" value={formatFcfa(data.paid)} sub={data.billed > 0 ? `${pct} % du facturé` : undefined} tone="success" />
              <Figure
                label="Reste à recevoir"
                value={formatFcfa(data.remaining)}
                sub={data.remaining > 0 ? "sur les factures du mois" : data.billed > 0 ? "tout est réglé" : undefined}
                tone={data.remaining > 0 ? "warning" : "success"}
              />
            </div>

            {data.billed > 0 && (
              <SegmentedBar
                ariaLabel={`${pct} % réglé : ${formatFcfa(data.paid)} sur ${formatFcfa(data.billed)} facturés`}
                segments={[
                  { value: data.paid, className: "bg-success-strong", label: "Réglé" },
                  { value: data.remaining, className: "bg-warning-strong", label: "Reste à recevoir" },
                ]}
              />
            )}

            <div className="flex flex-col gap-1 text-body-sm text-ink-soft">
              <span>
                Règlements reçus ce mois-ci (toutes factures) :{" "}
                <strong className="tabular text-ink">{formatFcfa(data.receivedInMonth)}</strong>
                {data.receivedCount > 0 && ` · ${plural(data.receivedCount, "règlement", "règlements")}`}
              </span>
              {data.olderCount > 0 && (
                <span className="text-warning-fg">
                  Encore dû sur les mois précédents : <strong className="tabular">{formatFcfa(data.olderRemaining)}</strong> ·{" "}
                  {plural(data.olderCount, "facture", "factures")}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "text-success-fg" : tone === "warning" ? "text-warning-fg" : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm uppercase tracking-wider text-ink-muted">{label}</span>
      <span className={`tabular font-display text-headline-md ${color}`}>{value}</span>
      {sub && <span className="text-body-xs text-ink-muted">{sub}</span>}
    </div>
  );
}
