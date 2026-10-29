import * as React from "react";
import { compact, monthLabel } from "@/lib/chart-utils";
import { formatFcfa } from "@/lib/utils";

export type CumulDaily = { currentMonth: string; previousMonth: string; today: number; daysInCurrent: number; daysInPrevious: number; current: number[]; previous: number[] };

/** Courbes cumulées jour par jour : mois en cours (s'arrête à aujourd'hui) contre mois précédent complet. SVG à échelle fluide. */
export function CumulLines({ daily, testId = "stats-line" }: { daily: CumulDaily; testId?: string }) {
  const W = 600; const H = 240; const L = 56; const R = 12; const T = 12; const B = 34;
  const days = Math.max(daily.daysInCurrent, daily.daysInPrevious);
  const max = Math.max(1, ...daily.current, ...daily.previous);
  const x = (d: number) => L + ((d - 1) / Math.max(1, days - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [1, 8, 15, 22, days].filter((d, i, a) => a.indexOf(d) === i);
  const yTicks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const last = daily.current[daily.current.length - 1] ?? 0;
  const samePrev = daily.previous[Math.min(daily.today, daily.previous.length) - 1] ?? 0;
  const diff = samePrev === 0 ? null : Math.round(((last - samePrev) / samePrev) * 100);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-ink-soft">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-primary" />{monthLabel(daily.currentMonth)} : {formatFcfa(last)}</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded border-t-2 border-dashed border-ink-faint" />{monthLabel(daily.previousMonth)} : {formatFcfa(daily.previous[daily.previous.length - 1] ?? 0)} au total</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Cumul : ${formatFcfa(last)} au ${daily.today} du mois, contre ${formatFcfa(samePrev)} à la même date le mois précédent`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-ink-muted" fontSize="15">{compact(v)}</text>
          </g>
        ))}
        {ticks.map((d) => <text key={d} x={x(d)} y={H - 10} textAnchor="middle" className="fill-ink-muted" fontSize="15">{d}</text>)}
        <path d={path(daily.previous)} fill="none" className="stroke-ink-faint" strokeWidth="2" strokeDasharray="5 4" />
        <path d={path(daily.current)} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" />
        {daily.current.length > 0 && <circle cx={x(daily.current.length)} cy={y(last)} r="4" className="fill-primary" />}
      </svg>
      <p className="text-body-sm text-ink-soft">
        Au {daily.today} du mois : <strong className="text-ink">{formatFcfa(last)}</strong>, contre {formatFcfa(samePrev)} à la même date le mois précédent
        {diff === null ? "." : ` (${diff > 0 ? "+" : ""}${diff} %).`}
      </p>
    </div>
  );
}
