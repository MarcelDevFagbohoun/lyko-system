"use client";

import { useAuth } from "@/lib/auth/auth-context";

/**
 * Vrai si l'utilisateur est la direction ou possède la permission donnée.
 * Sert à masquer les boutons d'opérations financières ; le serveur reste l'autorité (il refuse sans la permission).
 */
export function useCan(key: string): boolean {
  const { user } = useAuth();
  return !!user && (user.role === "dg" || user.permissions.includes(key));
}
