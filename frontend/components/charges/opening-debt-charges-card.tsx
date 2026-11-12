"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getOpeningDebtCharges, type OpeningDebtChargeItem } from "@/lib/api/charges";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CADRES } from "@/lib/module-theme";

/**
 * Impayés à l'entrée SBEE/SONEB encore dus (demande utilisateur, 2026-11-12 : « si c'est SBEE dans
 * les charges ») — un locataire déjà en place peut avoir déclaré, à son onboarding, des factures
 * SBEE/SONEB antérieures non réglées (voir `OpeningDebtItemsFields`). Lecture seule : le règlement
 * se fait depuis la fiche du locataire (section « Impayés à l'entrée »), ce lien y mène directement.
 * `hideWhenEmpty` : sur l'accueil, aucune place n'est prise quand il n'y en a pas.
 */
export function OpeningDebtChargesCard({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { accessToken } = useAuth();
  const [items, setItems] = React.useState<OpeningDebtChargeItem[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    getOpeningDebtCharges(accessToken)
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true));
  }, [accessToken]);

  if (failed || items === null) return null;
  if (items.length === 0) {
    if (hideWhenEmpty) return null;
    return null;
  }

  const total = items.reduce((sum, it) => sum + it.remaining, 0);

  return (
    <Card tone={CADRES.finances.tone}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt size={18} className="text-primary" />
          Impayés à l&apos;entrée — SBEE / SONEB
          <Badge variant="warning">{formatFcfa(total)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-body-xs text-ink-muted">
          Déclarés à l&apos;onboarding d&apos;un ancien locataire — à régler depuis sa fiche.
        </p>
        {items.map((it) => (
          <Link
            key={it.itemId}
            href={`/espace/locataires/${it.renterId}`}
            className="group flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted"
          >
            <div className="min-w-0 flex-1">
              <p className="font-label-md text-ink">
                {it.renterName} — {it.unitCode} ({it.propertyCode})
              </p>
              <p className="text-body-xs text-ink-muted">
                {it.debtTypeLabel} {monthLabelFr(it.periodMonth)}
                {it.label ? ` — ${it.label}` : ""}
              </p>
            </div>
            <span className="tabular font-currency-table text-body-sm text-danger-fg">{formatFcfa(it.remaining)}</span>
            <ArrowRight size={14} className="mt-1 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
