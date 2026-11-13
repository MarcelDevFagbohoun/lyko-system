"use client";

import * as React from "react";
import Link from "next/link";
import { UserPlus, Pencil, Search, FileSpreadsheet } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listRenters, type RenterListItem } from "@/lib/api/renters";
import { ApiError } from "@/lib/api/client";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { RentStrip } from "@/components/renters/rent-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { useCan } from "@/lib/auth/use-can";

export function LocatairesView() {
  return (
    <RequireAuth>
      <LocatairesContent />
    </RequireAuth>
  );
}

function StatutBadge({ renter }: { renter: RenterListItem }) {
  if (!renter.activeLease) return <Badge variant="neutral">Sans bail actif</Badge>;
  if (!renter.arrears || renter.arrears.status === "current") {
    return (
      <Badge variant="success" dot>
        À jour
      </Badge>
    );
  }
  return (
    <Badge variant="danger" dot>
      En retard {renter.arrears.daysLate} j
    </Badge>
  );
}

function LocatairesContent() {
  const { accessToken, user } = useAuth();
  const canManage = useCan("locataires");
  const [renters, setRenters] = React.useState<RenterListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Archive des locataires (étape du 2026-10-18, demande utilisateur) : un locataire sans bail actif
  // (parti) reste consultable avec tous ses points financiers, mais à part de la liste active — même
  // principe que les propriétaires dont le mandat est terminé (voir proprietaires-view.tsx).
  const [tab, setTab] = React.useState<"actifs" | "archives">("actifs");
  // Recherche (demande utilisateur, 2026-11-11 : simplifier l'usage d'autres fonctionnalités) — en
  // local (pas d'appel serveur) puisque `listRenters` charge déjà tout d'un coup, contrairement à
  // Biens/Propriétaires qui interrogent le serveur à chaque frappe.
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!accessToken) return;
    listRenters(accessToken)
      .then((res) => setRenters(res.renters))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les locataires."));
  }, [accessToken]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-headline-xl text-ink">Gestion Locataires</h1>
            <p className="text-body-md text-ink-soft">
              Fiches locataires, baux, paiements et quittances.
            </p>
          </div>
          {canManage && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Import en masse (demande utilisateur, 2026-11-13) — réservé au DG, comme la route serveur. */}
              {user?.role === "dg" && (
                <Link href="/espace/import" className="w-full sm:w-fit">
                  <Button variant="secondary" className="w-full sm:w-auto">
                    <FileSpreadsheet size={18} />
                    Importer depuis Excel
                  </Button>
                </Link>
              )}
              <Link href="/espace/locataires/nouveau" className="w-full sm:w-fit">
                <Button className="w-full sm:w-auto">
                  <UserPlus size={18} />
                  Ajouter un locataire
                </Button>
              </Link>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {error}
          </div>
        )}

        {renters === null && !error ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : renters && renters.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <UserPlus size={28} className="text-ink-muted" />
              <p className="font-label-md text-ink">Aucun locataire pour le moment</p>
              {canManage && (
                <Link href="/espace/locataires/nouveau">
                  <Button variant="secondary">Créer le premier locataire</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : renters ? (
          <>
            <div className="relative max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher par nom, téléphone ou bien"
                className="h-[38px] w-full rounded border border-border-strong bg-surface pl-9 pr-3 text-body-md text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <RentersTable renters={renters} tab={tab} onTabChange={setTab} query={query} />
          </>
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
 * Archive des locataires (étape du 2026-10-18, demande utilisateur) : un locataire sans bail actif
 * (parti) passe dans l'onglet « Archivés » — sa fiche reste accessible avec tout son historique
 * financier (voir locataire-view.tsx, « Historique des contrats »), seulement rangée à part ici.
 * Dérivé de `activeLease`, jamais un nouveau champ : un locataire peut revenir actif (nouveau bail)
 * du jour au lendemain, voir routes/renters.js `POST /:id/leases`.
 */
/** Texte de recherche d'un locataire : nom, téléphone, et le bien (actuel ou dernier connu). */
function renterSearchText(r: RenterListItem): string {
  const unit = r.activeLease?.unit ?? null;
  return [
    r.firstName,
    r.lastName,
    r.phone,
    unit?.code,
    unit?.designationLabel,
    unit?.property.owner.name,
    unit?.property.address,
    r.lastEndedLease?.unitCode,
    r.lastEndedLease?.designationLabel,
    r.lastEndedLease?.ownerName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function RentersTable({
  renters,
  tab,
  onTabChange,
  query,
}: {
  renters: RenterListItem[];
  tab: "actifs" | "archives";
  onTabChange: (tab: "actifs" | "archives") => void;
  query: string;
}) {
  const needle = query.trim().toLowerCase();
  const matching = needle ? renters.filter((r) => renterSearchText(r).includes(needle)) : renters;
  const active = matching.filter((r) => r.activeLease);
  const archived = matching.filter((r) => !r.activeLease);
  const shown = tab === "actifs" ? active : archived;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-surface-muted p-1">
        <TabButton active={tab === "actifs"} onClick={() => onTabChange("actifs")}>
          Actifs ({active.length})
        </TabButton>
        <TabButton active={tab === "archives"} onClick={() => onTabChange("archives")}>
          Archives des locataires sortants ({archived.length})
        </TabButton>
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-body-sm text-ink-muted">
            {needle
              ? "Aucun locataire ne correspond à cette recherche."
              : tab === "actifs"
                ? "Aucun locataire actif."
                : "Aucun locataire archivé."}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Locataire</TableHead>
              <TableHead>Bien</TableHead>
              <TableHead className="text-right">Loyer</TableHead>
              {tab === "actifs" ? (
                <>
                  <TableHead>12 mois</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                </>
              ) : (
                <TableHead>Parti le</TableHead>
              )}
              <TableHead className="text-right">Actions</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-label-md text-ink">
                    {r.firstName} {r.lastName}
                  </div>
                  <div className="text-body-xs text-ink-muted">{r.phone}</div>
                </TableCell>
                <TableCell className="text-ink-soft">
                  {r.activeLease ? (
                    <>
                      <div>{r.activeLease.unit.designationLabel} ({r.activeLease.unit.code})</div>
                      <div className="text-body-xs text-ink-muted">
                        {r.activeLease.unit.property.owner.name}
                        {r.activeLease.unit.property.address ? ` · ${r.activeLease.unit.property.address}` : ""}
                      </div>
                    </>
                  ) : r.lastEndedLease ? (
                    <>
                      <div>{r.lastEndedLease.designationLabel} ({r.lastEndedLease.unitCode})</div>
                      <div className="text-body-xs text-ink-muted">
                        {r.lastEndedLease.ownerName}
                        {r.lastEndedLease.address ? ` · ${r.lastEndedLease.address}` : ""}
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </TableCell>
                <TableAmount>
                  {r.activeLease
                    ? formatFcfa(r.activeLease.monthlyRent)
                    : r.lastEndedLease
                      ? formatFcfa(r.lastEndedLease.monthlyRent)
                      : "—"}
                </TableAmount>
                {tab === "actifs" ? (
                  <>
                    <TableCell>
                      <RentStrip months={r.rentStrip} variant="compact" />
                    </TableCell>
                    <TableCell className="text-center">
                      <StatutBadge renter={r} />
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-ink-soft">{r.lastEndedLease?.endDate ?? "—"}</TableCell>
                )}
                <TableCell className="text-right">
                  <Link href={`/espace/locataires/${r.id}`}>
                    <Button variant="ghost" size="sm">
                      <Pencil size={14} />
                      Voir la fiche
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
