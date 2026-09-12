import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Hero } from "@/components/marketing/hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SecurityBand } from "@/components/marketing/security-band";
import { CtaBanner } from "@/components/marketing/cta-banner";

/**
 * Landing page publique (étape 1, section 4.1 du cahier des charges).
 * Accessible sans connexion — présente Lyko System et oriente vers
 * l'inscription ou la connexion.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <FeatureGrid />
        <HowItWorks />
        <SecurityBand />
        <CtaBanner />
      </main>
      <SiteFooter />
    </div>
  );
}
