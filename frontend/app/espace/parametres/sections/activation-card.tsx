"use client";

import * as React from "react";
import {
  Landmark,
  PlayCircle,
  PauseCircle,
  Loader2,
} from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { activateGlModule, deactivateGlModule, type GlActivationStatus } from "@/lib/api/gl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { CADRES } from "@/lib/module-theme";
import { useToast } from "@/lib/toast/toast-context";


export function ActivationCard({
  accessToken,
  status,
  onChanged,
}: {
  accessToken: string | null;
  status: GlActivationStatus | null;
  onChanged: () => void;
}) {
  const [activating, setActivating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof activateGlModule>> | null>(null);
  const toast = useToast();

  async function handleActivate() {
    if (!accessToken) return;
    const fromDate = status?.accountingStartDate ?? status?.earliestOperation;
    const ok = window.confirm(
      fromDate
        ? `Activer la comptabilité avancée ? Toutes les opérations déjà enregistrées depuis le ${fromDate} seront reprises automatiquement en partie double. Cette étape peut prendre quelques instants.`
        : "Activer la comptabilité avancée ? Aucune opération existante à reprendre — le suivi démarre à partir d'aujourd'hui.",
    );
    if (!ok) return;

    setActivating(true);
    setError(null);
    try {
      const res = await activateGlModule(accessToken);
      setResult(res);
      toast.success(`Comptabilité avancée activée — ${res.entriesGenerated} écriture(s) générée(s).`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'activer la comptabilité avancée.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Landmark size={18} className={CADRES.finances.text} />
          <CardTitle>Comptabilité avancée (SYSCOHADA)</CardTitle>
        </div>
        <CardDescription>
          Optionnelle et distincte de la comptabilité simple (qui continue de fonctionner exactement comme avant,
          activée ou non). Génère automatiquement, en partie double, l&apos;écriture correspondant à chaque loyer,
          dépense, charge SONEB/SBEE et versement déjà enregistré — puis chaque nouvelle opération à venir. Une fois
          activée, autorisez vos comptables à l&apos;utiliser depuis leur fiche employé.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status?.earliestOperation && (
          <p className="text-body-sm text-ink-soft">
            Opération la plus ancienne trouvée : <span className="tabular font-semibold">{status.earliestOperation}</span>
            {status.accountingStartDate && (
              <>
                {" "}— reprise prévue à partir du <span className="tabular font-semibold">{status.accountingStartDate}</span> (date de
                démarrage comptable définie ci-dessous).
              </>
            )}
          </p>
        )}
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <Button onClick={handleActivate} disabled={activating} className="self-start">
          {activating ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
          {activating ? "Activation en cours…" : "Activer maintenant"}
        </Button>
        {result && (
          <div className="rounded-lg border border-success-border bg-success-bg p-3 text-body-sm text-success-fg">
            {result.fiscalYearsCreated.length} exercice(s) ouvert(s) · {result.entriesGenerated} écriture(s) générée(s)
            {result.entriesSkipped > 0 && ` · ${result.entriesSkipped} déjà à jour`}
            {result.errors.length > 0 && (
              <div className="mt-1 text-danger-fg">
                <p>
                  {result.errors.length} opération(s) n&apos;ont pas pu être reprises — souvent parce que l&apos;exercice
                  comptable correspondant est déjà clôturé. Rouvrir cet exercice (ou en créer un couvrant la bonne
                  période) puis resynchroniser permet en général de les rattraper.
                </p>
                <ul className="mt-1 list-disc pl-5 text-body-xs">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReactivateButton({ accessToken, onChanged }: { accessToken: string | null; onChanged: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const toast = useToast();

  async function handleReactivate() {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await activateGlModule(accessToken);
      toast.success(
        res.entriesGenerated > 0
          ? `Comptabilité avancée réactivée — ${res.entriesGenerated} écriture(s) de rattrapage générée(s).`
          : "Comptabilité avancée réactivée.",
      );
      // Audit comptable, anomalie B4 : un rattrapage partiellement échoué (le
      // plus souvent parce que l'exercice concerné est déjà clôturé) ne doit
      // jamais passer inaperçu derrière le seul toast de succès ci-dessus.
      if (res.errors.length > 0) {
        toast.warning(
          `${res.errors.length} opération(s) n'ont pas pu être reprises, souvent parce que l'exercice comptable correspondant est déjà clôturé. Rouvrez-le (ou créez l'exercice manquant) puis réactivez à nouveau.`,
        );
      }
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de réactiver la comptabilité avancée.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="warning" size="sm" disabled={loading} onClick={handleReactivate}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
      Réactiver
    </Button>
  );
}

export function SuspendButton({ accessToken, onChanged }: { accessToken: string | null; onChanged: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const toast = useToast();

  async function handleSuspend() {
    if (!accessToken) return;
    const ok = window.confirm(
      "Suspendre la comptabilité avancée ? Les nouvelles opérations ne généreront plus d'écriture jusqu'à réactivation. Rien n'est supprimé — l'historique déjà généré reste consultable.",
    );
    if (!ok) return;
    setLoading(true);
    try {
      await deactivateGlModule(accessToken);
      toast.info("Comptabilité avancée suspendue.");
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de suspendre la comptabilité avancée.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={loading} onClick={handleSuspend}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />}
      Suspendre
    </Button>
  );
}

// ── Assistant IA (chat Claude) ─────────────────────────────────────────────
// Désactivé par défaut pour chaque entreprise : ce que l'on écrit à l'assistant est envoyé à un
// fournisseur externe (Anthropic). L'activation exige donc une confirmation explicite, datée et
// attribuée à la direction. L'accès par employé se règle ensuite dans sa fiche (case « Assistant IA »).
