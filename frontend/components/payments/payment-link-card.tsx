"use client";

import * as React from "react";
import { Link2, Copy, Check, MessageCircle } from "lucide-react";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { ApiError } from "@/lib/api/client";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

/**
 * Génère un lien de paiement KKiaPay à envoyer à la main (WhatsApp) — pour
 * un locataire sans portail actif. Même schéma de révélation unique que
 * `PortalLinkCard` (fiche locataire) : le lien en clair n'est affiché
 * qu'une fois, juste après la génération.
 */
export function PaymentLinkCard({
  title,
  description,
  phone,
  whatsappMessage,
  onGenerate,
}: {
  title: string;
  description: string;
  phone: string | null | undefined;
  whatsappMessage: (url: string, amount: number) => string;
  onGenerate: () => Promise<{ path: string; amount: number }>;
}) {
  const [open, setOpen] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<{ url: string; amount: number } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await onGenerate();
      const url = `${window.location.origin}${res.path}`;
      setLink({ url, amount: res.amount });
      setOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer le lien de paiement.");
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le lien reste visible pour une copie manuelle.
    }
  }

  const whatsappHref = link && phone ? buildWhatsAppHref(phone, whatsappMessage(link.url, link.amount)) : "#";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {!open && (
            <Button type="button" variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
              <Link2 size={14} />
              {generating ? "Génération…" : "Générer un lien de paiement"}
            </Button>
          )}
        </div>
      </CardHeader>
      {(error || (open && link)) && (
        <CardContent className="flex flex-col gap-3">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          {open && link && (
            <>
              <p className="text-body-sm text-ink-soft">Montant : {formatFcfa(link.amount)}</p>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
                <code className="truncate text-body-sm text-ink">{link.url}</code>
                <Button type="button" variant="ghost" size="sm" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copié" : "Copier"}
                </Button>
              </div>
              <p className="text-body-xs text-ink-muted">
                Ce lien expire sous 48h et ne sera plus affiché ensuite — envoyez-le maintenant.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button type="button" variant="whatsapp" className="w-full" disabled={!phone}>
                    <MessageCircle size={18} />
                    Envoyer par WhatsApp
                  </Button>
                </a>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Fermer
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
