"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { downloadImportTemplate, sendImport, type ImportError, type ImportResult, type ImportSummary } from "@/lib/api/import";
import { RequireAuth } from "@/components/auth/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Import en masse depuis Excel (demande utilisateur, 2026-11-13) : un cabinet qui arrive avec tout
 * un portefeuille le charge en une fois au lieu de tout ressaisir. Trois temps, toujours visibles :
 * télécharger le modèle, envoyer le fichier pour un aperçu (rien n'est créé), confirmer.
 * Réservé au DG, comme la route serveur.
 */
export function ImportView() {
  return (
    <RequireAuth roles={["dg"]}>
      <ImportContent />
    </RequireAuth>
  );
}

const SHEETS = ["Propriétaires", "Logements", "Locataires"];

function ImportContent() {
  const { accessToken } = useAuth();
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState<"template" | "preview" | "confirm" | null>(null);
  const [preview, setPreview] = React.useState<ImportResult | null>(null);
  const [done, setDone] = React.useState<ImportSummary | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function pick(next: File | null) {
    setFile(next);
    setPreview(null);
    setFailure(null);
  }

  async function run(mode: "preview" | "confirm") {
    if (!accessToken || !file) return;
    setBusy(mode);
    setFailure(null);
    try {
      const result = await sendImport(accessToken, file, mode);
      if (mode === "confirm" && result.ok) {
        setDone(result.summary);
        setPreview(null);
        setFile(null);
      } else {
        // Une confirmation refusée (le fichier ou l'espace a changé depuis l'aperçu) réaffiche
        // simplement les erreurs : rien n'a été créé.
        setPreview(result);
      }
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Envoi impossible. Vérifiez votre connexion et réessayez.");
    } finally {
      setBusy(null);
    }
  }

  async function template() {
    if (!accessToken) return;
    setBusy("template");
    setFailure(null);
    try {
      await downloadImportTemplate(accessToken);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Téléchargement impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex max-w-3xl flex-col gap-6 py-10">
        <div className="flex flex-col gap-2">
          <Link href="/espace/locataires" className="flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
            <ArrowLeft size={16} /> Locataires
          </Link>
          <h1 className="font-display text-headline-xl text-ink">Importer depuis Excel</h1>
          <p className="text-body-md text-ink-soft">
            Chargez en une fois vos propriétaires, vos logements et vos locataires déjà en place.
          </p>
        </div>

        {failure && (
          <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-body-sm text-danger-fg">
            {failure}
          </p>
        )}

        {done ? (
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={24} className="mt-0.5 shrink-0 text-success-fg" />
                <div>
                  <p className="font-label-md text-ink">Import terminé</p>
                  <p className="text-body-sm text-ink-muted">Tout le contenu du fichier a été créé dans votre espace.</p>
                </div>
              </div>
              <SummaryGrid summary={done} tense="past" />
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/espace/locataires"><Button className="w-full sm:w-auto">Voir les locataires</Button></Link>
                <Link href="/espace/biens"><Button variant="secondary" className="w-full sm:w-auto">Voir les biens</Button></Link>
                <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setDone(null)}>Importer un autre fichier</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle>1. Téléchargez le modèle</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-body-sm text-ink-muted">
                  Un fichier Excel avec trois feuilles à remplir ({SHEETS.join(", ")}) et un mode d&apos;emploi.
                  Une ligne par propriétaire, par logement et par locataire.
                </p>
                <Button variant="secondary" className="w-full sm:w-fit" onClick={template} disabled={busy !== null}>
                  <Download size={18} />
                  {busy === "template" ? "Téléchargement…" : "Télécharger le modèle Excel"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>2. Envoyez votre fichier rempli</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-body-sm text-ink-muted">
                  Le fichier est d&apos;abord vérifié : vous voyez ce qui sera créé et chaque erreur à corriger.
                  Rien n&apos;est enregistré avant votre confirmation.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  aria-label="Fichier Excel à importer"
                  onChange={(e) => {
                    pick(e.target.files?.[0] ?? null);
                    e.target.value = ""; // permet de renvoyer le même fichier après correction
                  }}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-muted px-4 py-4 text-left hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <FileSpreadsheet size={22} className="shrink-0 text-ink-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-label-md text-ink">{file ? file.name : "Choisir un fichier Excel (.xlsx)"}</span>
                    <span className="block text-body-xs text-ink-muted">
                      {file ? `${Math.max(1, Math.round(file.size / 1024))} Ko · toucher pour changer` : "5 Mo maximum"}
                    </span>
                  </span>
                </button>
                <Button className="w-full sm:w-fit" onClick={() => run("preview")} disabled={!file || busy !== null}>
                  <Upload size={18} />
                  {busy === "preview" ? "Vérification…" : "Vérifier le fichier"}
                </Button>
              </CardContent>
            </Card>

            {preview && !preview.ok && <ErrorsCard result={preview} />}

            {preview?.ok && (
              <Card>
                <CardHeader><CardTitle>3. Confirmez l&apos;import</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-success-fg" />
                    <p className="text-body-sm text-ink">Le fichier est correct. Voici ce qui sera créé :</p>
                  </div>
                  <SummaryGrid summary={preview.summary} tense="future" />
                  <p className="text-body-xs text-ink-muted">
                    Les locataires sont enregistrés comme déjà en place : ni frais d&apos;agence ni prorata d&apos;entrée.
                  </p>
                  <Button className="w-full sm:w-fit" onClick={() => run("confirm")} disabled={busy !== null}>
                    {busy === "confirm" ? "Import en cours…" : "Importer maintenant"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryGrid({ summary, tense }: { summary: ImportSummary; tense: "past" | "future" }) {
  const tiles: { value: number; label: string; hint?: string }[] = [
    {
      value: summary.ownersCreated,
      label: summary.ownersCreated > 1 ? "propriétaires" : "propriétaire",
      hint: summary.ownersReused ? `+ ${summary.ownersReused} déjà dans votre espace` : undefined,
    },
    { value: summary.properties, label: summary.properties > 1 ? "biens" : "bien" },
    {
      value: summary.units,
      label: summary.units > 1 ? "logements" : "logement",
      hint: summary.vacantUnits ? `dont ${summary.vacantUnits} ${summary.vacantUnits > 1 ? "libres" : "libre"}` : undefined,
    },
    { value: summary.renters, label: summary.renters > 1 ? "locataires" : "locataire" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={tense === "past" ? "Éléments créés" : "Éléments à créer"}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-border bg-surface-muted px-3 py-3">
          <dd className="font-display text-headline-md text-ink">{t.value}</dd>
          <dt className="text-body-sm text-ink">{t.label}</dt>
          {t.hint && <p className="mt-0.5 text-body-xs text-ink-muted">{t.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

function ErrorsCard({ result }: { result: ImportResult }) {
  const groups = new Map<string, ImportError[]>();
  for (const e of result.errors) {
    const key = e.sheet ?? "Fichier";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const total = result.errorCount;
  return (
    <Card>
      <CardHeader><CardTitle>Fichier à corriger</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3">
          <TriangleAlert size={20} className="mt-0.5 shrink-0 text-warning-fg" />
          <p className="text-body-sm text-ink">
            <span className="font-label-md">{total} {total > 1 ? "erreurs" : "erreur"} à corriger.</span>{" "}
            Rien n&apos;a été importé. Corrigez le fichier Excel puis renvoyez-le.
          </p>
        </div>
        {[...groups.entries()].map(([sheet, errors]) => (
          <section key={sheet} className="flex flex-col gap-2">
            <h3 className="font-label-md text-ink">
              {sheet === "Fichier" ? "Fichier" : `Feuille « ${sheet} »`}
              <span className="ml-2 text-body-xs font-normal text-ink-muted">{errors.length}</span>
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {errors.map((e, i) => (
                <li key={i} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:gap-3">
                  <span className="shrink-0 text-body-xs font-medium text-ink-muted sm:w-44">
                    {e.row ? `Ligne ${e.row}` : "Général"}
                    {e.column ? ` · ${e.column}` : ""}
                  </span>
                  <span className="min-w-0 break-words text-body-sm text-ink">{e.message}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {total > result.errors.length && (
          <p className="text-body-xs text-ink-muted">
            Seules les {result.errors.length} premières erreurs sont affichées. Corrigez-les puis renvoyez le fichier pour voir les suivantes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
