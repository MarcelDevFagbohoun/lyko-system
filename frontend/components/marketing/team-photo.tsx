import fs from "node:fs";
import path from "node:path";
import { SectionHeading } from "@/components/marketing/section-heading";

/**
 * Photo d'une équipe souriante qui travaille avec le logiciel. Le bloc n'apparaît que si `public/img/equipe.webp`
 * existe : préparer la photo avec `node scripts/optimize-image.mjs <photo> equipe 1280 640`.
 */
export function TeamPhoto() {
  const has = fs.existsSync(path.join(process.cwd(), "public", "img", "equipe.webp"));
  if (!has) return null;
  const small = fs.existsSync(path.join(process.cwd(), "public", "img", "equipe-640.webp"));
  return (
    <section className="content-shell py-14 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl shadow-xl ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/equipe.webp"
            srcSet={small ? "/img/equipe-640.webp 640w, /img/equipe.webp 1280w" : undefined}
            sizes="(min-width: 1024px) 560px, 92vw"
            alt="Une équipe qui travaille avec Africa Immo Management, sereine et efficace"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col gap-4">
          <SectionHeading align="left" eyebrow="Au quotidien" title="Une équipe sereine, des comptes à jour" description="Fini les cahiers et les calculs à la main : chacun sait ce qu'il a à faire, et la direction voit tout en un coup d'œil." />
        </div>
      </div>
    </section>
  );
}
