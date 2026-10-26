"use client";

import * as React from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getGlActivationStatus, type GlActivationStatus } from "@/lib/api/gl";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { CADRES } from "@/lib/module-theme";
import { Badge } from "@/components/ui/badge";
import { ActivationCard, ReactivateButton, SuspendButton } from "./activation-card";

// ── Comptabilité avancée (SYSCOHADA) — mode de comptabilité de l'entreprise ─
// Décision explicite de l'utilisateur : « c'est [le DG] qui doit autoriser
// son comptable d'utiliser une comptabilité simple, ou une comptabilité
// avancée » — ce contrôle vit ici, dans Paramètres (pas dans l'espace
// Comptabilité avancée lui-même, qui n'affiche plus qu'un statut en lecture
// seule + un lien vers cette page). Une fois activée ici, le DG autorise
// ENSUITE tel ou tel comptable à l'utiliser depuis sa fiche employé
// (case « Comptabilité avancée (SYSCOHADA) » déjà existante, Employés).
export function AdvancedAccountingSection({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = React.useState<GlActivationStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getGlActivationStatus(accessToken)
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le statut de la comptabilité avancée."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  if (error) return <p className="text-body-sm text-danger-fg">{error}</p>;

  if (!status) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-body-sm text-ink-muted">Chargement du statut de la comptabilité avancée…</p>
        </CardContent>
      </Card>
    );
  }

  if (!status.initialized) {
    return <ActivationCard accessToken={accessToken} status={status} onChanged={load} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Landmark size={18} className={CADRES.finances.text} />
          <CardTitle>Comptabilité avancée (SYSCOHADA)</CardTitle>
        </div>
        <CardDescription>
          Optionnelle et distincte de la comptabilité simple (toujours active, dans le menu Comptabilité). Une fois
          activée, autorisez vos comptables à l&apos;utiliser depuis leur fiche employé.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge variant={status.enabled ? "success" : "warning"} className="mb-1.5">
            {status.enabled ? "Activée" : "Suspendue"}
          </Badge>
          <p className="text-body-sm text-ink-soft">
            {status.enabled
              ? "Les nouvelles opérations génèrent automatiquement leur écriture comptable."
              : "Les nouvelles opérations ne génèrent plus d'écriture — l'historique déjà généré reste consultable."}
          </p>
          <Link href="/espace/comptabilite-avancee" className="mt-1 inline-block text-body-sm text-primary hover:underline">
            Ouvrir la comptabilité avancée →
          </Link>
        </div>
        {status.enabled ? (
          <SuspendButton accessToken={accessToken} onChanged={load} />
        ) : (
          <ReactivateButton accessToken={accessToken} onChanged={load} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Référentiel de prix pour la facturation des dégradations à l'état des
 * lieux de sortie (demande directe de l'utilisateur) — un catalogue commun
 * à toute l'entreprise, réutilisé à chaque sortie de locataire. Prix tout
 * compris (matériel + main d'œuvre), décision explicite. Gestion réservée
 * au DG (comme le taux de commission) ; la lecture (pour choisir un prix
 * pendant une sortie) reste ouverte à qui a la permission "États des lieux".
 */
