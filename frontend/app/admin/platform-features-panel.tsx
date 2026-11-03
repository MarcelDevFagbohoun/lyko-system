"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { adminPlatformFeatures, adminSavePlatformFeatures, type PlatformFeatureGates } from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateLabel } from "@/lib/utils";

/**
 * Verrou plateforme (demande utilisateur, 2026-11-03 : « on ajoute un menu paramètre dans l'admin
 * qui va nous permettre d'activer le syscohada et fedapay lorsque sera prêt »).
 *
 * SYSCOHADA et FedaPay restent déjà activables entreprise par entreprise (menu Réglages de chaque
 * compte) — ce panneau ajoute l'interrupteur AU-DESSUS : tant qu'un module est éteint ici, aucune
 * entreprise ne peut l'activer elle-même pour la première fois. Une entreprise qui l'a déjà activé
 * avant (ou pendant que c'est fermé) n'est jamais coupée rétroactivement.
 */
export function PlatformFeaturesPanel({ token }: { token: string }) {
  const [gates, setGates] = React.useState<PlatformFeatureGates | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    adminPlatformFeatures(token)
      .then(setGates)
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Chargement impossible." }));
  }, [token]);
  React.useEffect(() => load(), [load]);

  async function toggle(key: "syscohadaEnabled" | "fedapayEnabled", value: boolean) {
    if (!gates) return;
    setBusy(true);
    setMsg(null);
    const next = { syscohadaEnabled: gates.syscohadaEnabled, fedapayEnabled: gates.fedapayEnabled, [key]: value };
    try {
      const saved = await adminSavePlatformFeatures(token, next);
      setGates(saved);
      setMsg({ ok: true, text: "Enregistré." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    } finally {
      setBusy(false);
    }
  }

  if (!gates) return <p className="text-body-md text-ink-muted">{msg?.text ?? "Chargement…"}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Modules à ouvrir quand ce sera prêt</CardTitle>
          <CardDescription>
            Tant qu&apos;un module est fermé ici, aucune entreprise ne peut l&apos;activer elle-même depuis ses Réglages —
            une entreprise qui l&apos;a déjà activé (ex. interne) garde son accès, rien n&apos;est retiré rétroactivement.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={gates.syscohadaEnabled}
              disabled={busy}
              onChange={(e) => toggle("syscohadaEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
            <span className="font-label-md text-ink">Comptabilité avancée SYSCOHADA</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={gates.fedapayEnabled}
              disabled={busy}
              onChange={(e) => toggle("fedapayEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
            <span className="font-label-md text-ink">FedaPay (encaissement des loyers, paiements sortants)</span>
          </label>
          {gates.updatedAt && (
            <p className="text-body-xs text-ink-faint">Dernière modification le {formatDateLabel(gates.updatedAt.slice(0, 10))}.</p>
          )}
          {msg && <p className={`text-body-sm ${msg.ok ? "text-ink-soft" : "text-danger-fg"}`}>{msg.text}</p>}
        </CardContent>
      </Card>
      <Button variant="secondary" className="self-start" onClick={load} disabled={busy}>
        Actualiser
      </Button>
    </div>
  );
}
