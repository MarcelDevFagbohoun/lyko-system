"use client";

import * as React from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getPropertyRecette, type Unit, type PropertyRecette } from "@/lib/api/properties";
import type { PaymentMethod } from "@/lib/api/renters";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { NewPropertyExpenseForm } from "./expense-form";

export const EXPENSE_PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
];

/**
 * Recette nette de ce Bien pour un mois choisi, et sa répartition
 * cabinet/propriétaire selon le taux de commission en vigueur ce mois-là
 * (calculé côté serveur — voir `services/commission.js`). Purement informatif
 * : ne crée aucune écriture, le versement au propriétaire reste manuel.
 *
 * Inclut aussi la saisie d'une dépense rattachée à ce Bien (et
 * optionnellement à une Unité précise) — jusqu'ici seule une dépense de
 * fonctionnement du cabinet (sans Bien) pouvait être saisie, depuis
 * Comptabilité. La recette se recalcule automatiquement après enregistrement.
 */
export function RecetteCard({
  propertyId,
  units,
  canManage,
  accessToken,
}: {
  propertyId: number;
  units: Unit[];
  canManage: boolean;
  accessToken: string | null;
}) {
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const [recette, setRecette] = React.useState<PropertyRecette | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showExpenseForm, setShowExpenseForm] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken || !month) return;
    setLoading(true);
    setError(null);
    getPropertyRecette(accessToken, propertyId, month)
      .then((res) => setRecette(res.recette))
      .catch((err) => {
        setRecette(null);
        setError(err instanceof ApiError ? err.message : "Impossible de calculer la recette de ce mois.");
      })
      .finally(() => setLoading(false));
  }, [accessToken, propertyId, month, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Recette du mois</CardTitle>
            <CardDescription>Loyers encaissés, dépenses rattachées à ce Bien, part entreprise / propriétaire.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-[38px] rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {canManage && (
              <Button variant="info" size="sm" onClick={() => setShowExpenseForm((v) => !v)}>
                <Receipt size={14} />
                {showExpenseForm ? "Fermer" : "Nouvelle dépense"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showExpenseForm && canManage && (
          <NewPropertyExpenseForm
            propertyId={propertyId}
            units={units}
            accessToken={accessToken}
            onRecorded={() => {
              setShowExpenseForm(false);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}

        {loading && <p className="text-body-sm text-ink-muted">Calcul…</p>}
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {recette && !loading && (
          <>
            {!recette.rateDefined && (
              <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-body-sm text-warning-fg">
                Aucun taux de commission défini pour ce propriétaire — 0 % appliqué par défaut.{" "}
                <Link href={`/espace/proprietaires/${recette.ownerId}`} className="underline hover:no-underline">
                  Définir un taux
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Loyers encaissés" value={formatFcfa(recette.totalPayments, { withSuffix: false })} unit="FCFA" tone="success" />
              <StatCard label="Dépenses rattachées" value={formatFcfa(recette.totalExpenses, { withSuffix: false })} unit="FCFA" tone={recette.totalExpenses > 0 ? "warning" : "default"} />
              <StatCard label="Recette nette" value={formatFcfa(recette.recetteNette, { withSuffix: false })} unit="FCFA" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label={`Commission entreprise (${recette.rate} %)`}
                value={formatFcfa(recette.commissionCabinet, { withSuffix: false })}
                unit="FCFA"
                tone="info"
              />
              <StatCard label="Part propriétaire" value={formatFcfa(recette.partProprietaire, { withSuffix: false })} unit="FCFA" tone="success" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Saisie d'une dépense rattachée à ce Bien — et, si une Unité précise est
 * choisie, à cette Unité (ex. réparation d'une seule chambre). `propertyId`
 * est fixé par le contexte (fiche du Bien) : pas de sélecteur à ce niveau,
 * contrairement au formulaire général de Comptabilité.
 */
