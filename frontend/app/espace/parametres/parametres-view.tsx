"use client";



import { ASSISTANT_ENABLED } from "@/lib/features";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Stamp } from "lucide-react";
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
  const [activities, setActivities] = React.useState<string[]>([]);
  const [dgTitle, setDgTitle] = React.useState("");
  const [comptableTitle, setComptableTitle] = React.useState("");
  const [agentTitle, setAgentTitle] = React.useState("");
  const [defaultRentTiming, setDefaultRentTiming] = React.useState<RentTiming>("avance");
  const [defaultEntryProration, setDefaultEntryProration] = React.useState<"aucun" | "prorata">("aucun");
  const [chargesEnabled, setChargesEnabled] = React.useState(true);
  const [depositSbeeEnabled, setDepositSbeeEnabled] = React.useState(false);
  const [depositSonebEnabled, setDepositSonebEnabled] = React.useState(false);
  const [depositPeintureEnabled, setDepositPeintureEnabled] = React.useState(false);
  const [utilityPassThroughPercent, setUtilityPassThroughPercent] = React.useState("100");
  const [commissionTiming, setCommissionTiming] = React.useState<"encaissement" | "reversement">("encaissement");
  const [expenseAlertThreshold, setExpenseAlertThreshold] = React.useState("");
  const [leaseContractTemplate, setLeaseContractTemplate] = React.useState("");
  // Distingue « le champ affiche le modèle par défaut parce que rien n'a encore été personnalisé » de
  // « l'entreprise a cliqué sur Réinitialiser » — sans ça, enregistrer la page sans avoir touché à ce
  // champ figerait par erreur le modèle par défaut du jour comme modèle personnalisé de l'entreprise,
  // l'empêchant de profiter d'une future amélioration du modèle par défaut.
  const [templateReset, setTemplateReset] = React.useState(false);
  const [contractBlankLetterhead, setContractBlankLetterhead] = React.useState(false);

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
        setDefaultRentTiming(res.settings.defaultRentTiming);
        setDefaultEntryProration(res.settings.defaultEntryProration);
        setChargesEnabled(res.settings.chargesEnabled !== false);
        setDepositSbeeEnabled(res.settings.depositSbeeEnabled);
        setDepositSonebEnabled(res.settings.depositSonebEnabled);
        setDepositPeintureEnabled(res.settings.depositPeintureEnabled);
        setUtilityPassThroughPercent(String(res.settings.utilityPassThroughPercent));
        setCommissionTiming(res.settings.commissionTiming);
        setExpenseAlertThreshold(res.settings.expenseAlertThreshold != null ? String(res.settings.expenseAlertThreshold) : "");
        // Pas encore personnalisé : on pré-remplit avec le modèle par défaut (plutôt qu'un champ vide)
        // pour que l'entreprise parte de ce qui est déjà en vigueur, à adapter plutôt qu'à réécrire.
        setLeaseContractTemplate(res.settings.leaseContractTemplate ?? res.settings.defaultLeaseContractTemplate);
        setTemplateReset(false);
        setContractBlankLetterhead(res.settings.contractBlankLetterhead);
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
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await updateSettings(accessToken, {
        stamp: stampFile ?? undefined,
        activities,
        dgTitle,
        comptableTitle,
        agentTitle,
        defaultRentTiming,
        defaultEntryProration,
        chargesEnabled,
        depositSbeeEnabled,
        depositSonebEnabled,
        depositPeintureEnabled,
        utilityPassThroughPercent: Math.min(100, Math.max(0, Number(utilityPassThroughPercent) || 0)),
        commissionTiming,
        expenseAlertThreshold: expenseAlertThreshold ? Number(expenseAlertThreshold) : null,
        leaseContractTemplate: templateReset
          ? null
          : settings.leaseContractTemplate != null || leaseContractTemplate.trim() !== settings.defaultLeaseContractTemplate.trim()
            ? leaseContractTemplate
            : undefined,
        contractBlankLetterhead,
      });
      setSettings(res.settings);
      setLeaseContractTemplate(res.settings.leaseContractTemplate ?? res.settings.defaultLeaseContractTemplate);
      setTemplateReset(false);
      setContractBlankLetterhead(res.settings.contractBlankLetterhead);
      setStampFile(null);
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

        {/* Réglages nécessaires au fonctionnement général du logiciel (pas spécifiques à la comptabilité
            avancée SYSCOHADA, retirée de cette page) — volontairement HORS du formulaire ci-dessous, qui
            ne fait qu'enregistrer des champs au clic sur "Enregistrer". */}
        <SectionLabel cadre="administration" />
        <CardToneProvider tone={CADRES.administration.tone}>
          <div className="flex flex-col gap-6">
            <StartDateCard accessToken={accessToken} isDg />
            <InspectionCatalogSection accessToken={accessToken} />
            {ASSISTANT_ENABLED && <AssistantSection accessToken={accessToken} />}
          </div>
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

          {/* Plus de « signature » séparée (demande utilisateur, 2026-11-02) : c'est OBLIGATOIREMENT
              ce cachet (celui du DG) qui est apposé sur le contrat de bail — sans lui, impossible de
              finaliser un contrat (voir services/leaseContractActions.js côté serveur). */}
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>Cachet de l&apos;entreprise</CardTitle>
              <CardDescription>
                Obligatoire pour signer un contrat de bail ; apposé aussi sur les quittances générées.
              </CardDescription>
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
              <CardTitle>Modèle du contrat de bail</CardTitle>
              <CardDescription>
                Le texte des articles du contrat de bail (parties, objet, loyer, caution…), personnalisable
                à volonté. Utilisez les balises <code>{"{{jeton}}"}</code> ci-dessous, elles seront
                remplacées par les données réelles de chaque bail. Un titre d&apos;article commence une
                ligne par <code>## </code>. Entourez un mot ou un groupe de mots de{" "}
                <code>**deux astérisques**</code> pour l&apos;afficher en <strong>gras</strong>, aussi bien
                à l&apos;écran que sur le PDF. Les conditions particulières restent saisies bail par bail,
                séparément. Les contrats déjà signés ne sont jamais affectés par un changement ici.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={contractBlankLetterhead}
                  onChange={(e) => setContractBlankLetterhead(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <span>
                  <span className="font-label-md text-ink">En-tête du PDF vierge (papier à en-tête)</span>
                  <span className="block text-body-xs text-ink-muted">
                    Coché : le haut de la page reste entièrement blanc (ni nom d&apos;entreprise, ni logo, ni
                    RCCM/IFU) pour que vous imprimiez le contrat sur votre propre papier à en-tête
                    déjà pré-imprimé, avec tous vos logos.
                  </span>
                </span>
              </label>
              <textarea
                value={leaseContractTemplate}
                onChange={(e) => {
                  setLeaseContractTemplate(e.target.value);
                  setTemplateReset(false);
                }}
                rows={16}
                className="w-full rounded border border-border-strong bg-surface px-3 py-2 font-mono text-body-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLeaseContractTemplate(settings.defaultLeaseContractTemplate);
                    setTemplateReset(true);
                  }}
                >
                  Réinitialiser au modèle par défaut
                </Button>
              </div>
              <details className="rounded-lg border border-border bg-surface-muted px-3 py-2">
                <summary className="cursor-pointer font-label-sm text-ink-soft">Balises disponibles</summary>
                <ul className="mt-2 flex flex-col gap-1 text-body-xs text-ink-muted">
                  {settings.leaseContractTemplatePlaceholders.map((p) => (
                    <li key={p.token}>
                      <code className="text-ink">{`{{${p.token}}}`}</code> — {p.description}
                    </li>
                  ))}
                </ul>
              </details>
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

          {/* Section « Paiements en ligne (FedaPay) » retirée (demande utilisateur, 2026-11-04) :
              FedaPay n'est pas encore ouvert (verrou plateforme à 0, voir platform_settings) — cette
              carte de réglages n'a donc plus sa place tant que le module n'est pas prêt à être proposé
              aux entreprises. Les champs/état associés ont été retirés avec elle ; à réintroduire en
              même temps que la carte le jour où FedaPay revient. */}

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

// ── Comptabilité avancée (SYSCOHADA) ──────────────────────────────────────
// Carte d'activation/suspension retirée de Paramètres (demande utilisateur, 2026-11-05) : le module
// reste de toute façon verrouillé côté plateforme (platform_feature_gates, migration 141) tant qu'il
// n'est pas ouvert aux entreprises — voir comptabilite-avancee-view.tsx, qui l'indique. Les réglages qui
// restent nécessaires au fonctionnement général du logiciel (date de démarrage comptable, catalogue des
// dégradations) sont désormais dans le groupe « Administration » ci-dessus, pas liés à SYSCOHADA.
