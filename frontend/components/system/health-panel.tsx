"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Check = {
  name: string;
  path: string;
  status: "idle" | "loading" | "ok" | "fail";
  detail?: string;
};

const INITIAL: Check[] = [
  { name: "API Express", path: "/api/health", status: "idle" },
  { name: "Base MySQL", path: "/api/health/db", status: "idle" },
];

export function HealthPanel() {
  const [checks, setChecks] = React.useState<Check[]>(INITIAL);
  const [ranAt, setRanAt] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setChecks((prev) => prev.map((c) => ({ ...c, status: "loading", detail: undefined })));
    const results = await Promise.all(
      INITIAL.map(async (c): Promise<Check> => {
        try {
          const res = await fetch(`${API_URL}${c.path}`, { cache: "no-store" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            return { ...c, status: "fail", detail: body.error || `HTTP ${res.status}` };
          }
          const detail =
            c.path === "/api/health/db"
              ? `${body.serverVersion ?? "?"} · ${body.database ?? "?"} · ${body.latencyMs ?? "?"} ms`
              : `v${body.version ?? "?"} · uptime ${body.uptimeSec ?? 0}s`;
          return { ...c, status: "ok", detail };
        } catch (err) {
          return {
            ...c,
            status: "fail",
            detail: err instanceof Error ? err.message : "réseau indisponible",
          };
        }
      }),
    );
    setChecks(results);
    setRanAt(new Date().toLocaleTimeString("fr-FR"));
  }, []);

  React.useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-body-xs text-ink-muted">
          Cible : <code className="text-ink-soft">{API_URL}</code>
        </p>
        <button
          type="button"
          onClick={run}
          className="font-label-sm text-primary hover:underline"
        >
          Relancer les tests
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {checks.map((c) => (
          <li key={c.path} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex flex-col">
              <span className="font-label-md text-ink">{c.name}</span>
              <span className="text-body-xs text-ink-muted">
                {c.detail ?? c.path}
              </span>
            </div>
            <Badge
              variant={
                c.status === "ok"
                  ? "success"
                  : c.status === "fail"
                    ? "danger"
                    : c.status === "loading"
                      ? "warning"
                      : "neutral"
              }
              dot
            >
              {c.status === "ok"
                ? "OK"
                : c.status === "fail"
                  ? "Échec"
                  : c.status === "loading"
                    ? "Test…"
                    : "En attente"}
            </Badge>
          </li>
        ))}
      </ul>

      {ranAt && (
        <p className={cn("text-body-xs text-ink-muted")}>Dernière vérification : {ranAt}</p>
      )}
    </div>
  );
}
