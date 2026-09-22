"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { API_URL, ApiError } from "@/lib/api/client";
import { getPaymentLink, verifyPaymentLink, type PaymentLinkInfo } from "@/lib/api/paymentLinks";
import { PayNowButton } from "@/components/payments/pay-now-button";
import { formatFcfa } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

const KIND_LABELS: Record<PaymentLinkInfo["kind"], string> = {
  loyer: "Paiement de loyer",
  charge: "Règlement de facture SONEB/SBEE",
};

/**
 * Page publique de paiement par lien (personnel → locataire sans portail
 * actif, envoyé à la main par WhatsApp) — sans compte, sans mot de passe :
 * le token du chemin est le seul secret, comme le portail locataire.
 */
export function PayerView() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = React.useState<PaymentLinkInfo | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [paid, setPaid] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    getPaymentLink(token)
      .then(setLink)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Ce lien de paiement est invalide ou expiré."),
      );
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas">
      <header className="flex w-full items-center justify-center border-b border-border bg-surface px-4 py-4">
        {link?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${link.logoUrl}`} alt={link.companyName ?? "Logo"} className="h-9 w-auto object-contain" />
        ) : (
          <span className="font-display text-headline-md text-ink">{link?.companyName ?? "Lyko System"}</span>
        )}
      </header>

      <main className="flex w-full flex-1 flex-col items-center px-4 py-10">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            {loadError ? (
              <>
                <AlertTriangle size={28} className="text-danger-fg" />
                <p className="font-label-md text-ink">{loadError}</p>
                <p className="text-body-sm text-ink-muted">
                  Demandez un nouveau lien à votre agence si celui-ci ne fonctionne plus.
                </p>
              </>
            ) : paid ? (
              <>
                <CheckCircle2 size={32} className="text-success-fg" />
                <p className="font-label-md text-success-fg">Paiement confirmé</p>
                <p className="text-body-sm text-ink-muted">Merci ! Votre règlement a bien été enregistré.</p>
              </>
            ) : !link ? (
              <p className="text-body-sm text-ink-muted">Chargement…</p>
            ) : (
              <>
                <p className="text-body-sm text-ink-muted">{KIND_LABELS[link.kind]}</p>
                <p className="tabular font-display text-headline-lg text-ink">{formatFcfa(link.amount)}</p>
                {link.kkiapayPublicKey ? (
                  <PayNowButton
                    amount={link.amount}
                    reference={`t${link.tenantId}:link:${token}`}
                    publicKey={link.kkiapayPublicKey}
                    sandbox={link.kkiapaySandbox}
                    onVerify={(transactionId) => verifyPaymentLink(token, transactionId)}
                    onPaid={() => setPaid(true)}
                  />
                ) : (
                  <p className="text-body-sm text-danger-fg">
                    Le paiement en ligne n&apos;est plus disponible pour le moment.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
