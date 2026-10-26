"use client";

import dynamic from "next/dynamic";
import { useToast } from "@/lib/toast/toast-context";


export const LocationPicker = dynamic(() => import("@/components/properties/location-picker"), {
  ssr: false,
  loading: () => <div className="flex h-[280px] items-center justify-center rounded-lg border border-border-strong bg-surface-muted text-body-sm text-ink-muted">Chargement de la carte…</div>,
});

// Un numéro de compteur SONEB/SBEE réel compte en général 14 caractères, mais
// ce n'est plus bloquant (certains compteurs réels dérogent à cette règle) :
// un écart est signalé à l'écran, jamais en empêchant l'enregistrement.
export const METER_NUMBER_LENGTH = 14;

export function warnIfMeterNumberLengthUnusual(toast: ReturnType<typeof useToast>, label: string, value: string) {
  const trimmed = value.trim();
  if (trimmed && trimmed.length !== METER_NUMBER_LENGTH) {
    toast.warning(
      `N° compteur ${label} : ${trimmed.length} caractère${trimmed.length > 1 ? "s" : ""} au lieu de ${METER_NUMBER_LENGTH} habituellement. Enregistré quand même — vérifiez qu'il est correct.`
    );
  }
}

export const UNIT_STATUS_BADGE = {
  libre: { variant: "success" as const, label: "Libre" },
  loue: { variant: "neutral" as const, label: "Loué" },
  reserve: { variant: "warning" as const, label: "Réservé" },
};

