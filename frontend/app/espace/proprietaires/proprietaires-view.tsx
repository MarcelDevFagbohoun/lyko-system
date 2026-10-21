"use client";

import * as React from "react";
import Link from "next/link";
import { UserRound, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listOwners, type OwnerListItem } from "@/lib/api/owners";
import { ApiError } from "@/lib/api/client";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export function ProprietairesView() {
  return (
    <RequireAuth>
      <ProprietairesContent />
    </RequireAuth>
  );
}

function ProprietairesContent() {
  const { accessToken, user } = useAuth();
  const canManage = user?.role === "dg" || (user?.permissions.includes("proprietaires") ?? false);
  const [query, setQuery] = React.useState("");
  const [owners, setOwners] = React.useState<OwnerListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Archive des propriétaires (étape du 2026-10-18) : mandat terminé volontairement par le DG, jamais
  // automatique — voir `proprietaire-view.tsx` pour l'action « Mettre fin au mandat ».
  const [tab, setTab] = React.useState<"actifs" | "archives">("actifs");

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listOwners(accessToken, query)
      .then((res) => setOwners(res.owners))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les propriétaires."));
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
            <h1 className="font-display text-headline-xl text-ink">Gestion Propriétaires</h1>
            <p className="text-body-md text-ink-soft">Bailleurs, leur patrimoine et l&apos;historique des versements.</p>
          </div>
          {canManage && (
            <Link href="/espace/proprietaires/nouveau" className="w-fit">
              <Button>
                <Plus size={18} />
                Nouveau propriétaire
              </Button>
            </Link>
          )}
        </div>

        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par nom"
            className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {owners === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : owners && owners.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <UserRound size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">
                {query ? "Aucun propriétaire ne correspond à cette recherche" : "Aucun propriétaire pour le moment"}
              </p>
              {!query && canManage && (
                <Link href="/espace/proprietaires/nouveau">
                  <Button variant="secondary">Créer le premier propriétaire</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : owners ? (
          <OwnersTable owners={owners} tab={tab} onTabChange={setTab} />
        ) : null}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "rounded-md px-3 py-1.5 font-label-sm transition-colors",
        active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Archive des propriétaires (étape du 2026-10-18, demande utilisateur) : un propriétaire dont le
 * mandat a été terminé par le DG (`mandateEndedAt`, jamais automatique sur « 0 Bien ») passe dans
 * l'onglet « Archivés », à part de la liste active — même principe que les locataires sans bail actif
 * (voir `locataires-view.tsx`). L'onglet Archivés affiche la date/le motif de fin plutôt que des
 * colonnes de patrimoine (toujours à 0 — un mandat ne peut se terminer qu'avec 0 Bien rattaché).
 */
function OwnersTable({
  owners,
  tab,
  onTabChange,
}: {
  owners: OwnerListItem[];
  tab: "actifs" | "archives";
  onTabChange: (tab: "actifs" | "archives") => void;
}) {
  const active = owners.filter((o) => !o.mandateEndedAt);
  const archived = owners.filter((o) => o.mandateEndedAt);
  const shown = tab === "actifs" ? active : archived;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-surface-muted p-1">
        <TabButton active={tab === "actifs"} onClick={() => onTabChange("actifs")}>
          Actifs ({active.length})
        </TabButton>
        <TabButton active={tab === "archives"} onClick={() => onTabChange("archives")}>
          Archivés ({archived.length})
        </TabButton>
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-body-sm text-ink-muted">
            {tab === "actifs" ? "Aucun propriétaire actif." : "Aucun propriétaire archivé."}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Propriétaire</TableHead>
              {tab === "actifs" ? (
                <>
                  <TableHead className="text-center">Biens</TableHead>
                  <TableHead className="text-center">Unités occupées</TableHead>
                  <TableHead className="text-right">Loyers mensuels en cours</TableHead>
                </>
              ) : (
                <>
                  <TableHead>Mandat terminé le</TableHead>
                  <TableHead>Motif</TableHead>
                </>
              )}
              <TableHead className="text-right">Actions</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {shown.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-label-md text-ink">{o.name}</div>
                  {o.phone && <div className="text-body-xs text-ink-muted">{o.phone}</div>}
                </TableCell>
                {tab === "actifs" ? (
                  <>
                    <TableCell className="text-center text-ink-soft">{o.propertiesCount}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={o.unitsOccupied > 0 ? "success" : "neutral"}>
                        {o.unitsOccupied}/{o.unitsCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular font-currency-table text-ink">
                      {formatFcfa(o.monthlyRentTotal)}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-ink-soft">
                      {o.mandateEndedAt && new Date(o.mandateEndedAt).toLocaleDateString("fr-FR")}
                      {o.mandateEndedBy && (
                        <div className="text-body-xs text-ink-muted">
                          par {o.mandateEndedBy.name} ({o.mandateEndedBy.roleLabel})
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs text-ink-soft">{o.mandateEndReason}</TableCell>
                  </>
                )}
                <TableCell className="text-right">
                  <Link href={`/espace/proprietaires/${o.id}`}>
                    <Button variant="ghost" size="sm">
                      Voir le détail
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
