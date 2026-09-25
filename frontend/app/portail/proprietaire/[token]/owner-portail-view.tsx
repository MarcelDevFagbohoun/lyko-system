"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { FileDown, AlertTriangle, Home } from "lucide-react";
import { API_URL, ApiError } from "@/lib/api/client";
import {
  getOwnerPortalDashboard,
  ownerPortalStatementPdfUrl,
  type OwnerPortalDashboard,
} from "@/lib/api/ownerPortal";
import { formatFcfa, monthLabelFr } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { OwnerPortalCharges } from "@/components/charges/owner-portal-charges";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
};

const UNIT_STATUS_BADGE: Record<string, { variant: "success" | "neutral" | "warning"; label: string }> = {
  libre: { variant: "success", label: "Libre" },
  loue: { variant: "neutral", label: "Loué" },
  reserve: { variant: "warning", label: "Réservé" },
};

/**
 * Portail propriétaire (étape 13, idée n°1) : page publique, sans compte ni
 * mot de passe — le token du chemin est le seul secret. Ni `RequireAuth` ni
 * le menu de l'espace employé (`EspaceSidebar`) ici, même principe que le
 * portail locataire.
 */
export function OwnerPortailView() {
  const { token } = useParams<{ token: string }>();
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const [dashboard, setDashboard] = React.useState<OwnerPortalDashboard | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!token) return;
    getOwnerPortalDashboard(token, month)
      .then(setDashboard)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Ce lien est momentanément inaccessible."),
      );
  }, [token, month]);

  React.useEffect(() => load(), [load]);

  if (loadError) {
    return (
      <OwnerPortailShell>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle size={28} className="text-danger-fg" />
            <p className="font-label-md text-ink">{loadError}</p>
            <p className="text-body-sm text-ink-muted">
              Demandez un nouveau lien à votre agence si celui-ci ne fonctionne plus.
            </p>
          </CardContent>
        </Card>
      </OwnerPortailShell>
    );
  }

  if (!dashboard) {
    return (
      <OwnerPortailShell>
        <p className="text-body-sm text-ink-muted">Chargement…</p>
      </OwnerPortailShell>
    );
  }

  const { tenant, owner, properties, recette, payouts, charges } = dashboard;
  const multipleProperties = properties.length > 1;

  return (
    <OwnerPortailShell tenant={tenant}>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-headline-lg text-ink">Bonjour {owner.name}</h1>
            <p className="text-body-sm text-ink-muted">Votre espace personnel, mis à jour en temps réel.</p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-[38px] w-fit rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        {properties.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-body-sm text-ink-muted">
              Aucun Bien n&apos;est associé à ce lien pour le moment.
            </CardContent>
          </Card>
        ) : (
          <>
            {multipleProperties && (
              <Card className="border-primary-border bg-primary-bg/40">
                <CardHeader>
                  <CardTitle>Total du portefeuille — {monthLabelFr(recette.yearMonth)}</CardTitle>
                  <CardDescription>Tous vos Biens confondus, pour le mois sélectionné.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard label="Loyers encaissés" value={formatFcfa(recette.totals.totalPayments, { withSuffix: false })} unit="FCFA" tone="success" />
                  <StatCard label="Dépenses rattachées" value={formatFcfa(recette.totals.totalExpenses, { withSuffix: false })} unit="FCFA" tone={recette.totals.totalExpenses > 0 ? "warning" : "default"} />
                  <StatCard label="Recette nette" value={formatFcfa(recette.totals.recetteNette, { withSuffix: false })} unit="FCFA" />
                  <StatCard label="Commission cabinet" value={formatFcfa(recette.totals.commissionCabinet, { withSuffix: false })} unit="FCFA" tone="info" />
                  <StatCard label="Votre part" value={formatFcfa(recette.totals.partProprietaire, { withSuffix: false })} unit="FCFA" tone="success" />
                </CardContent>
              </Card>
            )}

            {properties.map((property) => {
              const r = recette.byProperty.find((x) => x.propertyId === property.id);
              return (
                <Card key={property.id}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Home size={16} className="text-primary" />
                      <CardTitle>
                        {property.code} <span className="text-ink-muted">— {property.typeLabel}</span>
                      </CardTitle>
                    </div>
                    <CardDescription>{property.address ?? "Adresse non renseignée"}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {r && (
                      <>
                        {!r.rateDefined && (
                          <div className="rounded-lg border border-warning-border bg-warning/10 px-3 py-2.5 text-body-sm text-warning-fg">
                            Aucun taux de commission défini pour l&apos;instant — 0 % appliqué par défaut.
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <StatCard label="Loyers encaissés" value={formatFcfa(r.totalPayments, { withSuffix: false })} unit="FCFA" tone="success" />
                          <StatCard label="Dépenses rattachées" value={formatFcfa(r.totalExpenses, { withSuffix: false })} unit="FCFA" tone={r.totalExpenses > 0 ? "warning" : "default"} />
                          <StatCard label="Recette nette" value={formatFcfa(r.recetteNette, { withSuffix: false })} unit="FCFA" />
                          <StatCard label={`Commission (${r.rate} %)`} value={formatFcfa(r.commissionCabinet, { withSuffix: false })} unit="FCFA" tone="info" />
                          <StatCard label="Votre part" value={formatFcfa(r.partProprietaire, { withSuffix: false })} unit="FCFA" tone="success" />
                        </div>
                      </>
                    )}

                    {property.units.length > 0 && (
                      <div className="flex flex-col gap-2 border-t border-border pt-4">
                        <span className="font-label-sm uppercase tracking-wider text-ink-muted">Unités</span>
                        {property.units.map((u) => {
                          const badge = UNIT_STATUS_BADGE[u.status] ?? UNIT_STATUS_BADGE.libre;
                          return (
                            <div key={u.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                              <div>
                                <p className="font-label-md text-ink">
                                  {u.code} <span className="text-ink-muted">— {u.designationLabel}</span>
                                </p>
                                {u.currentRenter && (
                                  <p className="text-body-xs text-ink-muted">Locataire : {u.currentRenter}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="tabular text-body-sm text-ink-soft">{formatFcfa(u.monthlyRent)}</span>
                                <Badge variant={badge.variant} dot>
                                  {badge.label}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <OwnerPortalCharges token={token} charges={charges} />

            <Card>
              <CardHeader>
                <CardTitle>Historique des versements</CardTitle>
                <CardDescription>Les 12 derniers versements reçus du cabinet.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {payouts.length === 0 ? (
                  <p className="text-body-sm text-ink-muted">Aucun versement enregistré pour l&apos;instant.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead>Période</TableHead>
                        <TableHead className="text-right">Montant</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Date</TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {payouts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.periodLabel}</TableCell>
                          <TableAmount>{formatFcfa(p.amount)}</TableAmount>
                          <TableCell className="text-ink-soft">{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</TableCell>
                          <TableCell className="text-ink-soft">{p.paidAt}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
                  onClick={() => window.open(ownerPortalStatementPdfUrl(token), "_blank", "noopener,noreferrer")}
                >
                  <FileDown size={16} />
                  Télécharger mon relevé
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </OwnerPortailShell>
  );
}

function OwnerPortailShell({
  tenant,
  children,
}: {
  tenant?: OwnerPortalDashboard["tenant"];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas">
      <header className="flex w-full items-center justify-center border-b border-border bg-surface px-4 py-4">
        {tenant?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${tenant.logoUrl}`} alt={tenant.companyName ?? "Logo"} className="h-9 w-auto object-contain" />
        ) : (
          <span className="font-display text-headline-md text-ink">{tenant?.companyName ?? "Lyko System"}</span>
        )}
      </header>
      <main className="flex w-full flex-1 flex-col items-center px-4 py-10">{children}</main>
    </div>
  );
}
