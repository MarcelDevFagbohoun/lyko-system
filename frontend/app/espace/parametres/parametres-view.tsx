"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Stamp, PenTool, CreditCard, ExternalLink, Landmark, PlayCircle, PauseCircle, Loader2, Receipt, Plus, Pencil, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { getSettings, updateSettings, type TenantSettings } from "@/lib/api/settings";
import { RENT_TIMING_LABELS, type RentTiming } from "@/lib/api/renters";
import {
  getGlActivationStatus,
  activateGlModule,
  deactivateGlModule,
  type GlActivationStatus,
} from "@/lib/api/gl";
import {
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  type CatalogItem,
} from "@/lib/api/inspectionCatalog";
import { formatFcfa, cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardToneProvider } from "@/components/ui/card";
import { CADRES, type Cadre } from "@/lib/module-theme";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableAmount } from "@/components/ui/table";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { useToast } from "@/lib/toast/toast-context";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
  type AssistantSettings,
} from "@/lib/api/assistant";

export function ParametresView() {
  return (
    <RequireAuth roles={["dg"]}>
      <ParametresContent />
    </RequireAuth>
  );
}

/**
 * En-tête de groupe — même langage visuel que les rubriques de la barre latérale (`espace-sidebar.tsx`) :
 * libellé neutre (la couleur vient de la pastille, jamais du texte), infobulle sur le sens de la couleur.
 * Regroupe les réglages de cette page par rubrique de l'application plutôt que de les empiler sans
 * distinction — une caution/un loyer se range sous « Patrimoine », une écriture comptable sous
 * « Finances », etc., exactement comme dans le menu.
 */
function SectionLabel({ cadre }: { cadre: Cadre }) {
  const theme = CADRES[cadre];
  return (
    <div className="mt-2 flex items-center gap-2 px-1 first:mt-0">
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", theme.solid)} />
      <p title={theme.meaning} className="font-label-sm uppercase tracking-wider text-ink-faint">
        {theme.label}
      </p>
    </div>
  );
}

function ParametresContent() {
  const { accessToken, refreshUser } = useAuth();
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [stampFile, setStampFile] = React.useState<File | null>(null);
  const [stampPreview, setStampPreview] = React.useState<string | null>(null);
  const [signatureFile, setSignatureFile] = React.useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = React.useState<string | null>(null);
  const [dgTitle, setDgTitle] = React.useState("");
  const [comptableTitle, setComptableTitle] = React.useState("");
  const [agentTitle, setAgentTitle] = React.useState("");
  const [kkiapayEnabled, setKkiapayEnabled] = React.useState(false);
  const [kkiapaySandbox, setKkiapaySandbox] = React.useState(true);
  const [kkiapayPublicKey, setKkiapayPublicKey] = React.useState("");
  const [kkiapayPrivateKey, setKkiapayPrivateKey] = React.useState("");
  const [kkiapaySecretKey, setKkiapaySecretKey] = React.useState("");
  const [defaultRentTiming, setDefaultRentTiming] = React.useState<RentTiming>("avance");
  const [defaultEntryProration, setDefaultEntryProration] = React.useState<"aucun" | "prorata">("aucun");
  const [depositSbeeEnabled, setDepositSbeeEnabled] = React.useState(false);
  const [depositSonebEnabled, setDepositSonebEnabled] = React.useState(false);
  const [depositPeintureEnabled, setDepositPeintureEnabled] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getSettings(accessToken)
      .then((res) => {
        setSettings(res.settings);
        setDgTitle(res.settings.roleTitles.dg);
        setComptableTitle(res.settings.roleTitles.comptable);
        setAgentTitle(res.settings.roleTitles.agent);
        setKkiapayEnabled(res.settings.kkiapayEnabled);
        setKkiapaySandbox(res.settings.kkiapaySandbox);
        setKkiapayPublicKey(res.settings.kkiapayPublicKey ?? "");
        setDefaultRentTiming(res.settings.defaultRentTiming);
        setDefaultEntryProration(res.settings.defaultEntryProration);
        setDepositSbeeEnabled(res.settings.depositSbeeEnabled);
        setDepositSonebEnabled(res.settings.depositSonebEnabled);
        setDepositPeintureEnabled(res.settings.depositPeintureEnabled);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Impossible de charger les paramètres."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  function handleStampChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setStampFile(file);
    setStampPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }
  function handleSignatureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSignatureFile(file);
    setSignaturePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateSettings(accessToken, {
        stamp: stampFile ?? undefined,
        signature: signatureFile ?? undefined,
        dgTitle,
        comptableTitle,
        agentTitle,
        kkiapayEnabled,
        kkiapaySandbox,
        kkiapayPublicKey,
        kkiapayPrivateKey,
        kkiapaySecretKey,
        defaultRentTiming,
        defaultEntryProration,
        depositSbeeEnabled,
        depositSonebEnabled,
        depositPeintureEnabled,
      });
      setSettings(res.settings);
      setStampFile(null);
      setSignatureFile(null);
      setKkiapayPrivateKey("");
      setKkiapaySecretKey("");
      setSaved(true);
      // Le badge (barre latérale), le journal, les documents... lisent le
      // libellé via le contexte d'auth (`tenant.roleTitles`), pas cet écran :
      // sans ça, le nouveau nom ne s'afficherait qu'après un rechargement.
      // Best-effort : un échec ici ne doit pas faire croire à un échec de
      // l'enregistrement, qui a déjà réussi côté serveur à ce stade.
      refreshUser().catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer les paramètres.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10">
          <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="content-shell py-10 text-body-sm text-ink-muted">Chargement…</div>
      </div>
    );
  }

  const currentStamp = stampPreview ?? (settings.stampUrl ? `${API_URL}${settings.stampUrl}` : null);
  const currentSignature =
    signaturePreview ?? (settings.signatureUrl ? `${API_URL}${settings.signatureUrl}` : null);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link href="/espace" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={16} />
          Retour à mon espace
        </Link>

        <div>
          <h1 className="font-display text-headline-xl text-ink">Paramètres</h1>
          <p className="text-body-md text-ink-soft">
            Personnalisez les documents générés pour vos locataires (contrat de bail, quittances).
          </p>
        </div>

        {/* Action immédiate (active/suspend tout de suite, avec reprise de
            l'historique) — volontairement HORS du formulaire ci-dessous, qui
            ne fait qu'enregistrer des champs au clic sur "Enregistrer". */}
        <SectionLabel cadre="finances" />
        <CardToneProvider tone={CADRES.finances.tone}>
          <div className="flex flex-col gap-6">
            <AdvancedAccountingSection accessToken={accessToken} />
            <InspectionCatalogSection accessToken={accessToken} />
          </div>
        </CardToneProvider>

        <SectionLabel cadre="administration" />
        <CardToneProvider tone={CADRES.administration.tone}>
          <AssistantSection accessToken={accessToken} />
        </CardToneProvider>

        <form onSubmit={handleSave} className="flex flex-col gap-6">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-success-border bg-success-bg px-3 py-2 text-body-sm text-success-fg">
              Paramètres enregistrés.
            </div>
          )}

          <SectionLabel cadre="administration" />
          <CardToneProvider tone={CADRES.administration.tone}>
          <Card>
            <CardHeader>
              <CardTitle>Noms des postes</CardTitle>
              <CardDescription>
                Choisissez comment s&apos;appellent vos postes chez vous — ce nom s&apos;affiche
                partout (badge, journal, documents), y compris au moment de la connexion d&apos;un
                employé. Les permissions ne changent pas.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Mon titre (DG)" htmlFor="dgTitle">
                <select
                  id="dgTitle"
                  value={dgTitle}
                  onChange={(e) => setDgTitle(e.target.value)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {settings.roleTitlePresets.dg.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Titre du comptable" htmlFor="comptableTitle">
                <select
                  id="comptableTitle"
                  value={comptableTitle}
                  onChange={(e) => setComptableTitle(e.target.value)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {settings.roleTitlePresets.comptable.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Titre de l'agent" htmlFor="agentTitle">
                <select
                  id="agentTitle"
                  value={agentTitle}
                  onChange={(e) => setAgentTitle(e.target.value)}
                  className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {settings.roleTitlePresets.agent.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cachet de l&apos;entreprise</CardTitle>
                <CardDescription>Apposé automatiquement sur le contrat de bail et la quittance générés.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
                  {currentStamp && accessToken ? (
                    <AuthenticatedImage
                      src={currentStamp}
                      accessToken={accessToken}
                      alt="Cachet"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <Stamp size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentStamp ? "Remplacer le cachet" : "Téléverser un cachet"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleStampChange} className="hidden" />
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signature</CardTitle>
                <CardDescription>Apposée automatiquement près de « Pour l&apos;entreprise, ».</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
                  {currentSignature && accessToken ? (
                    <AuthenticatedImage
                      src={currentSignature}
                      accessToken={accessToken}
                      alt="Signature"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <PenTool size={28} className="text-ink-faint" />
                  )}
                </div>
                <label className="cursor-pointer font-label-sm text-primary hover:underline">
                  {currentSignature ? "Remplacer la signature" : "Téléverser une signature"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSignatureChange} className="hidden" />
                </label>
              </CardContent>
            </Card>
          </div>
          </CardToneProvider>

          <SectionLabel cadre="patrimoine" />
          <CardToneProvider tone={CADRES.patrimoine.tone}>
          <Card>
            <CardHeader>
              <CardTitle>Convention de paiement du loyer</CardTitle>
              <CardDescription>
                Réglage par défaut, appliqué à chaque nouveau bail — modifiable bail par bail à la
                création si un propriétaire géré a sa propre habitude.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Par défaut" htmlFor="defaultRentTiming">
                <select
                  id="defaultRentTiming"
                  value={defaultRentTiming}
                  onChange={(e) => setDefaultRentTiming(e.target.value as RentTiming)}
                  className="h-[38px] w-full max-w-md rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {Object.entries(RENT_TIMING_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prorata d&apos;entrée</CardTitle>
              <CardDescription>
                Un locataire qui entre en cours de mois — après l&apos;échéance habituelle — peut régler,
                à la signature, les jours réellement occupés (loyer ÷ 30 × jours). Appartient au
                propriétaire (compte séquestre), pas à l&apos;entreprise. Réglage par défaut, modifiable bail par
                bail à la création.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Par défaut" htmlFor="defaultEntryProration">
                <select
                  id="defaultEntryProration"
                  value={defaultEntryProration}
                  onChange={(e) => setDefaultEntryProration(e.target.value as "aucun" | "prorata")}
                  className="h-[38px] w-full max-w-md rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="aucun">Ne rien facturer (comportement actuel)</option>
                  <option value="prorata">Facturer le prorata d&apos;entrée</option>
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cautions supplémentaires</CardTitle>
              <CardDescription>
                En plus de la caution de loyer, activez ici les cautions optionnelles que vous
                demandez à vos locataires. SBEE/SONEB garantissent les impayés de charges (réglés
                réellement à la sortie), peinture couvre les frais de remise en état. Montant
                toujours saisi à la main, restituable, chacune affichée séparément.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={depositSbeeEnabled}
                  onChange={(e) => setDepositSbeeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Caution SBEE (électricité)</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={depositSonebEnabled}
                  onChange={(e) => setDepositSonebEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Caution SONEB (eau)</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={depositPeintureEnabled}
                  onChange={(e) => setDepositPeintureEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Caution peinture</span>
              </label>
            </CardContent>
          </Card>
          </CardToneProvider>

          <SectionLabel cadre="finances" />
          <CardToneProvider tone={CADRES.finances.tone}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard size={18} className={CADRES.finances.text} />
                <CardTitle>Paiement en ligne (KKiaPay)</CardTitle>
              </div>
              <CardDescription>
                Optionnel : laissez vos locataires régler leur loyer et leurs charges SONEB/SBEE en
                ligne (Mobile Money, carte). Désactivé, tout continue de fonctionner comme aujourd&apos;hui
                — vous enregistrez les paiements vous-même.{" "}
                <a
                  href="https://kkiapay.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Créer un compte KKiaPay <ExternalLink size={12} />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={kkiapayEnabled}
                  onChange={(e) => setKkiapayEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Activer le paiement en ligne</span>
              </label>

              {kkiapayEnabled && (
                <>
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={kkiapaySandbox}
                      onChange={(e) => setKkiapaySandbox(e.target.checked)}
                      className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <span className="text-body-sm text-ink-soft">
                      Mode test (sandbox) — aucun vrai paiement tant que c&apos;est coché
                    </span>
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Clé publique" htmlFor="kkiapayPublicKey">
                      <input
                        id="kkiapayPublicKey"
                        value={kkiapayPublicKey}
                        onChange={(e) => setKkiapayPublicKey(e.target.value)}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field
                      label="Clé privée"
                      htmlFor="kkiapayPrivateKey"
                      hint={settings.kkiapayConfigured ? "Déjà enregistrée — laissez vide pour la conserver" : undefined}
                    >
                      <input
                        id="kkiapayPrivateKey"
                        type="password"
                        autoComplete="new-password"
                        value={kkiapayPrivateKey}
                        onChange={(e) => setKkiapayPrivateKey(e.target.value)}
                        placeholder={settings.kkiapayConfigured ? "••••••••" : undefined}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field
                      label="Clé secrète"
                      htmlFor="kkiapaySecretKey"
                      hint={settings.kkiapayConfigured ? "Déjà enregistrée — laissez vide pour la conserver" : undefined}
                    >
                      <input
                        id="kkiapaySecretKey"
                        type="password"
                        autoComplete="new-password"
                        value={kkiapaySecretKey}
                        onChange={(e) => setKkiapaySecretKey(e.target.value)}
                        placeholder={settings.kkiapayConfigured ? "••••••••" : undefined}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          </CardToneProvider>

          <Card>
            <CardFooter className="justify-end">
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer les paramètres"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}

// ── Comptabilité avancée (SYSCOHADA) — mode de comptabilité de l'entreprise ─
// Décision explicite de l'utilisateur : « c'est [le DG] qui doit autoriser
// son comptable d'utiliser une comptabilité simple, ou une comptabilité
// avancée » — ce contrôle vit ici, dans Paramètres (pas dans l'espace
// Comptabilité avancée lui-même, qui n'affiche plus qu'un statut en lecture
// seule + un lien vers cette page). Une fois activée ici, le DG autorise
// ENSUITE tel ou tel comptable à l'utiliser depuis sa fiche employé
// (case « Comptabilité avancée (SYSCOHADA) » déjà existante, Employés).
function AdvancedAccountingSection({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = React.useState<GlActivationStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getGlActivationStatus(accessToken)
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le statut de la comptabilité avancée."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  if (error) return <p className="text-body-sm text-danger-fg">{error}</p>;

  if (!status) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-body-sm text-ink-muted">Chargement du statut de la comptabilité avancée…</p>
        </CardContent>
      </Card>
    );
  }

  if (!status.initialized) {
    return <ActivationCard accessToken={accessToken} status={status} onChanged={load} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Landmark size={18} className={CADRES.finances.text} />
          <CardTitle>Comptabilité avancée (SYSCOHADA)</CardTitle>
        </div>
        <CardDescription>
          Optionnelle et distincte de la comptabilité simple (toujours active, dans le menu Comptabilité). Une fois
          activée, autorisez vos comptables à l&apos;utiliser depuis leur fiche employé.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge variant={status.enabled ? "success" : "warning"} className="mb-1.5">
            {status.enabled ? "Activée" : "Suspendue"}
          </Badge>
          <p className="text-body-sm text-ink-soft">
            {status.enabled
              ? "Les nouvelles opérations génèrent automatiquement leur écriture comptable."
              : "Les nouvelles opérations ne génèrent plus d'écriture — l'historique déjà généré reste consultable."}
          </p>
          <Link href="/espace/comptabilite-avancee" className="mt-1 inline-block text-body-sm text-primary hover:underline">
            Ouvrir la comptabilité avancée →
          </Link>
        </div>
        {status.enabled ? (
          <SuspendButton accessToken={accessToken} onChanged={load} />
        ) : (
          <ReactivateButton accessToken={accessToken} onChanged={load} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Référentiel de prix pour la facturation des dégradations à l'état des
 * lieux de sortie (demande directe de l'utilisateur) — un catalogue commun
 * à toute l'entreprise, réutilisé à chaque sortie de locataire. Prix tout
 * compris (matériel + main d'œuvre), décision explicite. Gestion réservée
 * au DG (comme le taux de commission) ; la lecture (pour choisir un prix
 * pendant une sortie) reste ouverte à qui a la permission "États des lieux".
 */
function InspectionCatalogSection({ accessToken }: { accessToken: string | null }) {
  const [items, setItems] = React.useState<CatalogItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    listCatalogItems(accessToken)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le catalogue."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function handleDelete(id: number) {
    if (!accessToken) return;
    try {
      await deleteCatalogItem(accessToken, id);
      toast.success("Élément supprimé du catalogue.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Receipt size={18} className={CADRES.finances.text} />
          <CardTitle>Catalogue de facturation (états des lieux)</CardTitle>
        </div>
        <CardDescription>
          Prix des éléments de la maison (porte, fenêtre, robinetterie…), tout compris (matériel et pose) —
          proposés automatiquement à l&apos;agent quand un élément se dégrade entre l&apos;entrée et la sortie
          d&apos;un locataire.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {adding && (
          <CatalogItemForm
            accessToken={accessToken}
            onDone={() => {
              setAdding(false);
              load();
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {items === null ? (
          <p className="text-body-sm text-ink-muted">Chargement…</p>
        ) : items.length === 0 && !adding ? (
          <p className="text-body-sm text-ink-muted">Aucun élément dans le catalogue pour l&apos;instant.</p>
        ) : (
          items.length > 0 && (
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Élément</TableHead>
                  <TableHead className="text-right">Prix (FCFA)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {items.map((it) =>
                  editingId === it.id ? (
                    <tr key={it.id}>
                      <td colSpan={3} className="p-2">
                        <CatalogItemForm
                          accessToken={accessToken}
                          initial={it}
                          onDone={() => {
                            setEditingId(null);
                            load();
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <TableRow key={it.id}>
                      <TableCell>{it.label}</TableCell>
                      <TableAmount>{formatFcfa(it.price)}</TableAmount>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(it.id)} className="text-ink-muted hover:text-ink">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => handleDelete(it.id)} className="text-ink-muted hover:text-danger-fg">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )
        )}

        {!adding && (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Ajouter un élément
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CatalogItemForm({
  accessToken,
  initial,
  onDone,
  onCancel,
}: {
  accessToken: string | null;
  initial?: CatalogItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [price, setPrice] = React.useState(initial ? String(initial.price) : "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    const priceNumber = Number(price);
    if (!label.trim() || !Number.isFinite(priceNumber) || priceNumber <= 0) {
      setError("Libellé et prix (supérieur à 0) requis.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (initial) {
        await updateCatalogItem(accessToken, initial.id, { label: label.trim(), price: priceNumber });
        toast.success("Élément modifié.");
      } else {
        await createCatalogItem(accessToken, { label: label.trim(), price: priceNumber });
        toast.success("Élément ajouté au catalogue.");
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cet élément.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong bg-surface-muted p-3 sm:flex-row sm:items-end">
      {error && <p className="text-body-sm text-danger-fg sm:basis-full">{error}</p>}
      <div className="flex-1">
        <label className="mb-1 block text-body-xs text-ink-muted">Libellé</label>
        <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Porte intérieure" />
      </div>
      <div className="w-full sm:w-40">
        <label className="mb-1 block text-body-xs text-ink-muted">Prix (FCFA, tout compris)</label>
        <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Enregistrement…" : initial ? "Enregistrer" : "Ajouter"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>
    </form>
  );
}

function ActivationCard({
  accessToken,
  status,
  onChanged,
}: {
  accessToken: string | null;
  status: GlActivationStatus | null;
  onChanged: () => void;
}) {
  const [activating, setActivating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof activateGlModule>> | null>(null);
  const toast = useToast();

  async function handleActivate() {
    if (!accessToken) return;
    const fromDate = status?.accountingStartDate ?? status?.earliestOperation;
    const ok = window.confirm(
      fromDate
        ? `Activer la comptabilité avancée ? Toutes les opérations déjà enregistrées depuis le ${fromDate} seront reprises automatiquement en partie double. Cette étape peut prendre quelques instants.`
        : "Activer la comptabilité avancée ? Aucune opération existante à reprendre — le suivi démarre à partir d'aujourd'hui.",
    );
    if (!ok) return;

    setActivating(true);
    setError(null);
    try {
      const res = await activateGlModule(accessToken);
      setResult(res);
      toast.success(`Comptabilité avancée activée — ${res.entriesGenerated} écriture(s) générée(s).`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'activer la comptabilité avancée.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Landmark size={18} className={CADRES.finances.text} />
          <CardTitle>Comptabilité avancée (SYSCOHADA)</CardTitle>
        </div>
        <CardDescription>
          Optionnelle et distincte de la comptabilité simple (qui continue de fonctionner exactement comme avant,
          activée ou non). Génère automatiquement, en partie double, l&apos;écriture correspondant à chaque loyer,
          dépense, charge SONEB/SBEE et versement déjà enregistré — puis chaque nouvelle opération à venir. Une fois
          activée, autorisez vos comptables à l&apos;utiliser depuis leur fiche employé.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status?.earliestOperation && (
          <p className="text-body-sm text-ink-soft">
            Opération la plus ancienne trouvée : <span className="tabular font-semibold">{status.earliestOperation}</span>
            {status.accountingStartDate && (
              <>
                {" "}— reprise prévue à partir du <span className="tabular font-semibold">{status.accountingStartDate}</span> (date de
                démarrage comptable définie ci-dessous).
              </>
            )}
          </p>
        )}
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}
        <Button onClick={handleActivate} disabled={activating} className="self-start">
          {activating ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
          {activating ? "Activation en cours…" : "Activer maintenant"}
        </Button>
        {result && (
          <div className="rounded-lg border border-success-border bg-success-bg p-3 text-body-sm text-success-fg">
            {result.fiscalYearsCreated.length} exercice(s) ouvert(s) · {result.entriesGenerated} écriture(s) générée(s)
            {result.entriesSkipped > 0 && ` · ${result.entriesSkipped} déjà à jour`}
            {result.errors.length > 0 && (
              <div className="mt-1 text-danger-fg">
                <p>
                  {result.errors.length} opération(s) n&apos;ont pas pu être reprises — souvent parce que l&apos;exercice
                  comptable correspondant est déjà clôturé. Rouvrir cet exercice (ou en créer un couvrant la bonne
                  période) puis resynchroniser permet en général de les rattraper.
                </p>
                <ul className="mt-1 list-disc pl-5 text-body-xs">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReactivateButton({ accessToken, onChanged }: { accessToken: string | null; onChanged: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const toast = useToast();

  async function handleReactivate() {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await activateGlModule(accessToken);
      toast.success(
        res.entriesGenerated > 0
          ? `Comptabilité avancée réactivée — ${res.entriesGenerated} écriture(s) de rattrapage générée(s).`
          : "Comptabilité avancée réactivée.",
      );
      // Audit comptable, anomalie B4 : un rattrapage partiellement échoué (le
      // plus souvent parce que l'exercice concerné est déjà clôturé) ne doit
      // jamais passer inaperçu derrière le seul toast de succès ci-dessus.
      if (res.errors.length > 0) {
        toast.warning(
          `${res.errors.length} opération(s) n'ont pas pu être reprises, souvent parce que l'exercice comptable correspondant est déjà clôturé. Rouvrez-le (ou créez l'exercice manquant) puis réactivez à nouveau.`,
        );
      }
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de réactiver la comptabilité avancée.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="warning" size="sm" disabled={loading} onClick={handleReactivate}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
      Réactiver
    </Button>
  );
}

function SuspendButton({ accessToken, onChanged }: { accessToken: string | null; onChanged: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const toast = useToast();

  async function handleSuspend() {
    if (!accessToken) return;
    const ok = window.confirm(
      "Suspendre la comptabilité avancée ? Les nouvelles opérations ne généreront plus d'écriture jusqu'à réactivation. Rien n'est supprimé — l'historique déjà généré reste consultable.",
    );
    if (!ok) return;
    setLoading(true);
    try {
      await deactivateGlModule(accessToken);
      toast.info("Comptabilité avancée suspendue.");
      onChanged();
    } catch (err) {
      toast.info(err instanceof ApiError ? err.message : "Impossible de suspendre la comptabilité avancée.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={loading} onClick={handleSuspend}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />}
      Suspendre
    </Button>
  );
}

// ── Assistant IA (chat Claude) ─────────────────────────────────────────────
// Désactivé par défaut pour chaque entreprise : ce que l'on écrit à l'assistant est envoyé à un
// fournisseur externe (Anthropic). L'activation exige donc une confirmation explicite, datée et
// attribuée à la direction. L'accès par employé se règle ensuite dans sa fiche (case « Assistant IA »).
function AssistantSection({ accessToken }: { accessToken: string | null }) {
  const [settings, setSettings] = React.useState<AssistantSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  const load = React.useCallback(() => {
    if (!accessToken) return;
    fetchAssistantSettings(accessToken)
      .then((s) => setSettings(s))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les réglages de l'assistant."));
  }, [accessToken]);

  React.useEffect(() => load(), [load]);

  async function apply(input: { enabled: boolean; acknowledge?: boolean }, successMessage: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await saveAssistantSettings(accessToken, input);
      toast.success(successMessage);
      setAcknowledged(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-body-sm text-danger-fg">{error}</p>;
  if (!settings) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-body-sm text-ink-muted">Chargement des réglages de l&apos;assistant…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className={CADRES.administration.text} />
          <CardTitle>Assistant IA</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!settings.enabled ? (
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-body-sm text-ink">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1 h-4 w-4" />
              <span>J&apos;autorise l&apos;envoi des messages de mes employés à Anthropic pour faire fonctionner cet assistant.</span>
            </label>
            <div>
              <Button disabled={!acknowledged || busy} onClick={() => apply({ enabled: true, acknowledge: true }, "Assistant activé.")}>
                {busy ? "Activation…" : "Activer l'assistant"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-soft">
              {settings.usage.used} / {settings.usage.quota} messages utilisés ce mois-ci.
            </p>
            <div>
              <Button variant="danger" disabled={busy} onClick={() => apply({ enabled: false }, "Assistant désactivé.")}>
                Désactiver
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
