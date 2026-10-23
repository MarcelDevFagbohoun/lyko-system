import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Hero } from "@/components/marketing/hero";
import { Pricing } from "@/components/marketing/pricing";
import { TeamPhoto } from "@/components/marketing/team-photo";
import { MadeForBenin } from "@/components/marketing/made-for-benin";
import { ProblemSolution } from "@/components/marketing/problem-solution";
import { Roles } from "@/components/marketing/roles";
import { MoneyCompliance } from "@/components/marketing/money-compliance";
import { SecurityBand } from "@/components/marketing/security-band";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Faq, FAQ_ITEMS } from "@/components/marketing/faq";
import { CtaBanner } from "@/components/marketing/cta-banner";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Landing page publique — accessible sans connexion. Parcours : promesse (héros) → tarifs → ancrage local →
 * avant/après → un espace par métier → photo d'équipe (si présente) → argent et comptabilité → confiance →
 * démarrage → questions → appel à l'action. Aucun témoignage ni chiffre de performance inventé.
 */

// Données structurées (référencement) : uniquement des faits vérifiables, pas de note.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Africa Immo Management",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "fr",
      description:
        "Logiciel de gestion locative pensé pour le Bénin : loyers, relances WhatsApp, propriétaires, quittances et comptabilité SYSCOHADA.",
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
        <Pricing />
        <Reveal><MadeForBenin /></Reveal>
        <Reveal><ProblemSolution /></Reveal>
        <Reveal><Roles /></Reveal>
        <Reveal><TeamPhoto /></Reveal>
        <Reveal><MoneyCompliance /></Reveal>
        <Reveal><SecurityBand /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><Faq /></Reveal>
        <Reveal><CtaBanner /></Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
