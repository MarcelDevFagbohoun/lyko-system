"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Building2, List, MapPin, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listProperties, type PropertyListItem } from "@/lib/api/properties";
import { PROPERTY_TYPE_LABELS } from "@/lib/constants/properties";
import { ApiError } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PortfolioMap = dynamic(() => import("@/components/properties/portfolio-map"), {
  ssr: false,
  loading: () => <div className="flex h-[480px] items-center justify-center rounded-lg border border-border-strong bg-surface-muted text-body-sm text-ink-muted">Chargement de la carte…</div>,
});

export function BiensView() {
  return (
    <RequireAuth permission={["locataires", "proprietaires"]}>
      <BiensContent />
    </RequireAuth>
  );
}

function BiensContent() {
  const { accessToken, user } = useAuth();
  const isDg = user?.role === "dg";
  const [query, setQuery] = React.useState("");
  const [properties, setProperties] = React.useState<PropertyListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"liste" | "carte">("liste");

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listProperties(accessToken, query)
      .then((res) => setProperties(res.properties))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les biens."));
  }, [accessToken, query]);

  React.useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Nos biens</h1>
            <p className="text-body-md text-ink-soft">Immeubles, villas et maisons, avec leurs unités locatives.</p>
          </div>
          <Link href="/espace/biens/nouveau" className="w-fit">
            <Button>
              <Plus size={18} />
              Nouveau bien
            </Button>
          </Link>
        </div>

        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par propriétaire ou code (ex. BIEN-001)"
              className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <div className="inline-flex w-fit rounded-lg border border-border-strong bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setView("liste")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-body-sm ${view === "liste" ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
            >
              <List size={14} />
              Liste
            </button>
            <button
              type="button"
              onClick={() => setView("carte")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-body-sm ${view === "carte" ? "bg-primary text-primary-fg" : "text-ink-soft"}`}
            >
              <MapPin size={14} />
              Carte
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {view === "carte" && (
          properties === null && !error ? (
            <p className="text-body-sm text-ink-muted">Chargement…</p>
          ) : properties && properties.length > 0 ? (
            <div className="flex flex-col gap-3">
              {(() => {
                const withoutCoords = properties.filter((p) => p.latitude == null || p.longitude == null).length;
                return withoutCoords > 0 ? (
                  <p className="text-body-sm text-ink-muted">
                    {withoutCoords} bien{withoutCoords > 1 ? "s" : ""} sans coordonnées GPS — non affiché{withoutCoords > 1 ? "s" : ""} sur la carte. Ouvrez la fiche d&apos;un bien pour placer son repère.
                  </p>
                ) : null;
              })()}
              <PortfolioMap properties={properties} />
            </div>
          ) : properties ? (
            <p className="text-body-sm text-ink-muted">Aucun bien pour le moment.</p>
          ) : null
        )}

        {view !== "liste" ? null : properties === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : properties && properties.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Building2 size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">
                {query ? "Aucun bien ne correspond à cette recherche" : "Aucun bien pour le moment"}
              </p>
              {!query && (
                <Link href="/espace/biens/nouveau">
                  <Button variant="secondary">Créer le premier bien</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : properties ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Bien</TableHead>
                <TableHead>Propriétaire</TableHead>
                <TableHead>Type</TableHead>
                {isDg && <TableHead>Agent</TableHead>}
                <TableHead className="text-center">Unités</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {properties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-label-md text-ink">{p.code}</div>
                    {p.address && <div className="text-body-xs text-ink-muted">{p.address}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="text-ink">{p.owner.name}</div>
                    {p.owner.phone && <div className="text-body-xs text-ink-muted">{p.owner.phone}</div>}
                  </TableCell>
                  <TableCell className="text-ink-soft">{PROPERTY_TYPE_LABELS[p.type]}</TableCell>
                  {isDg && (
                    <TableCell className="text-ink-soft">
                      {p.agent ? p.agent.name : <span className="text-ink-faint">Tout agent</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <Badge variant={p.unitsFree > 0 ? "success" : "neutral"}>
                      {p.unitsFree}/{p.unitsCount} libre{p.unitsFree > 1 ? "s" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/espace/biens/${p.id}`}>
                      <Button variant="ghost" size="sm">
                        Voir le détail
                      </Button>
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
