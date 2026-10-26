"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { CADRES } from "@/lib/module-theme";
import { useToast } from "@/lib/toast/toast-context";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
  type AssistantSettings,
} from "@/lib/api/assistant";


// ── Assistant IA (chat Claude) ─────────────────────────────────────────────
// Désactivé par défaut pour chaque entreprise : ce que l'on écrit à l'assistant est envoyé à un
// fournisseur externe (Anthropic). L'activation exige donc une confirmation explicite, datée et
// attribuée à la direction. L'accès par employé se règle ensuite dans sa fiche (case « Assistant IA »).
export function AssistantSection({ accessToken }: { accessToken: string | null }) {
  const [settings, setSettings] = React.useState<AssistantSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    fetchAssistantSettings(accessToken)
      .then((s) => setSettings(s))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les réglages de l'assistant."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function apply(input: { enabled: boolean; acknowledge?: boolean }, successMessage: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await saveAssistantSettings(accessToken, input);
      toast.success(successMessage);
      setAcknowledged(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-body-sm text-danger-fg">{error}</p>;
  if (!settings) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-body-sm text-ink-muted">Chargement des réglages de l&apos;assistant…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className={CADRES.administration.text} />
          <CardTitle>Assistant IA</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!settings.enabled ? (
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-body-sm text-ink">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1 h-4 w-4" />
              <span>J&apos;autorise l&apos;envoi des messages de mes employés à Anthropic pour faire fonctionner cet assistant.</span>
            </label>
            <div>
              <Button disabled={!acknowledged || busy} onClick={() => apply({ enabled: true, acknowledge: true }, "Assistant activé.")}>
                {busy ? "Activation…" : "Activer l'assistant"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-soft">
              {settings.usage.used} / {settings.usage.quota} messages utilisés ce mois-ci.
            </p>
            <div>
              <Button variant="danger" disabled={busy} onClick={() => apply({ enabled: false }, "Assistant désactivé.")}>
                Désactiver
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
