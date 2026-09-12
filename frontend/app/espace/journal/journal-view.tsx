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
import { listActivity, type ActivityEntry } from "@/lib/api/dashboard";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
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
 * Journal d'activité (étape 10, DG uniquement) : généralise le « Journal
 * des suppressions » (étape 8) à toutes les actions tracées — créations,
 * paiements, versements, plaintes, clôtures... Chaque module continue de
 * poser ses propres colonnes d'auteur/horodatage ; ce journal les lit sans
 * nouvelle table.
 */
export function JournalView() {
  return (
    <RequireAuth roles={["dg"]}>
      <JournalContent />
    </RequireAuth>
  );
}

function JournalContent() {
  const { accessToken } = useAuth();
  const [entries, setEntries] = React.useState<ActivityEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listActivity(accessToken, 100)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal d'activité."));
  }, [accessToken]);

  return (
    <div className="min-h-screen bg-canvas">
      <EspaceHeader />
      <div className="content-shell flex flex-col gap-6 py-10">
        <div>
          <h1 className="font-display text-headline-xl text-ink">Journal d&apos;activité</h1>
          <p className="text-body-md text-ink-soft">
            Les dernières actions enregistrées dans votre espace, tous modules confondus.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
            <CardDescription>Les 100 dernières actions, les plus récentes d&apos;abord.</CardDescription>
          </CardHeader>
          <CardContent>
            {entries === null && !error ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : entries && entries.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
                <History size={16} /> Aucune activité enregistrée pour l&apos;instant.
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
                          {e.actor ? `${e.actor.name} (${e.actor.roleLabel})` : "Auteur inconnu"} ·{" "}
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
