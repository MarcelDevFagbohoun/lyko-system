"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RequireAuth } from "@/components/auth/require-auth";
import { UtilityPointPanel } from "@/components/charges/utility-point-panel";
import { UtilityAlertsCard } from "@/components/charges/utility-alerts-card";

export function PointView() {
  return (
    <RequireAuth permission="charges">
      <div className="min-h-screen bg-canvas">
        <div className="content-shell flex flex-col gap-6 py-10">
          <Link href="/espace/charges" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
            <ArrowLeft size={16} />
            Retour aux charges
          </Link>
          <div>
            <h1 className="font-display text-headline-xl text-ink">Le point des charges</h1>
            <p className="text-body-md text-ink-soft">
              Pour chaque propriétaire : la facture mère qu&apos;il a payée à la SONEB/SBEE face à ce que le cabinet a
              encaissé chez les locataires, et ce qu&apos;il reste à sa charge.
            </p>
          </div>
          <UtilityAlertsCard />
          <UtilityPointPanel />
        </div>
      </div>
    </RequireAuth>
  );
}
