import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LEGAL } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1">
        <article className="content-shell max-w-3xl py-10 sm:py-14">
          <h1 className="font-display text-headline-md text-ink">{title}</h1>
          <p className="mt-1 text-body-sm text-ink-muted">Dernière mise à jour : {LEGAL.updatedOn}</p>
          <div className="mt-8 flex flex-col gap-6 text-body-md text-ink-soft [&_h2]:mb-2 [&_h2]:font-label-lg [&_h2]:text-ink [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
