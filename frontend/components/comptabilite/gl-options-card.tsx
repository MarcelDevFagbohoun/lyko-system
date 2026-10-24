"use client";

import * as React from "react";
import { Banknote, Check, ChevronDown, ChevronUp, History, Info, Landmark, Lock, Receipt, type LucideIcon } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  getGlSettings,
  getGlSettingsLog,
  updateGlSettings,
  type GlProfile,
  type GlSettings,
  type GlSettingsLogItem,
  type GlSettingsUpdate,
  type ItsBracket,
} from "@/lib/api/gl";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/toast/toast-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PROFILES: { key: Exclude<GlProfile, "personnalise">; title: string; tagline: string; points: string[] }[] = [
  {
    key: "simple",
    title: "Simple",
    tagline: "Comme jusqu'ici",
    points: ["Aucun changement dans vos écritures", "Idéal pour démarrer ou si vous ne tenez pas de comptabilité officielle"],
  },
  {
    key: "standard",
    title: "Standard OHADA",
    tagline: "Conseillé pour un cabinet déclaré",
    points: ["TVA sur vos commissions", "Résultat enregistré en fin d'année", "Charges SONEB/SBEE sur un compte propriétaire", "Ventes de matériel avec prix"],
  },
  {
    key: "complet",
    title: "Complet",
    tagline: "Avec la paie CNSS et ITS",
    points: ["Tout le profil Standard", "Fiches de paie avec CNSS et ITS", "Dettes CNSS et impôt suivies à part"],
  },
];

const KEY_LABELS: Record<string, string> = {
  depreciationProrataTemporis: "Prorata du 1er mois d'amortissement",
  irfEnabled: "Retenue IRF",
  irfRate: "Taux IRF",
  irfBase: "Base de calcul de l'IRF",
  vatEnabled: "TVA sur les commissions",
  vatRate: "Taux de TVA",
  closingMode: "Fin d'année",
  utilityAccountMode: "Charges SONEB/SBEE",
  payrollLevel: "Niveau de paie",
  cnssEmployeeRate: "CNSS part salarié",
  cnssEmployerRate: "CNSS part employeur",
  itsBrackets: "Barème ITS",
  assetSaleProceeds: "Vente de matériel avec prix",
};

function formatLogValue(v: string | null) {
  if (v === null) return "—";
  try {
    const p = JSON.parse(v);
    if (p === true) return "oui";
    if (p === false) return "non";
    if (Array.isArray(p)) return `${p.length} tranche(s)`;
    return String(p);
  } catch {
    return v;
  }
}

type GroupKey = "taxes" | "paie" | "exploitation" | "cloture";
const GROUPS: { key: GroupKey; label: string; icon: LucideIcon; help: string }[] = [
  { key: "taxes", label: "Taxes", icon: Landmark, help: "TVA sur vos commissions et retenue à la source sur les loyers." },
  { key: "paie", label: "Paie", icon: Banknote, help: "Détail des fiches de paie : CNSS et impôt sur salaires." },
  { key: "exploitation", label: "Biens & charges", icon: Receipt, help: "Charges SONEB/SBEE, ventes et amortissement du matériel." },
  { key: "cloture", label: "Clôture", icon: Lock, help: "Ce qui se passe quand vous fermez une année comptable." },
];

function Pill({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-body-xs", on ? "border-success-border bg-success-bg text-success-fg" : "border-border bg-surface-muted text-ink-muted")}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success-strong" : "bg-border-strong")} />
      {children}
    </span>
  );
}

function Choice({
  checked,
  onSelect,
  disabled,
  title,
  children,
  badge,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  children?: React.ReactNode;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        checked ? "border-primary bg-primary/5" : "border-border hover:border-border-strong",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-primary bg-primary text-white" : "border-border-strong",
        )}
      >
        {checked && <Check size={10} />}
      </span>
      <span className="min-w-0">
        <span className="font-label-md text-ink">
          {title}
          {badge && <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-body-xs text-success-fg">{badge}</span>}
        </span>
        {children && <span className="mt-0.5 block text-body-xs text-ink-muted">{children}</span>}
      </span>
    </button>
  );
}

function Section({ title, help, status, children }: { title: string; help: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-label-md text-ink">{title}</h3>
          <p className="text-body-xs text-ink-muted">{help}</p>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ checked, disabled, onChange, title, children }: { checked: boolean; disabled?: boolean; onChange: () => void; title: string; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus-visible:ring-2 focus-visible:ring-primary"
      />
      <span>
        <span className="font-label-md text-ink">{title}</span>
        <span className="block text-body-xs text-ink-muted">{children}</span>
      </span>
    </label>
  );
}

function RateInput({ value, onChange, suffix = "%", width = "w-20" }: { value: string; onChange: (v: string) => void; suffix?: string; width?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").slice(0, 6))} className={cn(width, "tabular")} />
      <span className="text-body-sm text-ink-soft">{suffix}</span>
    </span>
  );
}

/**
 * Options comptables par entreprise, en langage courant : un profil prêt à l'emploi
 * (Simple / Standard OHADA / Complet) puis chaque option expliquée. Toute modification est
 * journalisée (qui, quand, avant/après). Les défauts reproduisent le comportement historique.
 */
export function GlOptionsCard({ accessToken }: { accessToken: string | null }) {
  const toast = useToast();
  const [s, setS] = React.useState<GlSettings | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [vatRate, setVatRate] = React.useState("18");
  const [irfRate, setIrfRate] = React.useState("0");
  const [cnssEmp, setCnssEmp] = React.useState("0");
  const [cnssEr, setCnssEr] = React.useState("0");
  const [brackets, setBrackets] = React.useState<{ upTo: string; rate: string }[]>([]);
  const [group, setGroup] = React.useState<GroupKey>("taxes");
  const [logOpen, setLogOpen] = React.useState(false);
  const [log, setLog] = React.useState<GlSettingsLogItem[] | null>(null);

  const sync = React.useCallback((next: GlSettings) => {
    setS(next);
    setVatRate(String(next.vatRate));
    setIrfRate(String(next.irfRate));
    setCnssEmp(String(next.cnssEmployeeRate));
    setCnssEr(String(next.cnssEmployerRate));
    const b = next.itsBrackets && next.itsBrackets.length > 0 ? next.itsBrackets : [{ upTo: null, rate: 0 }];
    setBrackets(b.map((x) => ({ upTo: x.upTo === null ? "" : String(x.upTo), rate: String(x.rate) })));
  }, []);

  React.useEffect(() => {
    if (!accessToken) return;
    getGlSettings(accessToken)
      .then(sync)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les options."));
  }, [accessToken, sync]);

  async function apply(patch: GlSettingsUpdate, message: string) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      sync(await updateGlSettings(accessToken, patch));
      toast.success(message);
      setLog(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce choix.");
    } finally {
      setBusy(false);
    }
  }

  function chooseProfile(key: Exclude<GlProfile, "personnalise">) {
    if (!s || s.profile === key) return;
    const p = PROFILES.find((x) => x.key === key)!;
    const ok = window.confirm(
      `Passer au profil « ${p.title} » ?\n\nCela règle plusieurs options d'un coup. Vos écritures passées ne sont pas modifiées : le changement s'applique aux prochaines opérations. Vous pourrez ajuster chaque option ensuite.`,
    );
    if (!ok) return;
    void apply({ profile: key }, `Profil « ${p.title} » appliqué.`);
  }

  function saveBrackets() {
    const parsed: ItsBracket[] = brackets.map((b, i) => ({
      upTo: i === brackets.length - 1 ? null : Number(b.upTo),
      rate: Number(b.rate),
    }));
    if (parsed.some((b, i) => (i < parsed.length - 1 && (!Number.isFinite(b.upTo) || (b.upTo ?? 0) <= 0)) || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100)) {
      setError("Barème ITS : renseignez un plafond positif et un taux entre 0 et 100 pour chaque tranche.");
      return;
    }
    void apply({ itsBrackets: parsed }, "Barème ITS enregistré.");
  }

  async function toggleLog() {
    const next = !logOpen;
    setLogOpen(next);
    if (next && accessToken && !log) {
      try {
        setLog((await getGlSettingsLog(accessToken)).items);
      } catch {
        setLog([]);
      }
    }
  }

  if (!s) return error ? <p className="text-body-sm text-danger-fg">{error}</p> : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Options comptables</CardTitle>
        <CardDescription>
          Choisissez le niveau de détail de votre comptabilité. Un changement s&apos;applique aux prochaines opérations ; les
          écritures déjà passées ne bougent pas. Faites valider vos choix par votre expert-comptable.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        <div role="radiogroup" aria-label="Profil comptable" className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PROFILES.map((p) => {
            const active = s.profile === p.key;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => chooseProfile(p.key)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-4",
                  active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-label-md text-ink">{p.title}</span>
                  {active && <span className="rounded-full bg-primary px-2 py-0.5 text-body-xs text-white">Actuel</span>}
                </span>
                <span className="text-body-xs font-medium text-primary">{p.tagline}</span>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-body-xs text-ink-muted">
                  {p.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {s.profile === "personnalise" && (
          <p className="flex items-center gap-1.5 text-body-xs text-ink-muted">
            <Info size={14} /> Vos choix ne correspondent à aucun profil : configuration personnalisée.
          </p>
        )}

        {/* Navigation par thème : une seule famille d'options à l'écran, avec l'état de chacune en un coup d'œil. */}
        <div role="tablist" aria-label="Familles d'options" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {GROUPS.map((g) => {
            const on =
              g.key === "taxes" ? s.vatEnabled || s.irfEnabled : g.key === "paie" ? s.payrollLevel !== "net" : g.key === "cloture" ? s.closingMode === "complet" : s.utilityAccountMode === "proprietaire" || s.assetSaleProceeds;
            const Icon = g.icon;
            const active = group === g.key;
            return (
              <button
                key={g.key}
                type="button"
                role="tab"
                id={`gl-tab-${g.key}`}
                aria-selected={active}
                aria-controls={`gl-panel-${g.key}`}
                onClick={() => setGroup(g.key)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-body-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "border-primary bg-primary text-white shadow-md" : "border-border bg-surface text-ink-soft hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm",
                )}
              >
                <Icon size={16} />
                <span className="font-label-md">{g.label}</span>
                <span aria-hidden className={cn("h-2 w-2 rounded-full", on ? (active ? "bg-white" : "bg-success-strong") : active ? "bg-white/40" : "bg-border-strong")} />
              </button>
            );
          })}
        </div>

        {GROUPS.map((g) => (
          <div
            key={g.key}
            role="tabpanel"
            id={`gl-panel-${g.key}`}
            aria-labelledby={`gl-tab-${g.key}`}
            hidden={group !== g.key}
            className={cn("flex-col gap-3", group === g.key ? "flex animate-fade-up" : "hidden")}
          >
            <p className="text-body-sm text-ink-soft">{g.help}</p>
            {g.key === "taxes" && (
              <>
        <Section
          title="TVA sur mes commissions"
          status={<Pill on={s.vatEnabled}>{s.vatEnabled ? `Activée · ${s.vatRate} %` : "Désactivée"}</Pill>}
          help="Si votre cabinet est assujetti à la TVA, la taxe incluse dans votre commission est mise de côté pour l'État. Rien ne change pour les propriétaires ni pour la caisse."
        >
          <ToggleRow checked={s.vatEnabled} disabled={busy} onChange={() => apply({ vatEnabled: !s.vatEnabled }, s.vatEnabled ? "TVA désactivée." : "TVA activée.")} title="Calculer la TVA sur mes commissions">
            Votre pourcentage de commission est considéré TTC : la TVA est extraite du montant et suivie dans « TVA à reverser ».
          </ToggleRow>
          {s.vatEnabled && (
            <div className="flex flex-wrap items-center gap-2 pl-1">
              <span className="text-body-sm text-ink-soft">Taux de TVA</span>
              <RateInput value={vatRate} onChange={setVatRate} />
              <Button size="sm" variant="secondary" disabled={busy || vatRate === "" || Number(vatRate) === s.vatRate} onClick={() => apply({ vatRate: Number(vatRate) }, `Taux de TVA fixé à ${vatRate} %.`)}>
                Enregistrer
              </Button>
            </div>
          )}
        </Section>

        <Section title="Impôt sur le revenu foncier (IRF)" status={<Pill on={s.irfEnabled}>{s.irfEnabled ? `Activé · ${s.irfRate} %` : "Désactivé"}</Pill>} help="Retenue à la source sur les loyers des propriétaires, à reverser au fisc.">
          <ToggleRow checked={s.irfEnabled} disabled={busy} onChange={() => apply({ irfEnabled: !s.irfEnabled }, s.irfEnabled ? "Retenue IRF désactivée." : "Retenue IRF activée.")} title="Retenir l'IRF à chaque reversement">
            Désactivé par défaut. La somme retenue est suivie dans « IRF à reverser ».
          </ToggleRow>
          {s.irfEnabled && (
            <>
              <div className="flex flex-wrap items-center gap-2 pl-1">
                <span className="text-body-sm text-ink-soft">Taux</span>
                <RateInput value={irfRate} onChange={(v) => setIrfRate(v.replace(/\D/g, ""))} />
                <Button size="sm" variant="secondary" disabled={busy || irfRate === "" || Number(irfRate) === s.irfRate} onClick={() => apply({ irfRate: Number(irfRate) }, `Taux IRF fixé à ${irfRate} %.`)}>
                  Enregistrer
                </Button>
              </div>
              <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Choice checked={s.irfBase === "versement"} disabled={busy} onSelect={() => apply({ irfBase: "versement" }, "IRF calculé sur le montant versé.")} title="Sur le montant versé">
                  Le taux s&apos;applique à la somme reversée au propriétaire.
                </Choice>
                <Choice checked={s.irfBase === "loyer_brut"} disabled={busy} onSelect={() => apply({ irfBase: "loyer_brut" }, "IRF calculé sur le loyer brut.")} title="Sur le loyer brut">
                  Le taux s&apos;applique au loyer avant votre commission. Demandez à votre comptable laquelle des deux bases s&apos;applique.
                </Choice>
              </div>
            </>
          )}
        </Section>


              </>
            )}
            {g.key === "paie" && (
              <>
        <Section title="Salaires" status={<Pill on={s.payrollLevel !== "net"}>{s.payrollLevel === "net" ? "Net seul" : s.payrollLevel === "cnss" ? "Avec CNSS" : "CNSS + ITS"}</Pill>} help="Niveau de détail des fiches de paie. Les taux et le barème sont à saisir selon la réglementation en vigueur : demandez-les à votre comptable.">
          <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Choice checked={s.payrollLevel === "net"} disabled={busy} onSelect={() => apply({ payrollLevel: "net" }, "Paie : net seul.")} title="Net seul">
              Seul le net payé est enregistré.
            </Choice>
            <Choice checked={s.payrollLevel === "cnss"} disabled={busy} onSelect={() => apply({ payrollLevel: "cnss" }, "Paie avec CNSS.")} title="Avec CNSS">
              Part salariale retenue et part employeur suivies comme dette envers la CNSS.
            </Choice>
            <Choice checked={s.payrollLevel === "complet"} disabled={busy} onSelect={() => apply({ payrollLevel: "complet" }, "Paie avec CNSS et ITS.")} title="Avec CNSS et ITS">
              Ajoute l&apos;impôt sur salaires retenu (barème à saisir ci-dessous).
            </Choice>
          </div>
          {s.payrollLevel !== "net" && (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-muted p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
                  CNSS part salarié <RateInput value={cnssEmp} onChange={setCnssEmp} />
                </span>
                <span className="inline-flex items-center gap-2 text-body-sm text-ink-soft">
                  CNSS part employeur <RateInput value={cnssEr} onChange={setCnssEr} />
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || cnssEmp === "" || cnssEr === "" || (Number(cnssEmp) === s.cnssEmployeeRate && Number(cnssEr) === s.cnssEmployerRate)}
                  onClick={() => apply({ cnssEmployeeRate: Number(cnssEmp), cnssEmployerRate: Number(cnssEr) }, "Taux CNSS enregistrés.")}
                >
                  Enregistrer les taux
                </Button>
              </div>
              {s.payrollLevel === "complet" && (
                <div className="flex flex-col gap-2">
                  <p className="text-body-xs text-ink-muted">
                    Barème ITS mensuel : pour chaque tranche du salaire imposable (brut − CNSS salarié), le taux appliqué. La dernière tranche n&apos;a pas de plafond.
                  </p>
                  {brackets.map((b, i) => {
                    const last = i === brackets.length - 1;
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2 text-body-sm text-ink-soft">
                        <span className="w-24">{last ? "Au-delà" : "Jusqu'à"}</span>
                        {!last && (
                          <RateInput value={b.upTo} suffix="FCFA" width="w-28" onChange={(v) => setBrackets((cur) => cur.map((x, j) => (j === i ? { ...x, upTo: v.replace(/\./g, "") } : x)))} />
                        )}
                        <span>taux</span>
                        <RateInput value={b.rate} onChange={(v) => setBrackets((cur) => cur.map((x, j) => (j === i ? { ...x, rate: v } : x)))} />
                        {brackets.length > 1 && (
                          <Button size="sm" variant="ghost" onClick={() => setBrackets((cur) => cur.filter((_, j) => j !== i))}>
                            Retirer
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setBrackets((cur) => [...cur.slice(0, -1), { upTo: "", rate: "0" }, cur[cur.length - 1]])}>
                      + Ajouter une tranche
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={saveBrackets}>
                      Enregistrer le barème
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>


              </>
            )}
            {g.key === "exploitation" && (
              <>
        <Section title="Charges SONEB / SBEE" status={<Pill on={s.utilityAccountMode === "proprietaire"}>{s.utilityAccountMode === "proprietaire" ? "Compte propriétaire" : "Compte locataires"}</Pill>} help="Où est enregistré l'argent des factures d'eau et d'électricité encaissé chez les locataires, en attendant de le créditer au propriétaire.">
          <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Choice checked={s.utilityAccountMode === "clients"} disabled={busy} onSelect={() => apply({ utilityAccountMode: "clients" }, "Charges enregistrées sur le compte clients.")} title="Compte des locataires (actuel)">
              Passe temporairement par le compte du locataire. Simple, mais le compte client paraît « créditeur ».
            </Choice>
            <Choice checked={s.utilityAccountMode === "proprietaire"} disabled={busy} onSelect={() => apply({ utilityAccountMode: "proprietaire" }, "Charges enregistrées sur un compte propriétaire.")} title="Compte du propriétaire" badge="Conseillé">
              Le compte des locataires reste propre. L&apos;argent est suivi séparément pour chaque propriétaire.
            </Choice>
          </div>
        </Section>

        <Section title="Vente de matériel" status={<Pill on={s.assetSaleProceeds}>{s.assetSaleProceeds ? "Avec prix" : "Sans prix"}</Pill>} help="Quand vous sortez une immobilisation (ordinateur, véhicule, mobilier) en la vendant.">
          <ToggleRow checked={s.assetSaleProceeds} disabled={busy} onChange={() => apply({ assetSaleProceeds: !s.assetSaleProceeds }, s.assetSaleProceeds ? "Vente sans prix." : "Vente avec prix activée.")} title="Saisir le prix de vente">
            Le prix encaissé est enregistré en trésorerie, et le gain ou la perte sur la vente apparaît au compte de résultat.
          </ToggleRow>
        </Section>

        <ToggleRow
          checked={s.depreciationProrataTemporis}
          disabled={busy}
          onChange={() => apply({ depreciationProrataTemporis: !s.depreciationProrataTemporis }, s.depreciationProrataTemporis ? "Amortissement en mois plein." : "Amortissement proratisé.")}
          title="Proratiser le 1er mois d'amortissement"
        >
          Un bien acquis en cours de mois n&apos;amortit que les jours restants de ce mois-là. Les mois suivants restent pleins.
        </ToggleRow>


              </>
            )}
            {g.key === "cloture" && (
              <>
        <Section title="Fin d'année" status={<Pill on={s.closingMode === "complet"}>{s.closingMode === "complet" ? "Complète" : "Simple"}</Pill>} help="Ce qui se passe quand vous clôturez un exercice (une année comptable).">
          <div role="radiogroup" className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Choice checked={s.closingMode === "simple"} disabled={busy} onSelect={() => apply({ closingMode: "simple" }, "Clôture simple.")} title="Simple">
              L&apos;année est seulement verrouillée. Aucune écriture n&apos;est ajoutée.
            </Choice>
            <Choice checked={s.closingMode === "complet"} disabled={busy} onSelect={() => apply({ closingMode: "complet" }, "Clôture complète activée.")} title="Complète" badge="Conseillé">
              Le bénéfice ou la perte de l&apos;année est enregistré dans vos capitaux propres et reporté sur l&apos;année suivante.
            </Choice>
          </div>
        </Section>


              </>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <button type="button" onClick={toggleLog} className="flex items-center gap-1.5 self-start text-body-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <History size={14} /> Historique des modifications {logOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {logOpen &&
            (log === null ? (
              <p className="text-body-xs text-ink-muted">Chargement…</p>
            ) : log.length === 0 ? (
              <p className="text-body-xs text-ink-muted">Aucune modification enregistrée.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-body-xs">
                {log.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                    <span className="text-ink">
                      {KEY_LABELS[l.key] ?? l.key} : <span className="text-ink-muted">{formatLogValue(l.oldValue)}</span> → <strong>{formatLogValue(l.newValue)}</strong>
                    </span>
                    <span className="text-ink-muted">
                      {l.userName ?? "—"} · {String(l.createdAt).slice(0, 16).replace("T", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
