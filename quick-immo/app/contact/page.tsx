"use client";

import * as React from "react";
import { MessageCircle, Phone } from "lucide-react";
import { getPublicMarketplace, type PublicMarketplace } from "@/lib/api/marketplace";
import { buildWhatsAppHref } from "@/lib/utils";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default function ContactPage() {
  const [data, setData] = React.useState<PublicMarketplace | null>(null);

  React.useEffect(() => {
    getPublicMarketplace().then(setData).catch(() => {
      // Coordonnées non essentielles à l'affichage de la page elle-même.
    });
  }, []);

  const phone = data?.tenant.phone;
  const whatsappHref = phone ? buildWhatsAppHref(phone, "Bonjour, je vous contacte depuis Quick Immo.") : "#";

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="flex-1">
        <div className="content-shell flex flex-col items-center gap-6 py-14">
          <div className="text-center">
            <h1 className="font-display text-headline-xl text-ink">Contactez-nous</h1>
            <p className="mt-2 text-body-md text-ink-soft">
              Une question sur un bien, une demande de location ou de vente ? Écrivez-nous directement.
            </p>
          </div>

          <Card className="w-full max-w-md">
            <CardHeader>
              <p className="text-body-xs font-label-md uppercase tracking-wide text-ink-faint">Agence partenaire</p>
              <CardTitle>{data?.tenant.companyName ?? "Quick Immo"}</CardTitle>
              <CardDescription>Nous répondons généralement rapidement sur WhatsApp.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {phone && (
                <div className="flex items-center gap-2 text-body-md text-ink">
                  <Phone size={16} className="text-ink-muted" />
                  {phone}
                </div>
              )}
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "whatsapp", className: "w-full justify-center" })}
              >
                <MessageCircle size={16} />
                Écrire sur WhatsApp
              </a>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
