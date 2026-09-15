"use client";

import { MessageCircle, ImageOff, Heart } from "lucide-react";
import { API_URL } from "@/lib/api/client";
import type { MarketplaceListing } from "@/lib/api/marketplace";
import { PROPERTY_TYPE_LABELS, unitDesignationLabel } from "@/lib/constants/properties";
import { buildWhatsAppHref, formatFcfa } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export function ListingCard({
  listing,
  tenantPhone,
  isFavorite = false,
  canFavorite = false,
  onToggleFavorite,
}: {
  listing: MarketplaceListing;
  tenantPhone: string;
  isFavorite?: boolean;
  canFavorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const title = `${PROPERTY_TYPE_LABELS[listing.propertyType]} — ${unitDesignationLabel(listing.designation, listing.designationCustom)}`;
  const message = [
    "Bonjour, je suis intéressé(e) par ce bien :",
    title,
    `${formatFcfa(listing.monthlyRent)}/mois${listing.address ? ` — ${listing.address}` : ""}`,
  ].join("\n");
  const whatsappHref = buildWhatsAppHref(tenantPhone, message);

  return (
    <Card className="overflow-hidden">
      <div className="relative flex h-48 items-center justify-center bg-surface-muted">
        {listing.photoUrls[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${listing.photoUrls[0]}`} alt={title} className="h-full w-full object-cover" />
        ) : (
          <ImageOff size={28} className="text-ink-faint" />
        )}
        {canFavorite && (
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface/90 shadow-sm hover:bg-surface"
          >
            <Heart size={18} className={isFavorite ? "fill-danger text-danger" : "text-ink-soft"} />
          </button>
        )}
      </div>
      <CardContent className="flex flex-col gap-2 py-4">
        <p className="font-label-md text-ink">{title}</p>
        {listing.address && <p className="text-body-xs text-ink-muted">{listing.address}</p>}
        <p className="tabular font-currency-display text-primary">{formatFcfa(listing.monthlyRent)}/mois</p>
        {listing.furnished && (
          <span className="inline-flex w-fit rounded-full bg-info-bg px-2 py-0.5 text-body-xs text-info-fg">
            Meublé
          </span>
        )}
        {listing.description && <p className="text-body-sm text-ink-soft">{listing.description}</p>}
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "whatsapp", className: "mt-2 w-full justify-center" })}
        >
          <MessageCircle size={16} />
          Contacter sur WhatsApp
        </a>
      </CardContent>
    </Card>
  );
}
