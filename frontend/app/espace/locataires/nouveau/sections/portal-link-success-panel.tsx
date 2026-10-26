"use client";

import * as React from "react";
import Link from "next/link";
import {
  Copy,
  Check,
  MessageCircle,
  FileDown,
} from "lucide-react";
import { openAuthenticatedPdf } from "@/lib/api/client";
import { entryReceiptPdfPath } from "@/lib/api/renters";
import { buildWhatsAppHref } from "@/lib/validation/auth";
import { formatFcfa } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { CreatedRenter } from "./types";

/**
 * Affiché juste après la création : le lien du portail locataire vient
 * d'être généré automatiquement (étape 13, idée n°2) et n'est montré qu'une
 * seule fois ici — même schéma que le mot de passe temporaire d'un nouvel
 * employé (`app/espace/employes/nouveau`). Si perdu, on repasse par
 * « Régénérer le lien » sur la fiche du locataire.
 */
export function PortalLinkSuccessPanel({ renter, accessToken }: { renter: CreatedRenter; accessToken: string | null }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(renter.portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le lien reste visible pour une copie manuelle.
    }
  }

  const message = [
    `Bonjour ${renter.firstName},`,
    `Bienvenue ! Voici votre espace personnel pour suivre vos paiements de loyer, télécharger vos quittances et signaler un problème :`,
    renter.portalUrl,
    `Ce lien est personnel, ne le partagez pas.`,
  ].join("\n");
  const whatsappHref = buildWhatsAppHref(renter.phone, message);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <Badge variant="success" className="mb-2 w-fit">
          Locataire créé
        </Badge>
        <CardTitle>{renter.firstName} peut déjà suivre ses paiements</CardTitle>
        <CardDescription>
          Un lien personnel, sans mot de passe, a été généré automatiquement — il donne accès aux paiements,
          quittances, contrat de bail et au signalement d&apos;incidents de ce locataire uniquement. Il ne sera
          plus affiché ensuite (une régénération reste possible depuis sa fiche).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {renter.entryProrata.proration === "prorata" && renter.entryProrata.amount > 0 && (
          <div className="rounded-lg border border-primary-border bg-primary-bg px-4 py-3 text-body-sm text-ink">
            Prorata d&apos;entrée de <strong>{formatFcfa(renter.entryProrata.amount)}</strong> ({renter.entryProrata.days} jour
            {renter.entryProrata.days > 1 ? "s" : ""}) ajouté au compte séquestre du propriétaire de ce Bien.
          </div>
        )}
        {renter.additionalDeposits.length > 0 && (
          <div className="rounded-lg border border-primary-border bg-primary-bg px-4 py-3 text-body-sm text-ink">
            Cautions supplémentaires enregistrées :{" "}
            {renter.additionalDeposits.map((d) => `${d.typeLabel} (${formatFcfa(d.amount)})`).join(", ")}.
          </div>
        )}
        {renter.entryReceipt && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-success-border bg-success-bg px-4 py-3">
            <span className="text-body-sm text-ink">
              Reçu d&apos;entrée <strong>{renter.entryReceipt.number}</strong> généré (caution, frais d&apos;agence, cautions
              supplémentaires et prorata payés à la signature).
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => accessToken && openAuthenticatedPdf(entryReceiptPdfPath(renter.leaseId), accessToken)}
            >
              <FileDown size={16} />
              Télécharger
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
          <code className="truncate text-body-sm text-ink">{renter.portalUrl}</code>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copié" : "Copier"}
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "whatsapp", className: "flex-1" })}
          >
            <MessageCircle size={18} />
            Envoyer par WhatsApp
          </a>
          <Link
            href={`/espace/locataires/${renter.renterId}`}
            className={buttonVariants({ variant: "secondary", className: "flex-1" })}
          >
            Voir la fiche du locataire
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
