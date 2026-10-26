"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/auth/require-auth";
import { ArrowLeft } from "lucide-react";
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

function NouveauContent() {
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
  } = useNewRenterForm();

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
        ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Nouveau locataire</CardTitle>
            <CardDescription>
              Sélectionnez d&apos;abord une unité libre, puis renseignez le locataire et les
              termes du bail. L&apos;état des lieux d&apos;entrée pourra être réalisé juste après.
            </CardDescription>
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
