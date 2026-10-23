"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fetchSubscription, listMyRefunds, requestRefund, type Refund, type Subscription } from "@/lib/api/billing";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";
import { formatDateLabel } from "@/lib/utils";

export function AnnulationView() {
  return (
    <RequireAuth roles={["dg"]}>
      <AnnulationContent />
    </RequireAuth>
  );
}

function AnnulationContent() {
  const { accessToken } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [sub, setSub] = React.useState<Subscription | null>(null);
  const [refunds, setRefunds] = React.useState<Refund[] | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!accessToken) return;
    Promise.all([fetchSubscription(accessToken), listMyRefunds(accessToken)])
      .then(([s, r]) => { setSub(s); setRefunds(r.refunds); })
      .catch(() => toast.error("Impossible de charger votre abonnement."));
  }, [accessToken, toast]);

  const pending = refunds?.some((r) => ["requested", "approved", "details_received", "processing", "failed"].includes(r.status)) ?? false;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    try {
      await requestRefund(accessToken, reason.trim());
      toast.success("Demande envoyée. Nous vous répondons par e-mail.");
      router.push("/espace/abonnement");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Envoi impossible. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <div className="content-shell flex max-w-2xl flex-col gap-6 py-10">
      <Link href="/espace/abonnement" className="flex items-center gap-1 text-body-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> Retour à l&apos;abonnement
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Demander l&apos;annulation de mon abonnement</CardTitle>
          <CardDescription>
            Notre équipe examine chaque demande. Si elle est acceptée, l&apos;accès à votre espace est fermé aussitôt et vous recevez un e-mail pour indiquer où recevoir votre remboursement.
            Il est calculé sur les jours qu&apos;il vous reste à compter de ce jour (dans les 15 premiers jours, votre premier paiement est remboursé en entier). Les frais du prestataire de paiement sont déduits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sub && !sub.active ? (
            <p className="text-body-sm text-ink-muted">Votre abonnement n&apos;est pas actif, il n&apos;y a rien à annuler.</p>
          ) : pending ? (
            <p className="text-body-sm text-ink-muted">Une demande est déjà en cours d&apos;examen. Nous vous répondrons par e-mail.</p>
          ) : (
            <form onSubmit={send} className="flex flex-col gap-4">
              {sub?.currentPeriodEnd && <p className="text-body-sm text-ink-soft">Abonnement valable jusqu&apos;au {formatDateLabel(sub.currentPeriodEnd.slice(0, 10))}.</p>}
              <label htmlFor="motif" className="font-label-md text-ink">Motif de l&apos;annulation <span className="text-danger-fg">*</span></label>
              <textarea
                id="motif"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
                maxLength={1000}
                required
                placeholder="Expliquez-nous pourquoi vous souhaitez annuler (10 caractères minimum)"
                className="w-full rounded border border-border-strong bg-surface p-3 text-body-md text-ink"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 10}>{busy ? "Envoi…" : "Envoyer ma demande"}</Button>
                <Link href="/espace/abonnement" className={buttonVariants({ variant: "ghost" })}>Retour</Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
