import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Hero } from "@/components/marketing/hero";
import { MadeForBenin } from "@/components/marketing/made-for-benin";
import { ProblemSolution } from "@/components/marketing/problem-solution";
import { Roles } from "@/components/marketing/roles";
import { UtilitiesSpotlight } from "@/components/marketing/utilities-spotlight";
import { MoneyCompliance } from "@/components/marketing/money-compliance";
import { SecurityBand } from "@/components/marketing/security-band";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Faq, FAQ_ITEMS } from "@/components/marketing/faq";
import { CtaBanner } from "@/components/marketing/cta-banner";

/**
 * Landing page publique — accessible sans connexion. Parcours : promesse (héros) → ancrage local →
 * avant/après → un espace par métier → vitrine des charges SONEB/SBEE → argent et comptabilité →
 * confiance → démarrage → questions → appel à l'action. Aucun tarif, aucun témoignage, aucun chiffre
 * de performance inventé : chaque affirmation correspond à une fonction réellement construite.
 */

// Données structurées (référencement) : uniquement des faits vérifiables — pas de prix, pas de note.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Lyko System",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "fr",
      description:
        "Logiciel de gestion locative pensé pour le Bénin : loyers, charges SONEB/SBEE, propriétaires, quittances et comptabilité SYSCOHADA.",
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <MadeForBenin />
        <ProblemSolution />
        <Roles />
        <UtilitiesSpotlight />
        <MoneyCompliance />
        <SecurityBand />
        <HowItWorks />
        <Faq />
        <CtaBanner />
      </main>
      <SiteFooter />
    </div>
  );
}
