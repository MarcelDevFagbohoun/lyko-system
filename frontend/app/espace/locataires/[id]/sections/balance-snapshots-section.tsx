"use client";

import { SectionTile } from "@/components/ui/section-tile";
import * as React from "react";
import { getLeaseBalanceSnapshots, type Lease, type LeaseBalanceSnapshot } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";


/**
 * Historique des soldes figés à chaque clôture de mois (audit) — voir
 * `lease_balance_snapshots`. Purement informatif, jamais modifiable ; ne
 * s'affiche qu'une fois qu'au moins un mois a été clôturé depuis que ce
 * bail existe.
 */
export function BalanceSnapshotsSection({ leaseId, accessToken }: { leaseId: number; accessToken: string | null }) {
  const [snapshots, setSnapshots] = React.useState<LeaseBalanceSnapshot[] | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    getLeaseBalanceSnapshots(accessToken, leaseId).then((res) => setSnapshots(res.snapshots));
  }, [accessToken, leaseId]);

  if (!snapshots || snapshots.length === 0) return null;

  return (
    <SectionTile tone="violet">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left font-label-sm uppercase tracking-wider text-ink-muted"
      >
        Historique des soldes en fin de mois
        <span className="text-body-xs normal-case tracking-normal text-ink-muted">{open ? "Masquer" : "Afficher"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {snapshots.map((s) => (
            <div key={s.period} className="flex items-center justify-between text-body-sm">
              <span className="text-ink-soft">{s.period}</span>
              <span className="tabular font-currency-table text-ink">{formatFcfa(s.amountDue)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionTile>
  );
}

// Regroupement par mois de loyer concerné (fonction de module : stable entre les rendus).
export const leasePaymentMonth = (p: Lease["payments"][number]) => p.coversMonth;

