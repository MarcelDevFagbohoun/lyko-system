"use client";

import * as React from "react";
import { Download, Check, Loader2, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast/toast-context";
import type { PrepareProgress } from "@/lib/offline/prepare";

/**
 * Carte « Préparer le mode hors-ligne » (étape 11, extension) — à faire
 * avant un déplacement sans réseau : précharge le portefeuille (biens,
 * locataires, factures, retards) dans le cache local. Visible pour tous les
 * rôles connectés (mon-compte n'est pas restreint au DG), puisque ce sont
 * surtout les agents sur le terrain qui en ont besoin.
 */
export function OfflinePrepareCard() {
  const { accessToken } = useAuth();
  const online = useOnlineStatus();
  const toast = useToast();
  const [state, setState] = React.useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = React.useState<PrepareProgress | null>(null);

  async function handleClick() {
    if (!accessToken || state === "running") return;
    setState("running");
    setProgress(null);
    try {
      const { prepareOfflineMode } = await import("@/lib/offline/prepare");
      const { renterCount } = await prepareOfflineMode(accessToken, setProgress);
      setState("done");
      toast.success(`Mode hors-ligne prêt : ${renterCount} fiche(s) locataire en cache.`);
    } catch {
      setState("idle");
      toast.error("Échec du préchargement — réessayez avec une meilleure connexion.");
    }
  }

  return (
    <Card className="!p-0">
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint-slate-bg text-tint-slate-solid">
          {online ? <Download size={16} /> : <WifiOff size={16} />}
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-label-md text-ink">Préparer le mode hors-ligne</span>
          <span className="text-body-sm text-ink-muted">
            Avant un déplacement sans réseau : précharge vos biens, locataires et factures pour y
            accéder hors-ligne. Les historiques détaillés (onglets d&apos;un bail) resteront
            indisponibles sans réseau.
          </span>
          {state === "running" && progress && (
            <span className="mt-1 text-body-xs text-ink-faint">
              {progress.label} — {progress.done}/{progress.total}
            </span>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleClick}
          disabled={!online || state === "running"}
          title={!online ? "Nécessite une connexion" : undefined}
        >
          {state === "running" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : state === "done" ? (
            <Check size={14} />
          ) : (
            <Download size={14} />
          )}
          {state === "running" ? "Préchargement…" : state === "done" ? "Prêt" : "Précharger"}
        </Button>
      </div>
    </Card>
  );
}
