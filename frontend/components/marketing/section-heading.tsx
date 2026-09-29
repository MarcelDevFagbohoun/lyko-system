/**
 * Titre de section de la page publique : sur-titre, titre, chapeau — centré ou aligné à gauche.
 *
 * Classes assemblées en simples chaînes, VOLONTAIREMENT sans `cn()` : `tailwind-merge` prend
 * `text-headline-xl` (taille personnalisée) pour une couleur et la supprime dès qu'une vraie couleur
 * (`text-ink`, `text-white`) est présente — le titre retombait alors à la taille du texte courant.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  inverse = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  inverse?: boolean;
}) {
  const box = align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl text-left";
  const eyebrowColor = inverse ? "text-white/70" : "text-primary";
  const titleColor = inverse ? "text-white" : "text-ink";
  const descColor = inverse ? "text-white/85" : "text-ink-soft";
  return (
    <div className={box}>
      {eyebrow && <p className={`font-label-sm uppercase tracking-wider ${eyebrowColor}`}>{eyebrow}</p>}
      <h2 className={`mt-2 font-display text-headline-xl ${titleColor}`}>{title}</h2>
      {description && <p className={`mt-3 text-body-lg ${descColor}`}>{description}</p>}
    </div>
  );
}
