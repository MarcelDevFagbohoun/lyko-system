"use client";

import * as React from "react";
import {
  History,
  UserPlus,
  Building2,
  DoorOpen,
  FileSignature,
  Receipt,
  Wallet,
  Droplets,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { getMyHistory } from "@/lib/api/history";
import type { ActivityEntry } from "@/lib/api/dashboard";
import { RequireAuth } from "@/components/auth/require-auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const TYPE_ICON: Record<string, React.ElementType> = {
  renter_created: UserPlus,
  owner_created: UserPlus,
  property_created: Building2,
  unit_created: Building2,
  lease_created: FileSignature,
  rent_payment_recorded: Receipt,
  owner_payout_recorded: Wallet,
  expense_recorded: Wallet,
  expense_deleted: Trash2,
  charge_recorded: Droplets,
  charge_deleted: Trash2,
  complaint_reported: AlertTriangle,
  complaint_resolved: CheckCircle2,
  move_in_conducted: ClipboardCheck,
  move_out_conducted: DoorOpen,
  period_closed: Lock,
};

/**
 * Historique personnel (étape 18, comptable/agent) : version filtrée à
 * l'auteur connecté du « Journal d'activité » DG (étape 10) — même liste
 * d'événements possibles, réutilise `listRecentActivity` côté serveur avec
 * un filtre par auteur plutôt qu'un calcul séparé.
 */
export function HistoriqueView() {
  return (
    <RequireAuth roles={["comptable", "agent"]}>
      <HistoriqueContent />
    </RequireAuth>
  );
}

function HistoriqueContent() {
  const { accessToken } = useAuth();
  const [entries, setEntries] = React.useState<ActivityEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    getMyHistory(accessToken, 100)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger l'historique."));
  }, [accessToken]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Mon historique</h1>
          <p className="text-body-md text-ink-soft">
            Les actions que vous avez personnellement enregistrées, tous modules confondus.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Mes actions récentes</CardTitle>
            <CardDescription>Les 100 dernières actions que vous avez effectuées, les plus récentes d&apos;abord.</CardDescription>
          </CardHeader>
          <CardContent>
            {entries === null && !error ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : entries && entries.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
                <History size={16} /> Aucune action enregistrée pour l&apos;instant.
              </p>
            ) : entries ? (
              <div className="flex flex-col divide-y divide-border">
                {entries.map((e, i) => {
                  const Icon = TYPE_ICON[e.type] ?? History;
                  return (
                    <div key={i} className="flex items-start gap-3 py-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
                        <Icon size={15} />
                      </div>
                      <div className="flex-1">
                        <p className="text-body-sm text-ink">{e.label}</p>
                        <p className="text-body-xs text-ink-muted">
                          {new Date(e.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
