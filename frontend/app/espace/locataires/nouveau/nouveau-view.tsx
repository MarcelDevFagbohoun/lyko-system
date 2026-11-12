"use client";

import * as React from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth/require-auth";
import { ArrowLeft, UserPlus, History } from "lucide-react";
import { formatFcfa } from "@/lib/utils";
import { PropertyUnitPicker } from "@/components/properties/property-unit-picker";
import { OfflineNotice } from "@/components/system/offline-notice";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { IdentityFields } from "./sections/identity-fields";
import { LeaseTermsFields } from "./sections/lease-terms-fields";
import { ProrataBlock } from "./sections/prorata-block";
import { AdditionalDepositsBlock } from "./sections/additional-deposits-block";
import { BillingOptionsFields } from "./sections/billing-options-fields";
import { PortalLinkSuccessPanel } from "./sections/portal-link-success-panel";
import { useNewRenterForm } from "./sections/use-new-renter-form";

export function NouveauView() {
  return (
    <RequireAuth permission="locataires">
      <NouveauContent />
    </RequireAuth>
  );
}

/**
 * Choix explicite fait par l'agent avant le formulaire (demande utilisateur, 2026-11-12 : « deux
 * options nouveau locataire et ancien locataire ») — remplace l'ancienne déduction à partir de la
 * seule date d'entrée. Tant qu'aucun choix n'est fait, le formulaire lui-même n'est pas affiché :
 * voir `TenantKindPicker` plus bas.
 */
type TenantKind = "nouveau" | "ancien";

function NouveauContent() {
  const [tenantKind, setTenantKind] = React.useState<TenantKind | null>(null);
  const {
    accessToken,
    online,
    rhythm,
    isCalendaireRhythm,
    form,
    selectedUnit,
    touched,
    setTouched,
    additionalDepositsTouched,
    setAdditionalDepositsTouched,
    submitting,
    serverError,
    result,
    set,
    setAdditionalDeposit,
    enabledAdditionalDepositTypes,
    handleSelectUnit,
    isHistoricalStartDate,
    prorataPreview,
    errors,
    additionalDepositErrors,
    handleSubmit,
  } = useNewRenterForm(tenantKind ?? "nouveau");

  return (
    <div className="min-h-screen bg-canvas">
      <div className="content-shell flex flex-col gap-6 py-10">
        <Link
          href="/espace/locataires"
          className="inline-flex w-fit items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} />
          Retour aux locataires
        </Link>

        {result ? (
          <PortalLinkSuccessPanel renter={result} accessToken={accessToken} />
        ) : !tenantKind ? (
          <TenantKindPicker onSelect={setTenantKind} />
        ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{tenantKind === "ancien" ? "Ancien locataire" : "Nouveau locataire"}</CardTitle>
                <CardDescription>
                  {tenantKind === "ancien"
                    ? "Locataire déjà en place avant Africa Immo Management : renseignez son bail et, le cas échéant, ses impayés à l'entrée."
                    : "Sélectionnez d'abord une unité libre, puis renseignez le locataire et les termes du bail. L'état des lieux d'entrée pourra être réalisé juste après."}
                </CardDescription>
              </div>
              <button
                type="button"
                onClick={() => setTenantKind(null)}
                className="shrink-0 text-body-xs text-ink-muted underline hover:text-ink"
              >
                Changer
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
              {!online && <OfflineNotice action="la création d'un locataire" />}
              {serverError && (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
                  {serverError}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">
                  Bien &amp; unité louée
                </span>
                <PropertyUnitPicker accessToken={accessToken} selectedUnit={selectedUnit} onSelect={handleSelectUnit} />
                {selectedUnit && (
                  <p className="text-body-xs text-success-fg">
                    Unité {selectedUnit.code} sélectionnée — {formatFcfa(selectedUnit.monthlyRent)}/mois.
                  </p>
                )}
              </div>

              <IdentityFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} />

              <div className="flex flex-col gap-4 border-t border-border pt-5">
                <span className="font-label-sm uppercase tracking-wider text-ink-muted">Bail</span>
                <LeaseTermsFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} rhythm={rhythm} />
                <ProrataBlock form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} isCalendaireRhythm={isCalendaireRhythm} isHistoricalStartDate={isHistoricalStartDate} prorataPreview={prorataPreview} />
                <AdditionalDepositsBlock form={form} enabledTypes={enabledAdditionalDepositTypes} touchedByType={additionalDepositsTouched} setTouchedByType={setAdditionalDepositsTouched} errorsByType={additionalDepositErrors} setAdditionalDeposit={setAdditionalDeposit} />
                <BillingOptionsFields form={form} set={set} touched={touched} setTouched={setTouched} errors={errors} isHistoricalStartDate={isHistoricalStartDate} />
              </div>

              <Button type="submit" size="lg" disabled={submitting || !selectedUnit || !online}>
                {submitting
                  ? "Création en cours…"
                  : !online
                    ? "Indisponible hors-ligne"
                    : !selectedUnit
                      ? "Sélectionnez une unité"
                      : "Créer le locataire"}
              </Button>
            </form>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}

/** Écran de choix avant le formulaire (demande utilisateur, 2026-11-12). */
function TenantKindPicker({ onSelect }: { onSelect: (kind: TenantKind) => void }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Quel type de locataire ?</CardTitle>
        <CardDescription>Le formulaire s&apos;adapte ensuite selon votre choix.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onSelect("nouveau")}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left transition hover:border-primary hover:bg-surface-muted"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-bg text-primary">
              <UserPlus size={20} />
            </span>
            <span className="font-label-md text-ink">Nouveau locataire</span>
            <span className="text-body-sm text-ink-soft">
              Il signe aujourd&apos;hui et s&apos;installe maintenant — aucun impayé antérieur à déclarer.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onSelect("ancien")}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left transition hover:border-primary hover:bg-surface-muted"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-bg text-primary">
              <History size={20} />
            </span>
            <span className="font-label-md text-ink">Ancien locataire</span>
            <span className="text-body-sm text-ink-soft">
              Déjà en place avant Africa Immo Management — vous pourrez déclarer ses impayés
              éventuels (loyer, SBEE, SONEB, poubelle, autres) et s&apos;il est à jour ou non.
            </span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
