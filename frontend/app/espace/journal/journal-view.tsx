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
  RotateCcw,
  Percent,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { listActivity, type ActivityEntry } from "@/lib/api/dashboard";
import { RequireAuth } from "@/components/auth/require-auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TYPE_ICON: Record<string, React.ElementType> = {
  renter_created: UserPlus,
  owner_created: UserPlus,
  property_created: Building2,
  unit_created: Building2,
  lease_created: FileSignature,
  rent_payment_recorded: Receipt,
  owner_payout_recorded: Wallet,
  charge_remittance_recorded: Wallet,
  charge_remittance_cancelled: Trash2,
  main_invoice_payment_declared: Droplets,
  expense_recorded: Wallet,
  expense_deleted: Trash2,
  charge_recorded: Droplets,
  charge_deleted: Trash2,
  complaint_reported: AlertTriangle,
  complaint_resolved: CheckCircle2,
  move_in_conducted: ClipboardCheck,
  move_out_conducted: DoorOpen,
  move_in_reopened: RotateCcw,
  move_out_reopened: RotateCcw,
  period_closed: Lock,
  commission_rate_changed: Percent,
};

// Labels FR des types d'activité produits par `listRecentActivity`
// (backend/src/services/activity.js) — source du filtre « Type d'activité ».
const TYPE_LABELS: Record<string, string> = {
  renter_created: "Locataire créé",
  owner_created: "Propriétaire créé",
  property_created: "Bien créé",
  unit_created: "Unité créée",
  lease_created: "Bail signé",
  rent_payment_recorded: "Paiement de loyer",
  owner_payout_recorded: "Versement propriétaire",
  expense_recorded: "Dépense enregistrée",
  expense_deleted: "Dépense supprimée",
  charge_recorded: "Charge SONEB/SBEE enregistrée",
  charge_deleted: "Charge SONEB/SBEE supprimée",
  complaint_reported: "Plainte signalée",
  complaint_resolved: "Plainte résolue",
  move_in_conducted: "État des lieux d'entrée",
  move_out_conducted: "État des lieux de sortie",
  move_in_reopened: "État des lieux d'entrée rouvert",
  move_out_reopened: "État des lieux de sortie rouvert",
  period_closed: "Mois clôturé",
  commission_rate_changed: "Taux de commission modifié",
  charge_remittance_recorded: "Reversement de charges",
  charge_remittance_cancelled: "Reversement de charges annulé",
  main_invoice_payment_declared: "Facture mère déclarée payée",
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
  const [date, setDate] = React.useState("");
  const [month, setMonth] = React.useState("");
  const [type, setType] = React.useState("");

  const hasFilters = Boolean(date || month || type);

  React.useEffect(() => {
    if (!accessToken) return;
    setEntries(null);
    listActivity(accessToken, { limit: 100, date: date || undefined, month: month || undefined, type: type || undefined })
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le journal d'activité."));
  }, [accessToken, date, month, type]);

  const resetFilters = () => {
    setDate("");
    setMonth("");
    setType("");
  };

  return (
    <div className="min-h-screen bg-canvas">
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
            <CardDescription>
              {hasFilters ? "Les actions correspondant à vos filtres, les plus récentes d'abord." : "Les 100 dernières actions, les plus récentes d'abord."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="journal-date" className="text-body-xs font-medium text-ink-muted">Jour</label>
                <input
                  id="journal-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    if (e.target.value) setMonth("");
                  }}
                  className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="journal-month" className="text-body-xs font-medium text-ink-muted">Mois</label>
                <input
                  id="journal-month"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    if (e.target.value) setDate("");
                  }}
                  className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="journal-type" className="text-body-xs font-medium text-ink-muted">Type d&apos;activité</label>
                <select
                  id="journal-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="h-[38px] min-w-[220px] rounded border border-border-strong bg-surface px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="">Tous les types</option>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              {hasFilters && (
                <Button type="button" variant="ghost" onClick={resetFilters} className="gap-1.5">
                  <X size={14} /> Réinitialiser
                </Button>
              )}
            </div>

            {entries === null && !error ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : entries && entries.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-body-sm text-ink-muted">
                <History size={16} /> {hasFilters ? "Aucune activité ne correspond à ces filtres." : "Aucune activité enregistrée pour l'instant."}
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
