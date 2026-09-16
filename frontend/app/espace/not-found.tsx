import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 propre à l'espace connecté : une URL sous `/espace/**` qui ne
 * correspond à rien (lien mal tapé, ancienne page renommée...) affiche ce
 * message SANS perdre le menu vertical (`app/espace/layout.tsx` continue de
 * l'englober) — jamais le 404 générique du site public, qui ferait
 * disparaître la navigation d'un utilisateur pourtant déjà connecté.
 */
export default function EspaceNotFound() {
  return (
    <div className="content-shell flex min-h-[70vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg text-primary">
        <FileQuestion size={30} />
      </span>
      <div>
        <h1 className="font-display text-headline-xl text-ink">Page introuvable</h1>
        <p className="mx-auto mt-2 max-w-md text-body-md text-ink-soft">
          Cette page de votre espace n&apos;existe pas ou n&apos;existe plus. Utilisez le menu à
          gauche, ou repartez du tableau de bord.
        </p>
      </div>
      <Link href="/espace" className={buttonVariants({ variant: "primary", size: "lg" })}>
        Retourner à mon espace
      </Link>
    </div>
  );
}
