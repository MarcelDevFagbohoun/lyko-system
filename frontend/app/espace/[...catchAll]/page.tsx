import { notFound } from "next/navigation";

/**
 * Route de secours pour toute URL sous `/espace/**` qui ne correspond à
 * aucune page définie. Sans elle, Next.js remonterait directement au 404
 * générique du site (`app/not-found.tsx`, en-tête public) au lieu du 404 de
 * l'espace (`app/espace/not-found.tsx`, menu vertical conservé) : un
 * `not-found.tsx` imbriqué ne s'active que via un appel explicite à
 * `notFound()` depuis une page de ce même segment, jamais automatiquement
 * pour une URL qui ne matche rien du tout.
 */
export default function EspaceCatchAll(): never {
  notFound();
}
