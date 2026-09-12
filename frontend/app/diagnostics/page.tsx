import type { Metadata } from "next";
import { LykoLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableAmount,
} from "@/components/ui/table";
import { ConnectionIndicator } from "@/components/system/connection-indicator";
import { HealthPanel } from "@/components/system/health-panel";
import { formatFcfa } from "@/lib/utils";

export const metadata: Metadata = { title: "Diagnostic technique" };

const PALETTE: { name: string; className: string; hex: string }[] = [
  { name: "primary", className: "bg-primary", hex: "#1E3A8A" },
  { name: "primary-hover", className: "bg-primary-hover", hex: "#1E40AF" },
  { name: "canvas", className: "bg-canvas border border-border", hex: "#F8FAFC" },
  { name: "surface-muted", className: "bg-surface-muted", hex: "#F1F5F9" },
  { name: "border", className: "bg-border", hex: "#E2E8F0" },
  { name: "success", className: "bg-success", hex: "#059669" },
  { name: "warning", className: "bg-warning", hex: "#D97706" },
  { name: "danger", className: "bg-danger", hex: "#DC2626" },
  { name: "info", className: "bg-info", hex: "#2563EB" },
  { name: "whatsapp", className: "bg-whatsapp", hex: "#25D366" },
];

/**
 * Page technique interne (non liée depuis la navigation publique) :
 * vérifie en un coup d'œil le câblage front ↔ API ↔ MySQL et la charte
 * graphique. Conservée depuis l'étape 0 comme outil de diagnostic continu.
 */
export default function DiagnosticsPage() {
  return (
    <main className="min-h-screen bg-canvas">
      {/* Barre haute — 56px, comme la charte */}
      <header className="sticky top-0 z-40 flex h-topbar items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
        <LykoLogo />
        <div className="flex items-center gap-3">
          <ConnectionIndicator />
          <Badge variant="primary">DG</Badge>
        </div>
      </header>

      <div className="content-shell flex flex-col gap-8 py-10">
        {/* En-tête de page */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="info">Diagnostic</Badge>
            <span className="text-body-xs text-ink-muted">Page technique interne</span>
          </div>
          <h1 className="font-display text-headline-2xl text-ink">
            Lyko System, socle opérationnel
          </h1>
          <p className="max-w-2xl text-body-lg text-ink-soft">
            Next.js 14 (App Router) + Express/MySQL + JWT + PWA. Cette page vérifie la
            charte graphique et le câblage front ↔ API ↔ base de données à chaque étape.
          </p>
        </section>

        {/* Diagnostic technique */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnostic du socle</CardTitle>
            <CardDescription>
              L&apos;API répond et la connexion MySQL est fonctionnelle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HealthPanel />
          </CardContent>
        </Card>

        {/* Cartes statistiques — gabarit unique */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Loyers recouvrés"
            value={<span>{formatFcfa(18_450_000, { withSuffix: false })}</span>}
            unit="FCFA"
            trend={{ value: "+8,5 % vs M-1", direction: "up" }}
          />
          <StatCard
            label="Impayés critiques"
            tone="danger"
            value={<span>{formatFcfa(2_350_000, { withSuffix: false })}</span>}
            unit="FCFA"
            trend={{ value: "12 dossiers", direction: "down" }}
          />
          <StatCard label="Taux d'occupation" value="94,2" unit="%" trend={{ value: "148 / 157 lots", direction: "flat" }} />
          <StatCard
            label="Trésorerie entreprise"
            value={<span>{formatFcfa(6_720_500, { withSuffix: false })}</span>}
            unit="FCFA"
          />
        </section>

        {/* Composants de base */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Boutons</CardTitle>
              <CardDescription>Variantes de la charte</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="primary">Nouvel encaissement</Button>
              <Button variant="secondary">Exporter</Button>
              <Button variant="destructive">Résilier le bail</Button>
              <Button variant="ghost">Détails</Button>
              <Button variant="whatsapp">Relancer sur WhatsApp</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Statuts</CardTitle>
              <CardDescription>Couleurs cohérentes sur toute la plateforme</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge variant="success" dot>
                À jour
              </Badge>
              <Badge variant="warning" dot>
                En cours
              </Badge>
              <Badge variant="danger" dot>
                Impayé
              </Badge>
              <Badge variant="info" dot>
                Procédure
              </Badge>
              <Badge variant="neutral">Brouillon</Badge>
            </CardContent>
          </Card>
        </div>

        {/* Tableau dense */}
        <Card>
          <CardHeader>
            <CardTitle>Derniers encaissements</CardTitle>
            <CardDescription>Gabarit de tableau « registre », montants alignés à droite</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Locataire</TableHead>
                  <TableHead>Bien / Lot</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-label-md">Mme Viviane AGBOTON</TableCell>
                  <TableCell className="text-ink-soft">Appt 3B, Palmiers, Cadjéhoun</TableCell>
                  <TableAmount>{formatFcfa(450_000)}</TableAmount>
                  <TableCell className="text-center">
                    <Badge variant="success" dot>
                      Validé
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-label-md">Sté BENIN LOGISTICS SAS</TableCell>
                  <TableCell className="text-ink-soft">Bureaux Lot 104, Immeuble Marina</TableCell>
                  <TableAmount>{formatFcfa(850_000)}</TableAmount>
                  <TableCell className="text-center">
                    <Badge variant="success" dot>
                      Validé
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-label-md">Pascal HOUNKPONOU</TableCell>
                  <TableCell className="text-ink-soft">Lot 4, Rés. Palmiers</TableCell>
                  <TableAmount className="text-danger">{formatFcfa(600_000)}</TableAmount>
                  <TableCell className="text-center">
                    <Badge variant="danger" dot>
                      Impayé 18 j
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Palette */}
        <Card>
          <CardHeader>
            <CardTitle>Palette</CardTitle>
            <CardDescription>Tokens Tailwind. Aucune couleur hors de cette liste.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PALETTE.map((c) => (
              <div key={c.name} className="flex flex-col gap-1.5">
                <div className={`h-14 w-full rounded-lg ${c.className}`} />
                <span className="font-label-sm text-ink">{c.name}</span>
                <span className="tabular text-body-xs text-ink-muted">{c.hex}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <footer className="border-t border-border pt-6 text-body-xs text-ink-muted">
          Lyko System · Charte « Cabinet M Conseils » · page de diagnostic interne
        </footer>
      </div>
    </main>
  );
}
