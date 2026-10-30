"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus } from "@/lib/api/planning";

export const STATUS_LABEL: Record<TaskStatus, string> = { a_faire: "À faire", en_cours: "En cours", termine: "Terminé" };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { basse: "Basse", normale: "Normale", haute: "Haute" };
export const PRIORITY_DOT: Record<TaskPriority, string> = { basse: "bg-slate-400", normale: "bg-sky-500", haute: "bg-red-500" };
export const STATUS_CHIP: Record<TaskStatus, string> = {
  a_faire: "bg-slate-100 text-slate-700 border-slate-200",
  en_cours: "bg-amber-50 text-amber-800 border-amber-200",
  termine: "bg-emerald-50 text-emerald-800 border-emerald-200 line-through opacity-80",
};

const TZ = "Africa/Porto-Novo";
/** Aujourd'hui (heure du Bénin) au format AAAA-MM-JJ. */
export const todayBenin = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());

export function fmtDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
}

export function isOverdue(due: string | null, status: TaskStatus) {
  return !!due && status !== "termine" && due < todayBenin();
}

/** Fenêtre modale : feuille en bas sur mobile, boîte centrée sur ordinateur. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export const selectCls = "flex h-[38px] w-full rounded border border-border-strong bg-surface px-2 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
export const areaCls = "w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const tone = value >= 100 ? "bg-emerald-500" : value >= 50 ? "bg-sky-500" : "bg-amber-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
