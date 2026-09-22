"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { payWithKkiapay } from "@/lib/kkiapay";
import { Button } from "@/components/ui/button";

/**
 * Bouton « Payer maintenant » — ouvre le widget KKiaPay puis revérifie côté
 * serveur (`onVerify`). Partagé entre le portail locataire et la page
 * publique de paiement par lien (`/payer/[token]`).
 *
 * `reference` DOIT suivre exactement le format attendu par le backend
 * (`t<tenantId>:rent:<leaseId>` / `:charge:<chargeId>` / `:link:<token>`,
 * voir `backend/src/services/paymentVerification.js`) : c'est ce qui permet
 * au serveur de recouper, auprès de KKiaPay elle-même, que la transaction
 * confirmée correspond bien à CE paiement précis — et non à un autre,
 * rejoué avec un `transactionId` volé ailleurs.
 */
export function PayNowButton({
  amount,
  reference,
  publicKey,
  sandbox,
  onVerify,
  onPaid,
  label = "Payer maintenant",
}: {
  amount: number;
  reference: string;
  publicKey: string;
  sandbox: boolean;
  onVerify: (transactionId: string) => Promise<unknown>;
  onPaid: () => void;
  label?: string;
}) {
  const [paying, setPaying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const { transactionId } = await payWithKkiapay({ amount, publicKey, sandbox, reference });
      await onVerify(transactionId);
      onPaid();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Paiement impossible.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="success" onClick={handlePay} disabled={paying}>
        <CreditCard size={16} />
        {paying ? "Paiement en cours…" : label}
      </Button>
      {error && <p className="text-body-xs text-danger-fg">{error}</p>}
    </div>
  );
}
