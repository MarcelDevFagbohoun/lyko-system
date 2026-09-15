"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api/client";

export type AuthUser = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  identifier: string | null;
  email: string | null;
  role: "dg" | "comptable" | "agent";
  mustChangePassword: boolean;
  permissions: string[];
};

export type AuthTenant = {
  id: number;
  companyName: string;
  rccm: string;
  ifu: string;
  contactPhone: string;
  logoUrl: string | null;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  accessToken: string | null;
  status: AuthStatus;
};

type AuthContextValue = AuthState & {
  login: (phone: string, password: string) => Promise<void>;
  loginEmployee: (identifier: string, role: "comptable" | "agent", password: string) => Promise<void>;
  register: (formData: FormData) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string, confirmNewPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

const INITIAL_STATE: AuthState = { user: null, tenant: null, accessToken: null, status: "loading" };

/**
 * Session d'authentification (étapes 2 et 3). L'access token vit en mémoire
 * (jamais localStorage) ; le refresh token est un cookie httpOnly géré par
 * le backend. Au chargement, on tente un /refresh silencieux pour
 * restaurer la session (« retrouve son espace avec son logo »).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>(INITIAL_STATE);
  const accessTokenRef = React.useRef<string | null>(null);
  accessTokenRef.current = state.accessToken;

  React.useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const { accessToken } = await apiFetch<{ accessToken: string }>("/api/auth/refresh", {
          method: "POST",
        });
        const me = await apiFetch<{ user: AuthUser; tenant: AuthTenant }>("/api/auth/me", {
          accessToken,
        });
        if (!cancelled) {
          setState({ user: me.user, tenant: me.tenant, accessToken, status: "authenticated" });
        }
      } catch {
        if (!cancelled) setState({ user: null, tenant: null, accessToken: null, status: "unauthenticated" });
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (phone: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser; tenant: AuthTenant; accessToken: string }>(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      },
    );
    setState({ user: res.user, tenant: res.tenant, accessToken: res.accessToken, status: "authenticated" });
  }, []);

  const loginEmployee = React.useCallback(
    async (identifier: string, role: "comptable" | "agent", password: string) => {
      const res = await apiFetch<{ user: AuthUser; tenant: AuthTenant; accessToken: string }>(
        "/api/auth/login-employee",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, role, password }),
        },
      );
      setState({ user: res.user, tenant: res.tenant, accessToken: res.accessToken, status: "authenticated" });
    },
    [],
  );

  const register = React.useCallback(async (formData: FormData) => {
    const res = await apiFetch<{ user: AuthUser; tenant: AuthTenant; accessToken: string }>(
      "/api/auth/register",
      { method: "POST", body: formData },
    );
    setState({ user: res.user, tenant: res.tenant, accessToken: res.accessToken, status: "authenticated" });
  }, []);

  const logout = React.useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setState({ user: null, tenant: null, accessToken: null, status: "unauthenticated" });
    // Poste potentiellement partagé entre employés : le cache hors-ligne
    // (étape 11) ne doit jamais rester consultable par la session suivante.
    // L'appelant (EspaceSidebar) est responsable d'avertir si des actions de
    // la file d'attente ne sont pas encore synchronisées avant d'appeler ceci.
    const { clearOfflineData } = await import("@/lib/offline/db");
    await clearOfflineData();
  }, []);

  const refreshUser = React.useCallback(async () => {
    const accessToken = accessTokenRef.current;
    if (!accessToken) return;
    const me = await apiFetch<{ user: AuthUser; tenant: AuthTenant }>("/api/auth/me", { accessToken });
    setState((s) => ({ ...s, user: me.user, tenant: me.tenant }));
  }, []);

  const changePassword = React.useCallback(
    async (currentPassword: string, newPassword: string, confirmNewPassword: string) => {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        accessToken: accessTokenRef.current ?? undefined,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });
      await refreshUser();
    },
    [refreshUser],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ ...state, login, loginEmployee, register, logout, changePassword, refreshUser }),
    [state, login, loginEmployee, register, logout, changePassword, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return ctx;
}
