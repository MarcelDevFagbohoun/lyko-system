"use client";

import * as React from "react";
import {
  Lock,
  LockOpen,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";


export const GUIDE_SEEN_KEY = "aim.cloture.guideSeen";

export function HowMonthsWorkCard() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!window.localStorage.getItem(GUIDE_SEEN_KEY)) {
        setOpen(true);
        window.localStorage.setItem(GUIDE_SEEN_KEY, "1");
      }
    } catch {
      // Stockage indisponible (navigation privée…) : l'explication reste simplement repliée.
    }
  }, []);

  return (
    <Card className="border-info-border bg-info-bg/40">
      <CardContent className="flex flex-col gap-3 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="inline-flex items-center gap-2 font-label-md text-ink">
            <HelpCircle size={18} className="text-info-fg" />
            Comment fonctionne la clôture d&apos;un mois ?
          </span>
          {open ? <ChevronUp size={18} className="text-ink-muted" /> : <ChevronDown size={18} className="text-ink-muted" />}
        </button>

        {open && (
          <div className="flex flex-col gap-4 border-t border-info-border pt-3 text-body-sm text-ink-soft">
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-white">
                <LockOpen size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Un mois est ouvert par défaut</p>
                <p>Rien à faire pour ouvrir un mois : on peut y enregistrer paiements, dépenses et charges.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger text-white">
                <Lock size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Clôturer verrouille le mois pour toujours</p>
                <p>
                  Plus aucun paiement, versement, dépense ou charge daté de ce mois ne peut être ajouté, modifié ou
                  supprimé, même par le DG. Seul le DG clôture, une fois les échéances de loyer du mois passées.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <ArrowRight size={14} />
              </span>
              <div>
                <p className="font-label-md text-ink">Un mois après l&apos;autre</p>
                <p>On ne peut pas clôturer octobre avant septembre : cette page vous propose toujours le bon mois.</p>
              </div>
            </div>
            <div className="rounded-lg bg-surface px-3 py-2.5">
              <p className="font-label-sm uppercase tracking-wider text-ink-muted">Exemple</p>
              <p className="mt-1">
                Le 10 octobre, toutes les échéances de septembre sont passées : la page affiche « Septembre est prêt ».
                Vous vérifiez la liste, puis cliquez sur « Clôturer septembre ». Octobre reste ouvert, sans rien faire.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Frise des mois (point 2) ──────────────────────────────────────────────────────────────────

