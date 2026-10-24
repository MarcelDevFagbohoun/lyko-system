import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { Pricing } from "@/components/marketing/pricing";
import { TeamPhoto } from "@/components/marketing/team-photo";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Faq, FAQ_ITEMS } from "@/components/marketing/faq";
import { CtaBanner } from "@/components/marketing/cta-banner";
import { Reveal } from "@/components/marketing/reveal";

/**
 * Landing page publique — accessible sans connexion. Parcours : promesse (héros) → tarifs → aperçu bref des
 * fonctionnalités (sans détail, pour ne pas servir de modèle à la copie) → photo d'équipe (si présente) →
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
        "Logiciel de gestion locative pensé pour le Bénin.",
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
        <Reveal><Features /></Reveal>
        <Reveal><TeamPhoto /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><Faq /></Reveal>
        <Reveal><CtaBanner /></Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
