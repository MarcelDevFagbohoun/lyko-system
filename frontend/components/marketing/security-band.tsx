import { BadgeCheck, History, KeySquare, Lock, ShieldCheck, WifiOff } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Un espace cloisonné par entreprise",
    description:
      "Chaque entreprise dispose de ses propres locataires, biens, employés et données financières, invisibles des autres entreprises.",
  },
  {
    icon: KeySquare,
    title: "Des rôles et des permissions précis",
    description:
      "La direction attribue à chaque employé exactement ce dont il a besoin : un agent n'accède pas à la comptabilité, un comptable ne crée pas d'employés.",
  },
  {
    icon: Lock,
    title: "Connexion sécurisée",
    description:
      "Mots de passe protégés, sessions à durée courte, mot de passe temporaire à changer dès la première connexion.",
  },
  {
    icon: History,
    title: "Tout est tracé",
    description:
      "Le journal d'activité garde qui a fait quoi et quand ; un paiement mal saisi s'annule, il ne s'efface pas en silence.",
  },
  {
    icon: BadgeCheck,
    title: "Des documents vérifiables",
    description:
      "Quittances, contrats de bail et relevés portent un code de vérification : n'importe qui peut contrôler leur authenticité sur la page publique.",
  },
  {
    icon: WifiOff,
    title: "Utilisable malgré les coupures",
    description:
      "Les pages déjà ouvertes restent consultables sans réseau, et un paiement de loyer ou une plainte saisis hors connexion sont synchronisés au retour.",
  },
] as const;

export function SecurityBand() {
  return (
    <section id="securite" className="content-shell py-14 sm:py-20">
      <SectionHeading
        eyebrow="Confiance"
        title="Sécurité, traçabilité et fiabilité"
        description="Conçu pour que plusieurs entreprises partagent la même plateforme sans jamais partager leurs données."
      />
      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
