"use client";

import * as React from "react";
import { getMe, loginAccount, registerAccount, type Account, type RegisterInput } from "@/lib/api/accounts";

const STORAGE_KEY = "quick-immo:accessToken";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  account: Account | null;
  accessToken: string | null;
  status: AuthStatus;
};

type AuthContextValue = AuthState & {
  login: (phone: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

/**
 * Comptes Quick Immo (grand public) — un seul jeton en `localStorage`, PAS
 * de refresh token httpOnly comme les employés Lyko System : pas d'enjeu
 * financier/sensible comparable, une session longue (30j côté serveur,
 * `utils/jwt.js` signMarketplaceToken) simplifie ce client public.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ account: null, accessToken: null, status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    const token = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!token) {
      setState({ account: null, accessToken: null, status: "unauthenticated" });
      return;
    }
    getMe(token)
      .then((res) => {
        if (!cancelled) setState({ account: res.account, accessToken: token, status: "authenticated" });
      })
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        if (!cancelled) setState({ account: null, accessToken: null, status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (phone: string, password: string) => {
    const res = await loginAccount(phone, password);
    window.localStorage.setItem(STORAGE_KEY, res.accessToken);
    setState({ account: res.account, accessToken: res.accessToken, status: "authenticated" });
  }, []);

  const register = React.useCallback(async (input: RegisterInput) => {
    const res = await registerAccount(input);
    window.localStorage.setItem(STORAGE_KEY, res.accessToken);
    setState({ account: res.account, accessToken: res.accessToken, status: "authenticated" });
  }, []);

  const logout = React.useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ account: null, accessToken: null, status: "unauthenticated" });
  }, []);

  const value = React.useMemo(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
