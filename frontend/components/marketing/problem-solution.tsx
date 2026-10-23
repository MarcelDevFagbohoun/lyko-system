import { Check, X } from "lucide-react";
import { SectionHeading } from "@/components/marketing/section-heading";

const ROWS = [
  {
    before: "Les loyers sont notés sur un cahier ou un tableur : on découvre les retards trop tard.",
    after: "Une frise des 12 derniers mois par locataire, les retards repérés seuls, une relance WhatsApp en un clic.",
  },
  {
    before: "Les quittances sont rédigées à la main, une par une.",
    after: "Une quittance PDF numérotée à chaque paiement, avec un lien prêt à envoyer par WhatsApp.",
  },
  {
    before: "Eau et électricité : difficile de dire qui a réglé sa part et qui doit encore payer.",
    after: "Les charges de chaque logement suivies au même endroit : réglé, en attente, impayé.",
  },
  {
    before: "Les relevés des propriétaires se calculent à la main, en fin de mois.",
    after: "Un relevé mensuel PDF avec commission, dépenses et versements, et un solde séquestre toujours à jour.",
  },
  {
    before: "Un paiement saisi deux fois, et personne ne sait qui a fait quoi.",
    after: "Un paiement en double ne s'enregistre qu'une fois, et chaque action est datée et attribuée.",
  },
  {
    before: "La comptabilité se refait en fin d'année, à partir de papiers.",
    after: "Les écritures se génèrent au fil des opérations, avec grand livre, bilan et compte de résultat (module optionnel).",
  },
] as const;

export function ProblemSolution() {
  return (
    <section className="content-shell py-14 sm:py-20">
      <SectionHeading
        eyebrow="Du cahier au logiciel"
        title="Ce qui change dès la première semaine"
        description="Les mêmes tâches, sans oublis ni calculs à la main."
      />
      <div className="mt-10 grid grid-cols-1 gap-3 sm:gap-4">
        <div className="hidden grid-cols-2 gap-4 px-1 sm:grid">
          <p className="font-label-sm uppercase tracking-wider text-ink-muted">Aujourd&apos;hui</p>
          <p className="font-label-sm uppercase tracking-wider text-primary">Avec Africa Immo Management</p>
        </div>
        {ROWS.map((row) => (
          <div key={row.after} className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-4">
              <X size={18} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
              <p className="text-body-md text-ink-soft">{row.before}</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-primary-border bg-primary-bg p-4">
              <Check size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              <p className="text-body-md text-ink">{row.after}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
