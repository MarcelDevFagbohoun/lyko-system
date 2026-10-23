"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";

/**
 * Section de finalisation (étape 13, idée n°9) : deux signatures (locataire,
 * agent) obligatoires, puis verrouillage définitif de la fiche. `onFinalize`
 * reçoit les deux signatures en PNG ; les erreurs serveur (état manquant sur
 * un élément, etc.) remontent via `error`.
 */
export function FinalizeSection({
  onFinalize,
  submitting,
  error,
  tenantName,
  printedSignatures = false,
}: {
  onFinalize: (tenantSignature: Blob | null, agentSignature: Blob | null, tenantReserves: string) => void | Promise<void>;
  submitting: boolean;
  error: string | null;
  /** Nom du locataire, affiché sous sa zone de signature (étape 56). */
  tenantName?: string;
  /** États des lieux : pas de signature numérique, le PV imprimé est signé à la main par les deux parties. */
  printedSignatures?: boolean;
}) {
  const { user } = useAuth();
  const agentName = user ? `${user.firstName} ${user.lastName}` : undefined;
  const tenantPadRef = React.useRef<SignaturePadHandle | null>(null);
  const agentPadRef = React.useRef<SignaturePadHandle | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [tenantReserves, setTenantReserves] = React.useState("");

  async function handleFinalize() {
    if (printedSignatures) {
      setLocalError(null);
      await onFinalize(null, null, tenantReserves.trim());
      return;
    }
    const tenantPad = tenantPadRef.current;
    const agentPad = agentPadRef.current;
    if (!tenantPad || !agentPad || tenantPad.isEmpty() || agentPad.isEmpty()) {
      setLocalError("Les deux signatures (locataire et agent) sont requises pour finaliser.");
      return;
    }
    setLocalError(null);
    const [tenantBlob, agentBlob] = await Promise.all([tenantPad.getBlob(), agentPad.getBlob()]);
    if (!tenantBlob || !agentBlob) {
      setLocalError("Signature illisible, réessayez.");
      return;
    }
    await onFinalize(tenantBlob, agentBlob, tenantReserves.trim());
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-muted p-4">
      <div>
        <h3 className="font-label-lg text-ink">Finaliser la fiche</h3>
        <p className="text-body-sm text-ink-muted">
          Une fois finalisée, la fiche est verrouillée et ne peut plus être modifiée.
        </p>
      </div>

      {(error || localError) && <p className="text-body-sm text-danger-fg">{error || localError}</p>}

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

      {printedSignatures ? (
        <p className="text-body-sm text-ink-muted">
          Après finalisation, imprimez le procès-verbal (PDF) : le locataire{tenantName ? ` (${tenantName})` : ""} et le cabinet le datent
          et le signent à la main dans les cadres prévus.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SignaturePad ref={tenantPadRef} label="Signature du locataire" signerName={tenantName} />
          <SignaturePad ref={agentPadRef} label="Signature de l'agent" signerName={agentName} />
        </div>
      )}

      <Button type="button" size="lg" onClick={handleFinalize} disabled={submitting} className="self-start">
        <Lock size={16} />
        {submitting ? "Finalisation…" : "Finaliser et verrouiller"}
      </Button>
    </div>
  );
}
