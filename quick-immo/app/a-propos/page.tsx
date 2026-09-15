import type { Metadata } from "next";
import { ShieldCheck, Handshake, Search, Scale } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "À propos" };

const POINTS = [
  {
    icon: Search,
    title: "Des biens vérifiés",
    text: "Chaque annonce est gérée par une agence partenaire, suivie via Lyko System — jamais un particulier anonyme.",
  },
  {
    icon: Handshake,
    title: "Un accompagnement complet",
    text: "De la mise en location à la gestion quotidienne, nos agences partenaires s'occupent de tout pour vous.",
  },
  {
    icon: ShieldCheck,
    title: "Une gestion sérieuse",
    text: "Chaque agence partenaire suit ses biens grâce à Lyko System, la plateforme de gestion locative.",
  },
];

export default function AProposPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="flex-1">
        <div className="content-shell flex flex-col gap-10 py-12">
          <div className="text-center">
            <h1 className="font-display text-headline-xl text-ink">À propos de Quick Immo</h1>
            <p className="mx-auto mt-2 max-w-2xl text-body-md text-ink-soft">
              Quick Immo n&apos;est pas une agence immobilière : c&apos;est une plateforme qui met en relation
              directe les agences immobilières et les propriétaires souhaitant louer ou vendre un bien. Un
              propriétaire peut confier son bien à l&apos;une de nos agences partenaires, qui s&apos;occupe ensuite
              de tout pour lui.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {POINTS.map((p) => (
              <Card key={p.title}>
                <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-bg text-primary">
                    <p.icon size={18} />
                  </span>
                  <p className="font-label-md text-ink">{p.title}</p>
                  <p className="text-body-sm text-ink-muted">{p.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-success-border bg-success-bg/40">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center sm:flex-row sm:items-start sm:text-left">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-fg">
                <Scale size={22} />
              </span>
              <div>
                <p className="font-label-md text-ink">Notre engagement</p>
                <p className="mt-1 text-body-sm text-ink-soft">
                  Nous faisons respecter la loi : pour toute location publiée sur Quick Immo, la commission
                  d&apos;agence ne doit jamais excéder 50 % du loyer.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
