"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { adminErrors, adminResolveError, type PlatformError, type PlatformErrorKind } from "@/lib/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Suivi des erreurs de la plateforme (demande utilisateur, 2026-11-13) : erreurs serveur, tâches
 * planifiées en échec et écrans qui plantent chez les utilisateurs, regroupés par erreur distincte.
 * « Corrigé » retire l'erreur de la liste ; si elle se reproduit, elle revient d'elle-même et une
 * nouvelle alerte e-mail part. En cartes (pas en tableau) : lisible tel quel sur téléphone.
 */
const KIND: Record<PlatformErrorKind, { label: string; variant: "danger" | "warning" | "info" }> = {
  api: { label: "Serveur", variant: "danger" },
  job: { label: "Tâche planifiée", variant: "danger" },
  process: { label: "Interne", variant: "warning" },
  frontend: { label: "Écran", variant: "info" },
};

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function ErrorsPanel({ token, onLogout, onOpenCount }: { token: string; onLogout: () => void; onOpenCount: (n: number) => void }) {
  const [status, setStatus] = React.useState<"open" | "resolved">("open");
  const [errors, setErrors] = React.useState<PlatformError[] | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    setFailed(null);
    adminErrors(token, status)
      .then((r) => { setErrors(r.errors); onOpenCount(r.openCount); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) onLogout();
        else { setErrors([]); setFailed(e instanceof ApiError ? e.message : "Chargement impossible."); }
      });
  }, [token, status, onLogout, onOpenCount]);
  React.useEffect(() => { setErrors(null); load(); }, [load]);

  async function resolve(id: number) {
    setBusy(id);
    try { await adminResolveError(token, id); load(); } catch (e) { setFailed(e instanceof ApiError ? e.message : "Action impossible."); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Erreurs de la plateforme</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant={status === "open" ? "primary" : "secondary"} onClick={() => setStatus("open")}>À traiter</Button>
          <Button variant={status === "resolved" ? "primary" : "secondary"} onClick={() => setStatus("resolved")}>Corrigées</Button>
          <Button variant="ghost" onClick={load}>Actualiser</Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failed && <p className="rounded border border-border bg-surface-muted p-3 text-body-sm text-ink">{failed}</p>}
        {errors === null && <p className="text-body-sm text-ink-muted">Chargement…</p>}
        {errors?.length === 0 && !failed && (
          <p className="text-body-sm text-ink-muted">
            {status === "open" ? "Aucune erreur à traiter." : "Aucune erreur marquée corrigée."}
          </p>
        )}
        {errors?.map((e) => (
          <div key={e.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={KIND[e.kind].variant}>{KIND[e.kind].label}</Badge>
              <span className="text-body-xs text-ink-muted">
                {e.occurrences} fois · dernière le {when(e.lastSeenAt)}
                {e.occurrences > 1 ? ` · première le ${when(e.firstSeenAt)}` : ""}
              </span>
            </div>
            <p className="mt-2 break-words text-body-md font-medium text-ink">{e.message}</p>
            <p className="mt-1 break-words text-body-xs text-ink-muted">
              {e.location ?? "Emplacement inconnu"}
              {e.companyName ? ` · ${e.companyName}` : e.tenantId ? ` · entreprise n° ${e.tenantId}` : ""}
            </p>
            {expanded === e.id && e.stack && (
              <pre className="mt-3 max-h-64 overflow-auto rounded bg-surface-muted p-3 text-[11px] leading-relaxed text-ink">{e.stack}</pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {e.stack && (
                <Button variant="secondary" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  {expanded === e.id ? "Masquer le détail" : "Détail technique"}
                </Button>
              )}
              {!e.resolvedAt && (
                <Button onClick={() => resolve(e.id)} disabled={busy === e.id}>
                  {busy === e.id ? "…" : "Corrigé"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
