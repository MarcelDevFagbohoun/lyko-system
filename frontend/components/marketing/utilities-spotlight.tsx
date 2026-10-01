import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { SectionHeading } from "@/components/marketing/section-heading";
import { formatFcfa } from "@/lib/utils";

const STEPS = [
  {
    title: "Le relevé du mois",
    text: "Vous saisissez l'index du compteur principal et celui de chaque décompteur. Les factures des locataires se calculent seules.",
  },
  {
    title: "L'encaissement",
    text: "Vous encaissez chez les locataires, paiements partiels compris. Les impayés restent visibles et relançables par WhatsApp.",
  },
  {
    title: "Le point avec le propriétaire",
    text: "Le propriétaire règle la facture mère. Lyko compare : facturé, encaissé, impayés, consommation non refacturée.",
  },
  {
    title: "Le reversement",
    text: "Les charges encaissées lui sont reversées, avec un carnet PDF et des alertes si un relevé manque ou si l'écart est élevé.",
  },
] as const;

/** Vitrine du module Charges SONEB/SBEE — le différenciant le plus local du produit. */
export function UtilitiesSpotlight() {
  return (
    <section id="charges" className="content-shell py-14 sm:py-20">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Charges SONEB & SBEE"
            title="Le propriétaire ne perd plus d'argent sur l'eau et l'électricité"
            description="Le propriétaire paie la facture mère, l'entreprise encaisse les locataires. Lyko fait la différence à votre place, mois par mois."
          />
          <ol className="mt-8 flex flex-col gap-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-bg font-label-md text-primary">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-display text-headline-sm text-ink">{step.title}</h3>
                  <p className="mt-0.5 text-body-md text-ink-soft">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Aperçu construit avec les vrais composants de la charte — chiffres fictifs, signalés comme tels. */}
        <Card className="p-4 shadow-lg sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Le point des charges</p>
              <p className="font-display text-headline-sm text-ink">SONEB · un immeuble, un mois</p>
            </div>
            <Badge variant="neutral">Exemple</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Facture mère payée" value={formatFcfa(100_000, { withSuffix: false })} unit="FCFA" />
            <StatCard label="Encaissé chez les locataires" tone="info" value={formatFcfa(35_000, { withSuffix: false })} unit="FCFA" />
            <StatCard label="Reste à charge du propriétaire" tone="danger" value={formatFcfa(65_000, { withSuffix: false })} unit="FCFA" />
            <StatCard label="Impayés des locataires" tone="warning" value={formatFcfa(25_000, { withSuffix: false })} unit="FCFA" />
          </div>
          <p className="mt-3 text-body-sm text-ink-soft">
            Sur les 65 000 FCFA restants, 40 000 FCFA sont de la consommation non refacturée (parties communes, fuite) et
            25 000 FCFA des impayés encore récupérables.
          </p>
        </Card>
      </div>
    </section>
  );
}
