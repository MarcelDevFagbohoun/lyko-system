"use client";

import * as React from "react";
import { ApiError } from "@/lib/api/client";
import { adminGrantPartner, adminPartnerFeatures, type AdminTenant } from "@/lib/api/admin";
import { FEATURE_LABELS, offerLabel } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { formatDateLabel } from "@/lib/utils";

const PAID_PLANS = ["demarrage", "pro", "entreprise"];

/**
 * Attribution d'un abonnement partenaire : nombre de mois + fonctions cochées (+ limites facultatives). Déjà partenaire :
 * les mois s'ajoutent à l'échéance et les cases/limites remplacent les précédentes. Formulaire défilant sur petit écran.
 */
export function PartnerDialog({ tenant, token, onClose, onDone, onRevoke }: {
  tenant: AdminTenant;
  token: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onRevoke: (note: string) => void;
}) {
  const isPartner = tenant.planKey === "partenaire" && tenant.status === "active";
  const paidRunning = PAID_PLANS.includes(tenant.planKey ?? "") && tenant.status === "active";
  const [available, setAvailable] = React.useState<string[] | null>(null);
  const [maxMonths, setMaxMonths] = React.useState(60);
  const [months, setMonths] = React.useState("3");
  const [features, setFeatures] = React.useState<Set<string>>(new Set(tenant.partner?.features.filter((f) => f !== "core") ?? []));
  const lim = tenant.partner?.limits;
  const [units, setUnits] = React.useState(lim?.units == null ? "" : String(lim.units));
  const [owners, setOwners] = React.useState(lim?.owners == null ? "" : String(lim.owners));
  const [users, setUsers] = React.useState(lim?.users == null ? "" : String(lim.users));
  const [note, setNote] = React.useState(tenant.partner?.note ?? "Partenariat");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [revokeNote, setRevokeNote] = React.useState("");
  const [askRevoke, setAskRevoke] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    adminPartnerFeatures(token)
      .then((r) => { setAvailable(r.features); setMaxMonths(r.maxMonths); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, [token]);

  const m = Number(months);
  const monthsOk = Number.isInteger(m) && m >= 1 && m <= maxMonths;
  const parseLimit = (v: string): number | null | undefined => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  const limits = { units: parseLimit(units), owners: parseLimit(owners), users: parseLimit(users) };
  const limitsOk = Object.values(limits).every((v) => v !== undefined);
  const valid = monthsOk && limitsOk && note.trim().length >= 3 && (!paidRunning || confirmReplace) && !!available;

  function toggle(f: string) {
    setFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await adminGrantPartner(token, tenant.id, {
        months: m,
        features: [...features],
        limits: limits as { units: number | null; owners: number | null; users: number | null },
        note: note.trim(),
        replacePaid: paidRunning ? true : undefined,
      });
      onDone(`${isPartner ? "Partenariat prolongé" : "Abonnement partenaire attribué"} pour ${tenant.companyName} (${offerLabel(m)}), jusqu'au ${formatDateLabel(r.currentPeriodEnd.slice(0, 10))}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="partner-title">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle id="partner-title">{isPartner ? "Modifier le partenariat" : "Abonnement partenaire"} — {tenant.companyName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isPartner && tenant.currentPeriodEnd && (
            <p className="text-body-sm text-ink-soft">
              Partenaire jusqu&apos;au {formatDateLabel(tenant.currentPeriodEnd.slice(0, 10))}. Les mois saisis s&apos;ajoutent à cette échéance ; les fonctions cochées remplacent les précédentes.
            </p>
          )}
          {paidRunning && (
            <div role="alert" className="rounded-lg border border-warning-border bg-warning-bg p-3 text-body-sm text-ink-soft">
              <p className="font-label-md text-warning-fg">Cette entreprise a un abonnement payant en cours</p>
              <p>L&apos;abonnement partenaire le remplace : les mois déjà payés sont perdus pour elle (aucun remboursement automatique).</p>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                <span>Je confirme le remplacement de l&apos;abonnement payant.</span>
              </label>
            </div>
          )}
          <Field label="Nombre de mois offerts" htmlFor="pm" hint={`De 1 à ${maxMonths} mois`}>
            <Input id="pm" type="number" inputMode="numeric" min={1} max={maxMonths} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-label-sm text-ink-soft">Fonctions accordées</legend>
            <p className="text-body-xs text-ink-muted">{FEATURE_LABELS.core} : toujours incluses.</p>
            {!available && !error && <p className="text-body-sm text-ink-muted">Chargement…</p>}
            {available?.map((f) => (
              <label key={f} className="flex items-start gap-2 text-body-sm text-ink">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={features.has(f)} onChange={() => toggle(f)} data-testid={`partner-feature-${f}`} />
                <span>{FEATURE_LABELS[f] ?? f}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-label-sm text-ink-soft">Limites (facultatif — vide = illimité)</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Unités" htmlFor="pl-u" error={limits.units === undefined ? "Nombre entier" : undefined}>
                <Input id="pl-u" type="number" inputMode="numeric" min={0} value={units} onChange={(e) => setUnits(e.target.value)} />
              </Field>
              <Field label="Propriétaires" htmlFor="pl-o" error={limits.owners === undefined ? "Nombre entier" : undefined}>
                <Input id="pl-o" type="number" inputMode="numeric" min={0} value={owners} onChange={(e) => setOwners(e.target.value)} />
              </Field>
              <Field label="Utilisateurs" htmlFor="pl-w" error={limits.users === undefined ? "Nombre entier" : undefined}>
                <Input id="pl-w" type="number" inputMode="numeric" min={0} value={users} onChange={(e) => setUsers(e.target.value)} />
              </Field>
            </div>
          </fieldset>
          <Field label="Motif (conservé dans le journal)" htmlFor="pn">
            <Input id="pn" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {isPartner ? (
              <Button variant="ghost" onClick={() => setAskRevoke((v) => !v)} disabled={busy}>Mettre fin au partenariat</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>Annuler</Button>
              <Button disabled={!valid || busy} onClick={submit}>{busy ? "Enregistrement…" : isPartner ? "Prolonger" : "Attribuer"}</Button>
            </div>
          </div>
          {askRevoke && (
            <div className="flex flex-col gap-2 rounded-lg border border-danger-border bg-danger-bg p-3">
              <p className="text-body-sm text-ink-soft">L&apos;accès de l&apos;entreprise est coupé tout de suite ; elle devra souscrire une offre pour continuer.</p>
              <Input aria-label="Motif de fin du partenariat" placeholder="Motif (3 caractères minimum)" value={revokeNote} onChange={(e) => setRevokeNote(e.target.value)} />
              <Button variant="secondary" className="self-start" disabled={revokeNote.trim().length < 3 || busy} onClick={() => onRevoke(revokeNote.trim())}>
                Confirmer la fin du partenariat
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
