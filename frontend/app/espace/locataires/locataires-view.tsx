"use client";

import * as React from "react";
import Link from "next/link";
import { UserPlus, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { listRenters, type RenterListItem } from "@/lib/api/renters";
import { ApiError } from "@/lib/api/client";
import { formatFcfa } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

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
  const canManage = user?.role === "dg" || (user?.permissions.includes("locataires") ?? false);
  const [renters, setRenters] = React.useState<RenterListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
            <Link href="/espace/locataires/nouveau" className="w-fit">
              <Button>
                <UserPlus size={18} />
                Nouveau locataire
              </Button>
            </Link>
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
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Locataire</TableHead>
                <TableHead>Bien</TableHead>
                <TableHead className="text-right">Loyer</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {renters.map((r) => (
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
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableAmount>
                    {r.activeLease ? formatFcfa(r.activeLease.monthlyRent) : "—"}
                  </TableAmount>
                  <TableCell className="text-center">
                    <StatutBadge renter={r} />
                  </TableCell>
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
        ) : null}
      </div>
    </div>
  );
}
