import { ShieldCheck, Lock, KeySquare } from "lucide-react";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Un espace cloisonné par entreprise",
    description:
      "Chaque entreprise inscrite dispose de ses propres locataires, biens, employés et données financières, invisibles des autres entreprises.",
  },
  {
    icon: KeySquare,
    title: "Des rôles et des permissions précis",
    description:
      "L'Admin attribue à chaque employé exactement ce dont il a besoin : un agent n'a pas accès à la comptabilité, un comptable ne crée pas d'employés.",
  },
  {
    icon: Lock,
    title: "Authentification sécurisée",
    description:
      "Connexion par mot de passe hashé et jetons à durée de vie courte, avec changement obligatoire du mot de passe temporaire à la première connexion.",
  },
] as const;

export function SecurityBand() {
  return (
    <section id="securite" className="content-shell py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-headline-xl text-ink">Sécurité & multi-entreprise</h2>
        <p className="mt-3 text-body-lg text-ink-soft">
          Conçu pour que plusieurs entreprises partagent la même plateforme sans jamais
          partager leurs données.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon size={22} />
            </div>
            <h3 className="font-display text-headline-sm text-ink">{title}</h3>
            <p className="text-body-md text-ink-soft">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
