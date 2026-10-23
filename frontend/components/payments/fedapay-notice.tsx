"use client";

import * as React from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { getPaymentSummary } from "@/lib/api/payments";

/** `true` quand l'entreprise a activé FedaPay : la saisie manuelle des reversements est alors interdite (le serveur la refuse). */
export function useFedapayEnabled(): boolean {
  const { accessToken } = useAuth();
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    if (!accessToken) return;
    getPaymentSummary(accessToken)
      .then((s) => setEnabled(!!s.enabled))
      .catch(() => setEnabled(false));
  }, [accessToken]);
  return enabled;
}

export function FedapayNotice({ what }: { what: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info-border bg-info-bg px-3 py-2.5 text-body-sm text-info-fg">
      <span>
        FedaPay est activé : {what} s&apos;effectue depuis le menu Paiements (envoi Mobile Money, reçu automatique).
      </span>
      <Link href="/espace/paiements" className="inline-flex items-center gap-1.5 font-label-md text-primary hover:underline">
        <Send size={14} /> Aller aux paiements
      </Link>
    </div>
  );
}
