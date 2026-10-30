"use client";

import { SectionTile } from "@/components/ui/section-tile";
import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listCharges, type UtilityCharge } from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, CHARGE_STATUS_LABELS } from "@/lib/constants/charges";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { countLabel } from "@/components/ui/month-group";
import { groupByMonth, sumBy } from "@/lib/group-by-month";
import { Button } from "@/components/ui/button";
import { useCan } from "@/lib/auth/use-can";


/**
 * Charges SONEB/SBEE rattachées à ce bail (étape 9). Permission dédiée
 * `charges` — distincte de `locataires` ET de `comptabilite`, par défaut
 * réservée au comptable (catalogue de permissions de l'étape 3).
 */
export function ChargesSection({
  leaseId,
  renterId,
  accessToken,
}: {
  leaseId: number;
  renterId: number;
  accessToken: string | null;
}) {
  const canView = useCan("charges");
  const [charges, setCharges] = React.useState<UtilityCharge[] | null>(null);

  React.useEffect(() => {
    if (!accessToken || !canView) return;
    listCharges(accessToken, { leaseId }).then((res) => setCharges(res.charges));
  }, [accessToken, leaseId, canView]);

  if (!canView) return null;

  return (
    <SectionTile tone="cyan">
      <div className="flex items-center justify-between">
        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Charges SONEB & SBEE</span>
        <Link href={`/espace/charges/nouveau?renterId=${renterId}`}>
          <Button variant="info" size="sm">
            <Plus size={14} />
            Nouvelle charge
          </Button>
        </Link>
      </div>

      {charges === null ? (
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      ) : charges.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Aucune charge SONEB/SBEE enregistrée pour ce bail.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByMonth(charges, (c) => c.periodStart).map((g) => {
            const remaining = sumBy(g.items, (c) => c.remainingAmount);
            return (
              <div key={g.month || "sans-date"} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-1">
                  <span className="font-label-md capitalize text-ink">{g.month ? monthLabelFr(g.month) : "Sans date"}</span>
                  <span className="text-body-xs text-ink-muted">
                    {countLabel(g.items.length, "facture")} · {formatFcfa(sumBy(g.items, (c) => c.amount))}
                    {remaining > 0 ? ` · reste ${formatFcfa(remaining)}` : " · tout réglé"}
                  </span>
                </div>
                {g.items.map((c) => (
                  <Link
                    key={c.id}
                    href="/espace/charges"
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 hover:bg-surface-muted"
                  >
                    <div>
                      <p className="font-label-sm text-ink">
                        {UTILITY_TYPE_LABELS[c.utilityType]} — {c.periodStart} → {c.periodEnd}
                      </p>
                      <p className="text-body-xs text-ink-muted">{formatFcfa(c.amount)} · facturé le {c.billedAt}</p>
                    </div>
                    <Badge variant={c.status === "payee" ? "success" : c.status === "partiellement_payee" ? "info" : "warning"}>
                      {CHARGE_STATUS_LABELS[c.status]}
                    </Badge>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </SectionTile>
  );
}

/**
 * Pénalités de retard déjà appliquées — l'action « Appliquer une pénalité »
 * vit dans le Centre de relance, à côté de la relance WhatsApp du même
 * locataire ; ici, chacune affiche désormais son statut de règlement (étape
 * 44bis : une pénalité peut être réglée totalement ou partiellement, comme
 * les impayés à l'entrée ci-dessous) avec un formulaire pour l'enregistrer.
 */
