"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Section de finalisation (étape 13, idée n°9 ; signature électronique retirée le 2026-11-05 — jamais
 * utilisée en pratique, le PV se signe à la main après impression). `onFinalize` reçoit les réserves du
 * locataire ; les erreurs serveur (état manquant sur un élément, etc.) remontent via `error`.
 */
export function FinalizeSection({
  onFinalize,
  submitting,
  error,
  tenantName,
  mode = "finalize",
}: {
  onFinalize: (tenantReserves: string) => void | Promise<void>;
  submitting: boolean;
  error: string | null;
  /** Nom du locataire, affiché sur la fiche d'impression (étape 56). */
  tenantName?: string;
  /**
   * Circuit de validation DG (demande utilisateur, 2026-11-03) : un employé « soumet » (le PV reste un
   * brouillon modifiable, en attente de validation) au lieu de « finaliser » (verrouillage définitif,
   * réservé au DG) — même formulaire, juste le texte et le bouton qui changent. `tenantReserves` n'a de
   * sens qu'à la finalisation (voir `submitMoveOutReport`, qui ne l'accepte pas) : masqué en mode « submit ».
   */
  mode?: "finalize" | "submit";
}) {
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [tenantReserves, setTenantReserves] = React.useState("");

  async function handleFinalize() {
    setLocalError(null);
    await onFinalize(tenantReserves.trim());
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-muted p-4">
      <div>
        <h3 className="font-label-lg text-ink">{mode === "submit" ? "Soumettre pour validation" : "Finaliser la fiche"}</h3>
        <p className="text-body-sm text-ink-muted">
          {mode === "submit"
            ? "Le PV est transmis à la direction générale pour validation — vous pourrez encore le corriger si elle le renvoie."
            : "Une fois finalisée, la fiche est verrouillée et ne peut plus être modifiée."}
        </p>
      </div>

      {(error || localError) && <p className="text-body-sm text-danger-fg">{error || localError}</p>}

      {mode === "finalize" && (
        <div className="flex flex-col gap-1.5">
          <label className="font-label-sm text-ink-soft">
            Réserves du locataire (optionnel — s&apos;il n&apos;est pas d&apos;accord sur un point précis)
          </label>
          <textarea
            value={tenantReserves}
            onChange={(e) => setTenantReserves(e.target.value)}
            rows={2}
            placeholder="Ex. Le locataire conteste l'état du carrelage de la chambre."
            className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      )}

      <p className="text-body-sm text-ink-muted">
        Après finalisation, imprimez le procès-verbal (PDF) : le locataire{tenantName ? ` (${tenantName})` : ""} et l&apos;entreprise le datent
        et le signent à la main dans les cadres prévus.
      </p>

      <Button type="button" size="lg" onClick={handleFinalize} disabled={submitting} className="self-start">
        <Lock size={16} />
        {mode === "submit"
          ? submitting
            ? "Envoi…"
            : "Soumettre pour validation"
          : submitting
            ? "Finalisation…"
            : "Finaliser et verrouiller"}
      </Button>
    </div>
  );
}
