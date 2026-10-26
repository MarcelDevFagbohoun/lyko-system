"use client";

import * as React from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { type Property } from "@/lib/api/properties";
import { updatePropertyUtilityConfig, type UtilityConfigInput } from "@/lib/api/charges";
import { UTILITY_TYPE_LABELS, LOSS_ALLOCATION_LABELS } from "@/lib/constants/charges";
import { formatFcfa } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useToast } from "@/lib/toast/toast-context";


/**
 * Section « Compteurs & fluides » — configuration du sous-comptage SONEB/SBEE
 * par immeuble (étape 9bis) : active/désactive, tarif au m³/kWh, n° du
 * compteur principal. Sert de base au relevé mensuel par immeuble.
 */
export function UtilityConfigCard({
  property,
  accessToken,
  onSaved,
}: {
  property: Property;
  accessToken: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toast = useToast();

  const cfg = property.utilityConfig;
  const anySubmetered = cfg.soneb.submetered || cfg.sbee.submetered;

  const [form, setForm] = React.useState<Record<string, string>>(() => ({
    sonebSubmetered: cfg.soneb.submetered ? "1" : "",
    sbeeSubmetered: cfg.sbee.submetered ? "1" : "",
    sonebUnitPrice: cfg.soneb.unitPrice != null ? String(cfg.soneb.unitPrice) : "",
    sbeeUnitPrice: cfg.sbee.unitPrice != null ? String(cfg.sbee.unitPrice) : "",
    sonebMainMeterNumber: cfg.soneb.mainMeterNumber ?? "",
    sbeeMainMeterNumber: cfg.sbee.mainMeterNumber ?? "",
    sonebAccountNumber: cfg.soneb.accountNumber ?? "",
    sbeeAccountNumber: cfg.sbee.accountNumber ?? "",
    sonebLossAllocation: cfg.soneb.lossAllocation,
    sbeeLossAllocation: cfg.sbee.lossAllocation,
  }));
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const payload: UtilityConfigInput = {
      sonebSubmetered: form.sonebSubmetered === "1",
      sbeeSubmetered: form.sbeeSubmetered === "1",
      sonebUnitPrice: form.sonebUnitPrice ? Number(form.sonebUnitPrice) : null,
      sbeeUnitPrice: form.sbeeUnitPrice ? Number(form.sbeeUnitPrice) : null,
      sonebMainMeterNumber: form.sonebMainMeterNumber,
      sbeeMainMeterNumber: form.sbeeMainMeterNumber,
      sonebAccountNumber: form.sonebAccountNumber,
      sbeeAccountNumber: form.sbeeAccountNumber,
      sonebLossAllocation: form.sonebLossAllocation as "proprietaire" | "prorata",
      sbeeLossAllocation: form.sbeeLossAllocation as "proprietaire" | "prorata",
    };
    try {
      await updatePropertyUtilityConfig(accessToken, property.id, payload);
      setEditing(false);
      onSaved();
      toast.success("Configuration des compteurs enregistrée.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-ink-muted" />
            <CardTitle>Compteurs & fluides</CardTitle>
          </div>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Configurer
            </Button>
          )}
        </div>
        <CardDescription>
          Sous-comptage SONEB / SBEE : un décompteur par unité, un compteur principal pour l&apos;immeuble.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-body-sm text-danger-fg">{error}</p>}

        {!editing ? (
          <>
            {!anySubmetered ? (
              <p className="text-body-sm text-ink-muted">
                Aucun sous-comptage activé. Activez SONEB et/ou SBEE pour utiliser le relevé mensuel par immeuble.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["soneb", "sbee"] as const).map((u) => (
                  <div key={u} className="rounded-lg border border-border p-3">
                    <p className="font-label-md text-ink">{UTILITY_TYPE_LABELS[u]}</p>
                    {cfg[u].submetered ? (
                      <ul className="mt-1 space-y-0.5 text-body-sm text-ink-soft">
                        <li>Tarif : {cfg[u].unitPrice != null ? `${formatFcfa(cfg[u].unitPrice ?? 0)} / unité` : "à définir"}</li>
                        {cfg[u].mainMeterNumber && <li>Compteur principal : {cfg[u].mainMeterNumber}</li>}
                        {cfg[u].accountNumber && <li>Abonnement : {cfg[u].accountNumber}</li>}
                        <li>Écart compteur/décompteurs : {LOSS_ALLOCATION_LABELS[cfg[u].lossAllocation]}</li>
                      </ul>
                    ) : (
                      <p className="mt-1 text-body-sm text-ink-muted">Non sous-compté</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {anySubmetered && (
              <Link
                href="/espace/charges/releves"
                className="inline-flex w-fit items-center gap-1 text-body-sm text-primary hover:underline"
              >
                Ouvrir les relevés de cet immeuble
              </Link>
            )}
          </>
        ) : (
          <>
            {(["soneb", "sbee"] as const).map((u) => {
              const cap = u === "soneb" ? "soneb" : "sbee";
              return (
                <div key={u} className="rounded-lg border border-border p-3">
                  <label className="flex items-center gap-2 font-label-md text-ink">
                    <input
                      type="checkbox"
                      checked={form[`${cap}Submetered`] === "1"}
                      onChange={(e) => set(`${cap}Submetered`, e.target.checked ? "1" : "")}
                    />
                    {UTILITY_TYPE_LABELS[u]} sous-compté
                  </label>
                  {form[`${cap}Submetered`] === "1" && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label="Tarif / unité (FCFA)" htmlFor={`${cap}Price`} required>
                        <Input
                          id={`${cap}Price`}
                          inputMode="numeric"
                          value={form[`${cap}UnitPrice`]}
                          onChange={(e) => set(`${cap}UnitPrice`, e.target.value.replace(/[^0-9.]/g, ""))}
                        />
                      </Field>
                      <Field label="N° compteur principal" htmlFor={`${cap}Meter`}>
                        <Input
                          id={`${cap}Meter`}
                          value={form[`${cap}MainMeterNumber`]}
                          onChange={(e) => set(`${cap}MainMeterNumber`, e.target.value)}
                        />
                      </Field>
                      <Field label="N° abonnement" htmlFor={`${cap}Account`}>
                        <Input
                          id={`${cap}Account`}
                          value={form[`${cap}AccountNumber`]}
                          onChange={(e) => set(`${cap}AccountNumber`, e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  {form[`${cap}Submetered`] === "1" && (
                    <div className="mt-3">
                      <Field
                        label="Écart compteur principal / décompteurs"
                        htmlFor={`${cap}LossAllocation`}
                        hint="Par défaut, à la charge du propriétaire — jamais refacturé sans ce réglage."
                      >
                        <select
                          id={`${cap}LossAllocation`}
                          value={form[`${cap}LossAllocation`]}
                          onChange={(e) => set(`${cap}LossAllocation`, e.target.value)}
                          className="h-[38px] w-full rounded border border-border-strong bg-surface px-3 text-body-md text-ink"
                        >
                          <option value="proprietaire">{LOSS_ALLOCATION_LABELS.proprietaire}</option>
                          <option value="prorata">{LOSS_ALLOCATION_LABELS.prorata}</option>
                        </select>
                      </Field>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-body-xs text-ink-muted">
              Le numéro de décompteur de chaque unité se renseigne sur l&apos;unité elle-même (SONEB / SBEE).
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Attribution à un agent (étape 14) — directement depuis la fiche du Bien,
 * en complément de la carte équivalente sur la fiche de l'employé (seul
 * endroit qui existait jusqu'ici). Un DG cherchant « à qui confier CE bien »
 * regarde naturellement la fiche du Bien, pas celle d'un employé au hasard —
 * absence remontée comme « l'attribution ne marche pas » alors que le
 * mécanisme lui-même (back-end, restriction de portée) fonctionnait déjà.
 * Réservée au DG (même règle que le routeur `employees.js`, DG uniquement).
 */
