"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listProperties, type PropertyListItem } from "@/lib/api/properties";
import { PROPERTY_TYPE_LABELS } from "@/lib/constants/properties";
import { ApiError } from "@/lib/api/client";
import { RequireAuth } from "@/components/auth/require-auth";
import { EspaceHeader } from "@/components/espace/espace-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export function BiensView() {
  return (
    <RequireAuth permission={["locataires", "proprietaires"]}>
      <BiensContent />
    </RequireAuth>
  );
}

function BiensContent() {
  const { accessToken } = useAuth();
  const [query, setQuery] = React.useState("");
  const [properties, setProperties] = React.useState<PropertyListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
      <EspaceHeader />
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

        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par propriétaire ou code (ex. BIEN-001)"
            className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {properties === null && !error ? (
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
