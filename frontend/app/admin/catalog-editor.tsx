"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { adminCatalog, adminSaveCatalog, adminResetCatalog, type AdminCatalog, type AdminPlan } from "@/lib/api/admin";
import { FEATURE_LABELS, type PlanKey } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { formatDateLabel, formatFcfa } from "@/lib/utils";

const ALWAYS_ON = ["core", "tenant_collect"];
const PLAN_ORDER: PlanKey[] = ["demarrage", "pro", "entreprise"];
const LIMIT_LABELS: Record<"units" | "owners" | "users", string> = { units: "Unités", owners: "Propriétaires", users: "Utilisateurs" };

/**
 * Éditeur des offres : prix par durée, limites, fonctions incluses, tarif fondateur, délai de remboursement.
 * Un prix modifié ne s'applique qu'aux achats futurs ; limites et fonctions s'appliquent tout de suite à toutes les
 * entreprises de l'offre (sans rien supprimer de l'existant).
 */
export function CatalogEditor({ token }: { token: string }) {
  const [draft, setDraft] = React.useState<AdminCatalog | null>(null);
  const [features, setFeatures] = React.useState<string[]>([]);
  const [changes, setChanges] = React.useState<{ id: number; adminName: string | null; createdAt: string }[]>([]);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    adminCatalog(token).then((r) => { setDraft(r.catalog); setFeatures(r.features); setChanges(r.changes); })
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Chargement impossible." }));
  }, [token]);
  React.useEffect(() => load(), [load]);

  if (!draft) return <p className="text-body-md text-ink-muted">{msg?.text ?? "Chargement…"}</p>;

  function patchPlan(k: PlanKey, fn: (p: AdminPlan) => AdminPlan) {
    setDraft((d) => (d ? { ...d, plans: { ...d.plans, [k]: fn(d.plans[k]) } } : d));
  }
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "")));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminSaveCatalog(token, draft!);
      setDraft(r.catalog);
      setMsg({ ok: true, text: "Offres enregistrées. Les nouveaux prix s'appliquent aux prochains achats ; limites et fonctions s'appliquent déjà." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    if (!window.confirm("Revenir aux offres et prix d'origine ?")) return;
    setBusy(true);
    try {
      setDraft((await adminResetCatalog(token)).catalog);
      setMsg({ ok: true, text: "Offres réinitialisées." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Réinitialisation impossible." });
    } finally {
      setBusy(false);
    }
  }

  const f = draft.founder;
  return (
    <div className="flex flex-col gap-4">
      {msg && <p className={`rounded border p-3 text-body-sm ${msg.ok ? "border-success-border bg-success-bg text-success-fg" : "border-danger-border bg-danger-bg text-danger-fg"}`}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((k) => {
          const p = draft.plans[k];
          return (
            <Card key={k}>
              <CardHeader>
                <CardTitle>{p.label}</CardTitle>
                <CardDescription>Code interne : {k}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Nom affiché" htmlFor={`l-${k}`}>
                  <Input id={`l-${k}`} value={p.label} onChange={(e) => patchPlan(k, (x) => ({ ...x, label: e.target.value }))} />
                </Field>
                <label className="flex items-center gap-2 text-body-sm text-ink-soft">
                  <input type="checkbox" checked={p.featured} onChange={(e) => setDraft((d) => d && ({ ...d, plans: Object.fromEntries(PLAN_ORDER.map((pk) => [pk, { ...d.plans[pk], featured: e.target.checked && pk === k }])) as AdminCatalog["plans"] }))} />
                  Offre recommandée (mise en avant)
                </label>

                <div className="flex flex-col gap-2">
                  <p className="font-label-md text-ink">Durées et prix (FCFA)</p>
                  {p.offers.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input aria-label="Mois" inputMode="numeric" className="w-20" value={o.months} onChange={(e) => patchPlan(k, (x) => ({ ...x, offers: x.offers.map((oo, j) => (j === i ? { ...oo, months: Number(e.target.value) || 0 } : oo)) }))} />
                      <span className="text-body-sm text-ink-muted">mois</span>
                      <Input aria-label="Prix" inputMode="numeric" value={o.price} onChange={(e) => patchPlan(k, (x) => ({ ...x, offers: x.offers.map((oo, j) => (j === i ? { ...oo, price: Number(e.target.value.replace(/\s/g, "")) || 0 } : oo)) }))} />
                      <Button variant="ghost" size="sm" aria-label="Retirer cette durée" onClick={() => patchPlan(k, (x) => ({ ...x, offers: x.offers.filter((_, j) => j !== i) }))}>✕</Button>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" className="self-start" onClick={() => patchPlan(k, (x) => ({ ...x, offers: [...x.offers, { months: 1, price: 10000 }] }))}>+ Ajouter une durée</Button>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="font-label-md text-ink">Limites (vide = illimité)</p>
                  {(Object.keys(LIMIT_LABELS) as (keyof typeof LIMIT_LABELS)[]).map((l) => (
                    <Field key={l} label={LIMIT_LABELS[l]} htmlFor={`${k}-${l}`}>
                      <Input id={`${k}-${l}`} inputMode="numeric" placeholder="illimité" value={p.limits[l] ?? ""} onChange={(e) => patchPlan(k, (x) => ({ ...x, limits: { ...x.limits, [l]: num(e.target.value) } }))} />
                    </Field>
                  ))}
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="font-label-md text-ink">Fonctions incluses</p>
                  {features.map((ft) => (
                    <label key={ft} className="flex items-start gap-2 text-body-sm text-ink-soft">
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={ALWAYS_ON.includes(ft)}
                        checked={p.features.includes(ft)}
                        onChange={(e) => patchPlan(k, (x) => ({ ...x, features: e.target.checked ? [...x.features, ft] : x.features.filter((y) => y !== ft) }))}
                      />
                      {FEATURE_LABELS[ft] ?? ft}
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Offre promotionnelle</CardTitle>
          <CardDescription>Un pourcentage de réduction appliqué à toutes les offres et à toutes les durées. Dès l&apos;enregistrement, le montant réduit est celui que les clients paient. Si le tarif fondateur est encore plus bas, c&apos;est lui qui s&apos;applique (pas de cumul).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-body-sm text-ink-soft">
            <input type="checkbox" checked={draft.promo.enabled} onChange={(e) => setDraft({ ...draft, promo: { enabled: e.target.checked, percent: draft.promo.percent || 10 } })} />
            Promotion active
          </label>
          {draft.promo.enabled && (
            <>
              <Field label="Réduction (%)" htmlFor="pp" hint="Entre 1 et 90.">
                <Input id="pp" inputMode="numeric" className="max-w-[160px]" value={draft.promo.percent} onChange={(e) => setDraft({ ...draft, promo: { enabled: true, percent: Number(e.target.value.replace(/\D/g, "")) || 0 } })} />
              </Field>
              <ul className="grid gap-1 text-body-sm text-ink-muted sm:grid-cols-2 lg:grid-cols-3">
                {PLAN_ORDER.flatMap((k) => draft.plans[k].offers.map((o) => (
                  <li key={`${k}-${o.months}`}>
                    {draft.plans[k].label}, {o.months} mois : <span className="line-through">{formatFcfa(o.price)}</span>{" "}
                    <strong className="text-ink">{formatFcfa(Math.round((o.price * (100 - draft.promo.percent)) / 100))}</strong>
                  </li>
                )))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tarif fondateur et garantie</CardTitle>
          <CardDescription>Remise sur le premier achat d&apos;une durée donnée, pour les premières entreprises seulement.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-body-sm text-ink-soft">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setDraft({ ...draft, founder: { ...f, enabled: e.target.checked } })} />
            Tarif fondateur actif
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Offre" htmlFor="fp">
              <select id="fp" value={f.planKey} onChange={(e) => setDraft({ ...draft, founder: { ...f, planKey: e.target.value as PlanKey } })} className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink">
                {PLAN_ORDER.map((k) => <option key={k} value={k}>{draft.plans[k].label}</option>)}
              </select>
            </Field>
            <Field label="Durée (mois)" htmlFor="fm"><Input id="fm" inputMode="numeric" value={f.months} onChange={(e) => setDraft({ ...draft, founder: { ...f, months: Number(e.target.value) || 0 } })} /></Field>
            <Field label="Prix fondateur (FCFA)" htmlFor="fpr"><Input id="fpr" inputMode="numeric" value={f.price} onChange={(e) => setDraft({ ...draft, founder: { ...f, price: Number(e.target.value.replace(/\s/g, "")) || 0 } })} /></Field>
            <Field label="Nombre de places" htmlFor="fn"><Input id="fn" inputMode="numeric" value={f.maxCompanies} onChange={(e) => setDraft({ ...draft, founder: { ...f, maxCompanies: Number(e.target.value) || 0 } })} /></Field>
          </div>
          <Field label="Délai de remboursement (jours)" htmlFor="rw" hint="S'applique aux prochains premiers paiements.">
            <Input id="rw" inputMode="numeric" className="max-w-[160px]" value={draft.refundWindowDays} onChange={(e) => setDraft({ ...draft, refundWindowDays: Number(e.target.value) || 0 })} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer les offres"}</Button>
        <Button variant="ghost" onClick={load} disabled={busy}>Annuler mes changements</Button>
        <Button variant="danger" onClick={reset} disabled={busy}>Revenir aux valeurs d&apos;origine</Button>
      </div>

      {changes.length > 0 && (
        <p className="text-body-xs text-ink-muted">
          Dernières modifications : {changes.slice(0, 5).map((c) => `${formatDateLabel(c.createdAt.slice(0, 10))} (${c.adminName ?? "—"})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
