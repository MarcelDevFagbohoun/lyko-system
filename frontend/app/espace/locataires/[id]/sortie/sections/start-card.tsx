"use client";

import * as React from "react";
import { ClipboardList } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { startMoveOutReport, type MoveOutReport } from "@/lib/api/renters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";


export function StartCard({
  leaseId,
  accessToken,
  onStarted,
}: {
  leaseId: number;
  accessToken: string | null;
  onStarted: (report: MoveOutReport) => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleStart() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await startMoveOutReport(accessToken, leaseId);
      onStarted(res.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer la sortie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <ClipboardList size={28} className="text-ink-muted" />
        <p className="font-label-md text-ink">Organiser la sortie de ce locataire</p>
        <p className="text-body-sm text-ink-muted">
          La fiche reprend les zones/éléments de l&apos;état des lieux d&apos;entrée (si elle existe), pour comparer
          facilement les deux.
        </p>
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <Button onClick={handleStart} disabled={submitting}>
          {submitting ? "Démarrage…" : "Commencer l'état des lieux de sortie"}
        </Button>
      </CardContent>
    </Card>
  );
}

