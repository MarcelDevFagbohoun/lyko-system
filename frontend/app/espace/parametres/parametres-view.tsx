"use client";



import { ASSISTANT_ENABLED } from "@/lib/features";
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Stamp,
  PenTool,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError, API_URL } from "@/lib/api/client";
import { getSettings, updateSettings, type TenantSettings } from "@/lib/api/settings";
import { RENT_TIMING_LABELS, type RentTiming } from "@/lib/api/renters";
import { cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardToneProvider,
} from "@/components/ui/card";
import { ActivitiesCard } from "@/components/espace/activities-card";
import { StartDateCard } from "@/components/accounting/start-date-card";
import { CADRES, type Cadre } from "@/lib/module-theme";
import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { AdvancedAccountingSection } from "./sections/advanced-accounting";
import { AssistantSection } from "./sections/assistant-section";
import { InspectionCatalogSection } from "./sections/inspection-catalog";

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
  const { accessToken, refreshUser, tenant } = useAuth();
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [stampFile, setStampFile] = React.useState<File | null>(null);
  const [stampPreview, setStampPreview] = React.useState<string | null>(null);
  const [signatureFile, setSignatureFile] = React.useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = React.useState<string | null>(null);
  const [activities, setActivities] = React.useState<string[]>([]);
  const [dgTitle, setDgTitle] = React.useState("");
  const [comptableTitle, setComptableTitle] = React.useState("");
  const [agentTitle, setAgentTitle] = React.useState("");
  const [fedapayCollectEnabled, setFedapayCollectEnabled] = React.useState(false);
  const [fedapayWebhookSecret, setFedapayWebhookSecret] = React.useState("");
  const [fedapayEnabled, setFedapayEnabled] = React.useState(false);
  const [fedapaySandbox, setFedapaySandbox] = React.useState(true);
  const [fedapaySecretKey, setFedapaySecretKey] = React.useState("");
  const [paymentsPerOrderLimit, setPaymentsPerOrderLimit] = React.useState("500000");
  const [paymentsDailyLimit, setPaymentsDailyLimit] = React.useState("2000000");
  const [defaultRentTiming, setDefaultRentTiming] = React.useState<RentTiming>("avance");
  const [defaultEntryProration, setDefaultEntryProration] = React.useState<"aucun" | "prorata">("aucun");
  const [chargesEnabled, setChargesEnabled] = React.useState(true);
  const [depositSbeeEnabled, setDepositSbeeEnabled] = React.useState(false);
  const [depositSonebEnabled, setDepositSonebEnabled] = React.useState(false);
  const [depositPeintureEnabled, setDepositPeintureEnabled] = React.useState(false);
  const [utilityPassThroughPercent, setUtilityPassThroughPercent] = React.useState("100");
  const [commissionTiming, setCommissionTiming] = React.useState<"encaissement" | "reversement">("encaissement");
  const [expenseAlertThreshold, setExpenseAlertThreshold] = React.useState("");

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!accessToken) return;
    getSettings(accessToken)
      .then((res) => {
        setSettings(res.settings);
        setActivities(res.settings.activities ?? []);
        setDgTitle(res.settings.roleTitles.dg);
        setComptableTitle(res.settings.roleTitles.comptable);
        setAgentTitle(res.settings.roleTitles.agent);
        setFedapayEnabled(res.settings.fedapayEnabled);
        setFedapayCollectEnabled(res.settings.fedapayCollectEnabled);
        setFedapaySandbox(res.settings.fedapaySandbox);
        setPaymentsPerOrderLimit(String(res.settings.paymentsPerOrderLimit));
        setPaymentsDailyLimit(String(res.settings.paymentsDailyLimit));
        setDefaultRentTiming(res.settings.defaultRentTiming);
        setDefaultEntryProration(res.settings.defaultEntryProration);
        setChargesEnabled(res.settings.chargesEnabled !== false);
        setDepositSbeeEnabled(res.settings.depositSbeeEnabled);
        setDepositSonebEnabled(res.settings.depositSonebEnabled);
        setDepositPeintureEnabled(res.settings.depositPeintureEnabled);
        setUtilityPassThroughPercent(String(res.settings.utilityPassThroughPercent));
        setCommissionTiming(res.settings.commissionTiming);
        setExpenseAlertThreshold(res.settings.expenseAlertThreshold != null ? String(res.settings.expenseAlertThreshold) : "");
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
        activities,
        dgTitle,
        comptableTitle,
        agentTitle,
        fedapayEnabled,
        fedapayCollectEnabled,
        fedapayWebhookSecret,
        fedapaySandbox,
        fedapaySecretKey,
        paymentsPerOrderLimit: Number(paymentsPerOrderLimit) || undefined,
        paymentsDailyLimit: Number(paymentsDailyLimit) || undefined,
        defaultRentTiming,
        defaultEntryProration,
        chargesEnabled,
        depositSbeeEnabled,
        depositSonebEnabled,
        depositPeintureEnabled,
        utilityPassThroughPercent: Math.min(100, Math.max(0, Number(utilityPassThroughPercent) || 0)),
        commissionTiming,
        expenseAlertThreshold: expenseAlertThreshold ? Number(expenseAlertThreshold) : null,
      });
      setSettings(res.settings);
      setStampFile(null);
      setSignatureFile(null);
      setFedapaySecretKey("");
      setFedapayWebhookSecret("");
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
            <StartDateCard accessToken={accessToken} isDg />
            <AdvancedAccountingSection accessToken={accessToken} />
            <InspectionCatalogSection accessToken={accessToken} />
          </div>
        </CardToneProvider>

        <SectionLabel cadre="administration" />
        <CardToneProvider tone={CADRES.administration.tone}>
          {ASSISTANT_ENABLED && <AssistantSection accessToken={accessToken} />}
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
          <ActivitiesCard companyName={tenant?.companyName ?? "Votre entreprise"} value={activities} onChange={setActivities} />

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
              <CardTitle>Charges SONEB / SBEE</CardTitle>
              <CardDescription>
                Part de chaque charge encaissée qui revient au propriétaire ; le reste est gardé par l&apos;entreprise
                comme frais de gestion. 100 % = tout est reversé, rien n&apos;est gardé.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={chargesEnabled}
                  onChange={(e) => setChargesEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span>
                  <span className="font-label-md text-ink">Activer le suivi des charges SONEB / SBEE</span>
                  <span className="block text-body-xs text-ink-muted">
                    Décoché : le menu Charges, les relevés et les crédits de charges aux propriétaires disparaissent pour toute l&apos;équipe.
                    Rien n&apos;est supprimé, vous pouvez le réactiver quand vous voulez.
                  </span>
                </span>
              </label>
              <Field label="Part reversée au propriétaire (%)" htmlFor="utilityPassThroughPercent">
                <Input
                  id="utilityPassThroughPercent"
                  inputMode="numeric"
                  className="max-w-[8rem]"
                  value={utilityPassThroughPercent}
                  onChange={(e) => setUtilityPassThroughPercent(e.target.value.replace(/\D/g, "").slice(0, 3))}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commission de l&apos;entreprise</CardTitle>
              <CardDescription>
                Moment où votre commission est constatée : dès l&apos;encaissement du loyer, ou seulement quand
                l&apos;argent est reversé au propriétaire. Modifie le solde dû aux propriétaires.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Moment de la commission" htmlFor="commissionTiming">
                <select
                  id="commissionTiming"
                  value={commissionTiming}
                  onChange={(e) => setCommissionTiming(e.target.value as "encaissement" | "reversement")}
                  className="h-[38px] w-full max-w-md rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="encaissement">À l&apos;encaissement du loyer</option>
                  <option value="reversement">Au reversement au propriétaire</option>
                </select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alertes</CardTitle>
              <CardDescription>
                Le directeur général est prévenu quand une dépense dépasse ce montant. Laissez vide pour ne recevoir
                aucune alerte.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field label="Seuil d'alerte sur une dépense (FCFA)" htmlFor="expenseAlertThreshold">
                <Input
                  id="expenseAlertThreshold"
                  inputMode="numeric"
                  className="max-w-xs"
                  placeholder="Aucune alerte"
                  value={expenseAlertThreshold}
                  onChange={(e) => setExpenseAlertThreshold(e.target.value.replace(/\D/g, ""))}
                />
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
                <CardTitle>Paiements en ligne (FedaPay)</CardTitle>
              </div>
              <CardDescription>
                FedaPay sert à tout : vos locataires paient leur loyer et leurs charges en ligne (Mobile Money, carte), et vous
                payez les salaires, reversez les loyers aux propriétaires et effectuez d&apos;autres paiements. Chaque envoi
                d&apos;argent demande votre mot de passe, respecte les plafonds et est tracé. Désactivé, tout continue comme avant.{" "}
                <a
                  href="https://fedapay.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Créer un compte FedaPay <ExternalLink size={12} />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={fedapayCollectEnabled}
                  onChange={(e) => setFedapayCollectEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Encaisser les loyers et charges en ligne (locataires)</span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={fedapayEnabled}
                  onChange={(e) => setFedapayEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span className="font-label-md text-ink">Activer les paiements sortants</span>
              </label>

              {(fedapayEnabled || fedapayCollectEnabled) && (
                <>
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={fedapaySandbox}
                      onChange={(e) => setFedapaySandbox(e.target.checked)}
                      className="h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <span className="text-body-sm text-ink-soft">
                      Mode test (sandbox) — aucun vrai argent n&apos;est envoyé tant que c&apos;est coché
                    </span>
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field
                      label="Clé secrète FedaPay"
                      htmlFor="fedapaySecretKey"
                      hint={settings.fedapayConfigured ? "Déjà enregistrée — laissez vide pour la conserver" : "Chiffrée, jamais réaffichée"}
                    >
                      <input
                        id="fedapaySecretKey"
                        type="password"
                        autoComplete="new-password"
                        value={fedapaySecretKey}
                        onChange={(e) => setFedapaySecretKey(e.target.value)}
                        placeholder={settings.fedapayConfigured ? "••••••••" : undefined}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field
                      label="Secret du webhook (optionnel)"
                      htmlFor="fedapayWebhookSecret"
                      hint={settings.fedapayWebhookConfigured ? "Déjà enregistré — laissez vide pour le conserver" : "Confirmation automatique des paiements locataires"}
                    >
                      <input
                        id="fedapayWebhookSecret"
                        type="password"
                        autoComplete="new-password"
                        value={fedapayWebhookSecret}
                        onChange={(e) => setFedapayWebhookSecret(e.target.value)}
                        placeholder={settings.fedapayWebhookConfigured ? "••••••••" : undefined}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field label="Plafond par paiement (FCFA)" htmlFor="paymentsPerOrderLimit">
                      <input
                        id="paymentsPerOrderLimit"
                        inputMode="numeric"
                        value={paymentsPerOrderLimit}
                        onChange={(e) => setPaymentsPerOrderLimit(e.target.value.replace(/\D/g, ""))}
                        className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field label="Plafond par jour (FCFA)" htmlFor="paymentsDailyLimit">
                      <input
                        id="paymentsDailyLimit"
                        inputMode="numeric"
                        value={paymentsDailyLimit}
                        onChange={(e) => setPaymentsDailyLimit(e.target.value.replace(/\D/g, ""))}
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
