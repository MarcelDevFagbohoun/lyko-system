"use client";

import * as React from "react";
import Link from "next/link";
import { Zap, ExternalLink } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { listCharges, type UtilityCharge } from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, CHARGE_STATUS_LABELS } from "@/lib/constants/charges";
import { formatFcfa } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";

const STATUS_BADGE_VARIANT: Record<UtilityCharge["status"], "success" | "warning" | "info"> = {
  payee: "success",
  partiellement_payee: "info",
  impayee: "warning",
};

/**
 * Section « Charges SONEB/SBEE » de la fiche d'un bien (demande utilisateur, 2026-10-30 : « que le
 * point des charges payées soit plus clair au niveau de chaque bien »). Liste, toutes unités
 * confondues, les factures de ce bien avec leur statut — l'action elle-même (enregistrer un
 * règlement, générer un lien de paiement, supprimer) reste sur la page Charges, déjà filtrée sur ce
 * bien par le bouton « Gérer », pour ne pas dupliquer ces formulaires ici.
 */
export function PropertyChargesCard({ propertyId, accessToken }: { propertyId: number; accessToken: string | null }) {
  const [charges, setCharges] = React.useState<UtilityCharge[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!accessToken) return;
    listCharges(accessToken, { propertyId })
      .then((res) => setCharges(res.charges))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les charges de ce bien."));
  }, [accessToken, propertyId]);

  const unpaid = charges?.filter((c) => c.status !== "payee") ?? [];
  const totalDue = unpaid.reduce((sum, c) => sum + c.remainingAmount, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Charges SONEB / SBEE</CardTitle>
          <CardDescription>Factures d&apos;eau et d&apos;électricité de ce bien, toutes unités confondues.</CardDescription>
        </div>
        <Link href={`/espace/charges?propertyId=${propertyId}`}>
          <Button variant="secondary" size="sm">
            <ExternalLink size={14} />
            Gérer dans Charges
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">{error}</div>
        )}

        {!error && charges === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : charges && charges.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Aucune facture SONEB/SBEE enregistrée pour ce bien.</p>
        ) : charges ? (
          <>
            <div>
              {unpaid.length > 0 ? (
                <Badge variant="warning" className="gap-1">
                  <Zap size={11} />
                  {unpaid.length} facture{unpaid.length > 1 ? "s" : ""} non soldée{unpaid.length > 1 ? "s" : ""} · {formatFcfa(totalDue)} restant{totalDue > 1 ? "s" : ""}
                </Badge>
              ) : (
                <Badge variant="success">Toutes les charges de ce bien sont réglées</Badge>
              )}
            </div>

            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Fluide</TableHead>
                  <TableHead>Unité</TableHead>
                  <TableHead>Locataire</TableHead>
                  <TableHead>Facturée le</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {charges.slice(0, 10).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-ink-soft">{UTILITY_TYPE_LABELS[c.utilityType]}</TableCell>
                    <TableCell className="font-label-md text-ink">{c.unit.code}</TableCell>
                    <TableCell className="text-ink-soft">{c.renter.firstName} {c.renter.lastName}</TableCell>
                    <TableCell className="text-body-sm text-ink-muted">{c.billedAt}</TableCell>
                    <TableAmount>{formatFcfa(c.amount)}</TableAmount>
                    <TableCell className="text-center">
                      <Badge variant={STATUS_BADGE_VARIANT[c.status]}>{CHARGE_STATUS_LABELS[c.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {charges.length > 10 && (
              <Link href={`/espace/charges?propertyId=${propertyId}`} className="self-start text-body-sm text-primary hover:underline">
                Voir les {charges.length - 10} autres factures de ce bien →
              </Link>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
