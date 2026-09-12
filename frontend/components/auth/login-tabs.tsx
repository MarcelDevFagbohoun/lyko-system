"use client";

import * as React from "react";
import { ShieldCheck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginForm } from "./login-form";
import { EmployeeLoginForm } from "./employee-login-form";

type Mode = "admin" | "employe";

/** Bascule entre les deux portes de connexion : Direction (admin) et Employé. */
export function LoginTabs() {
  const [mode, setMode] = React.useState<Mode>("admin");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1 rounded-lg bg-surface-muted p-1">
        <button
          type="button"
          onClick={() => setMode("admin")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 font-label-md transition-colors",
            mode === "admin" ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          <ShieldCheck size={16} />
          Direction
        </button>
        <button
          type="button"
          onClick={() => setMode("employe")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 font-label-md transition-colors",
            mode === "employe" ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          <UserRound size={16} />
          Employé
        </button>
      </div>

      {mode === "admin" ? <LoginForm /> : <EmployeeLoginForm />}
    </div>
  );
}
