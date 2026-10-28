"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listComplaints, type Complaint, type ComplaintStatus } from "@/lib/api/complaints";
import { COMPLAINT_PRIORITY_LABELS, COMPLAINT_STATUS_LABELS, COMPLAINT_STATUS_BADGE_VARIANT } from "@/lib/constants/complaints";
import { ApiError } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn, formatDateLabel, formatDateTimeLabel } from "@/lib/utils";

const TABS: { key: ComplaintStatus | "all"; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "non_resolue", label: "Non résolues" },
  { key: "resolue", label: "Résolues" },
];

export function PlaintesView() {
  return (
    <RequireAuth permission="plaintes">
      <PlaintesContent />
    </RequireAuth>
  );
}

function PlaintesContent() {
  const { accessToken } = useAuth();
  const [tab, setTab] = React.useState<ComplaintStatus | "all">("all");
  const [query, setQuery] = React.useState("");
  const [complaints, setComplaints] = React.useState<Complaint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listComplaints(accessToken, { status: tab === "all" ? undefined : tab, q: query || undefined })
      .then((res) => setComplaints(res.complaints))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les plaintes."));
  }, [accessToken, tab, query]);

  React.useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Plaintes & réclamations</h1>
            <p className="text-body-md text-ink-soft">Incidents signalés par les locataires et suivi de leur résolution.</p>
          </div>
          <Link href="/espace/plaintes/nouveau" className="w-fit">
            <Button>
              <Plus size={18} />
              Nouvelle plainte
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-label-sm transition-colors",
                  tab === t.key
                    ? "border-primary bg-surface-muted text-ink"
                    : "border-border text-ink-soft hover:bg-surface-hover",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative max-w-xs flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher (réf., titre, locataire)"
              className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {complaints === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : complaints && complaints.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucune plainte pour le moment</p>
              <Link href="/espace/plaintes/nouveau">
                <Button variant="warning">Déclarer la première plainte</Button>
              </Link>
            </CardContent>
          </Card>
        ) : complaints ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Dossier</TableHead>
                <TableHead>Locataire</TableHead>
                <TableHead>Bien / unité</TableHead>
                <TableHead>Priorité</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {complaints.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/espace/plaintes/${c.id}`} className="font-label-md text-ink hover:text-primary hover:underline">{c.code}</Link>
                    <div className="text-body-xs text-ink-muted">{c.title}</div>
                    <div className="text-body-xs text-ink-faint">Signalée le {formatDateLabel(c.reportedAt)}</div>
                    <div className="text-body-xs text-ink-faint">Mise à jour le {formatDateTimeLabel(c.lastActivityAt)}</div>
                    {c.lastByTenant && (
                      <Badge variant="warning" className="mt-1">Réponse du locataire</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-ink-soft">{c.renter.firstName} {c.renter.lastName}</TableCell>
                  <TableCell className="text-ink-soft">
                    {c.property.code} · {c.unit.code}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.priority === "urgente" ? "danger" : "neutral"} dot={c.priority === "urgente"}>
                      {COMPLAINT_PRIORITY_LABELS[c.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={COMPLAINT_STATUS_BADGE_VARIANT[c.status]}>{COMPLAINT_STATUS_LABELS[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/espace/plaintes/${c.id}`}>
                      <Button variant="ghost" size="sm">Voir le dossier</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
