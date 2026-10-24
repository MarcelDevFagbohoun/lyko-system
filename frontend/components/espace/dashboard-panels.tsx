"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, BellRing, History, MessageCircleWarning, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compteur qui monte jusqu'à sa valeur (immédiat si l'utilisateur limite les animations). */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = React.useState(value);
  React.useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 800);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

export type ComplaintItem = {
  id: number;
  code: string;
  title: string;
  renterName: string;
  statusLabel: string;
  reportedAt: string;
  priority: string;
};

/**
 * Carte « Plaintes en cours » : bandeau dégradé (rouge s'il y a des incidents, vert sinon), compteur animé,
 * lignes à liseré de priorité qui se soulèvent au survol, état vide rassurant avec coche dessinée.
 */
export function ComplaintsPanel({ loading, openCount, items }: { loading: boolean; openCount: number; items: ComplaintItem[] }) {
  const alert = openCount > 0;
  return (
    <section
      className={cn(
        "panel-rise group/panel relative overflow-hidden rounded-2xl border bg-surface shadow-sm transition-shadow duration-300 hover:shadow-lg",
        alert ? "border-danger-border" : "border-success-border",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-28 opacity-90",
          alert ? "bg-gradient-to-b from-danger-bg to-transparent" : "bg-gradient-to-b from-success-bg to-transparent",
        )}
      />
      <header className="relative flex items-start justify-between gap-3 p-5 pb-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
            {alert && <span aria-hidden className="absolute inset-0 animate-urgent-ping rounded-2xl bg-danger/30" />}
            <span
              className={cn(
                "relative flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md transition-transform duration-300 group-hover/panel:rotate-[-6deg] group-hover/panel:scale-105",
                alert ? "bg-gradient-to-br from-danger to-danger-strong" : "bg-gradient-to-br from-success to-success-strong",
              )}
            >
              <MessageCircleWarning size={20} />
            </span>
          </span>
          <div>
            <h3 className="text-[16px] font-semibold leading-6 text-ink">Plaintes en cours</h3>
            <p className="text-body-xs text-ink-muted">Incidents non résolus, les plus urgents d&apos;abord.</p>
          </div>
        </div>
        <span
          className={cn(
            "tabular flex h-9 min-w-9 items-center justify-center rounded-full border px-3 font-label-md shadow-sm",
            alert ? "border-danger-border bg-danger-bg text-danger-fg" : "border-success-border bg-success-bg text-success-fg",
          )}
          aria-label={`${openCount} plainte(s) en cours`}
        >
          {loading ? "…" : <CountUp value={openCount} />}
        </span>
      </header>

      <div className="relative flex flex-col gap-2 px-5 pb-5">
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-success-border bg-success-bg/40 px-4 py-6 text-center">
            <svg viewBox="0 0 52 52" className="h-12 w-12 text-success-strong" fill="none" aria-hidden>
              <circle cx="26" cy="26" r="23" stroke="currentColor" strokeWidth="2.5" className="draw-circle" />
              <path d="M15 27l8 8 14-16" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="draw-check" />
            </svg>
            <p className="font-label-md text-ink">Tout est calme</p>
            <p className="text-body-xs text-ink-muted">Aucune plainte en cours pour le moment.</p>
          </div>
        )}

        <div className="stagger flex flex-col gap-2">
          {items.map((c) => {
            const urgent = c.priority === "urgente";
            return (
              <Link
                key={c.id}
                href="/espace/plaintes"
                className="group/row relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface py-3 pl-4 pr-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
              >
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", urgent ? "bg-danger-strong" : "bg-border-strong")} />
                <div className="min-w-0">
                  <p className="truncate font-label-md text-ink">
                    {c.code} · {c.title}
                  </p>
                  <p className="truncate text-body-xs text-ink-muted">
                    {c.renterName} · {c.statusLabel} · signalée le {c.reportedAt}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-label-sm uppercase tracking-[0.025em]",
                      urgent ? "border-danger-border bg-danger-bg text-danger-fg" : "border-border bg-surface-muted text-ink-soft",
                    )}
                  >
                    {urgent && (
                      <span className="relative flex h-1.5 w-1.5">
                        <span aria-hidden className="absolute inset-0 animate-urgent-ping rounded-full bg-current" />
                        <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
                      </span>
                    )}
                    {urgent ? "Urgente" : "Normale"}
                  </span>
                  <ArrowRight size={14} className="text-ink-muted opacity-0 transition-all duration-200 group-hover/row:translate-x-0.5 group-hover/row:opacity-100" />
                </div>
              </Link>
            );
          })}
        </div>

        <Link
          href="/espace/plaintes"
          className="group/all mt-1 inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-body-sm font-label-md text-primary transition-colors hover:bg-primary-bg"
        >
          Voir toutes les plaintes
          <ArrowRight size={14} className="transition-transform duration-200 group-hover/all:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}

type QuickLink = { href: string; label: string; hint: string; icon: LucideIcon; accent: string };

const QUICK_LINKS: QuickLink[] = [
  { href: "/espace/relances", label: "Centre de relance des impayés", hint: "Relancer les retards de loyer", icon: BellRing, accent: "from-warning to-warning-strong" },
  { href: "/espace/journal", label: "Journal d'activité", hint: "Qui a fait quoi, et quand", icon: History, accent: "from-info to-primary" },
  { href: "/espace/comptabilite", label: "Comptabilité détaillée", hint: "Écritures, soldes et clôtures", icon: Wallet, accent: "from-success to-success-strong" },
];

/** Carte « Accès rapides » : tuiles à pastille dégradée, reflet au survol, flèche qui glisse, apparition en cascade. */
export function QuickAccessPanel() {
  return (
    <section className="panel-rise group/panel relative overflow-hidden rounded-2xl border border-info-border bg-surface shadow-sm transition-shadow duration-300 hover:shadow-lg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-info-bg to-transparent" />
      <header className="relative flex items-center gap-3 p-5 pb-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-info text-white shadow-md transition-transform duration-300 group-hover/panel:rotate-6 group-hover/panel:scale-105">
          <History size={20} />
        </span>
        <div>
          <h3 className="text-[16px] font-semibold leading-6 text-ink">Accès rapides</h3>
          <p className="text-body-xs text-ink-muted">Les autres vues transversales de votre espace.</p>
        </div>
      </header>
      <div className="stagger relative flex flex-col gap-2 px-5 pb-5">
        {QUICK_LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="sheen group/tile flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform duration-200 group-hover/tile:scale-110 group-hover/tile:-rotate-3", l.accent)}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-label-md text-ink">{l.label}</span>
                  <span className="block truncate text-body-xs text-ink-muted">{l.hint}</span>
                </span>
              </span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted transition-all duration-200 group-hover/tile:bg-primary group-hover/tile:text-white">
                <ArrowRight size={14} className="transition-transform duration-200 group-hover/tile:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

