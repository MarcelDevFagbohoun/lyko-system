import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_GATE_HEADER, adminRouting, parseAdminSlug } from "./lib/admin-path";

// Lu au démarrage du serveur (pas figé dans le bundle) : changer l'adresse = redémarrer le conteneur « web ».
const slug = parseAdminSlug(process.env.ADMIN_PATH);
if (process.env.ADMIN_PATH && !slug) {
  console.warn("[admin] ADMIN_PATH ignoré : 10 caractères minimum, lettres minuscules, chiffres et tirets. Le back-office reste sur /admin.");
}

export function middleware(req: NextRequest) {
  const action = adminRouting(req.nextUrl.pathname, slug, req.headers.get(ADMIN_GATE_HEADER));
  if (action === "serve-admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    const headers = new Headers(req.headers);
    headers.set(ADMIN_GATE_HEADER, slug as string);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (action === "hide") {
    const url = req.nextUrl.clone();
    url.pathname = "/_introuvable";
    return NextResponse.rewrite(url, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  // Tout sauf les fichiers statiques de Next, l'API et les fichiers avec extension (images, sw.js…).
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
