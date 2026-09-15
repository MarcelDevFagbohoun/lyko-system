import { apiFetch, TENANT_ID } from "./client";

export type AccountRole = "chercheur" | "proprietaire";

export type Account = {
  id: number;
  role: AccountRole;
  firstName: string;
  lastName: string;
  phone: string;
};

export type RegisterInput = {
  role: AccountRole;
  firstName: string;
  lastName: string;
  phone: string;
  password: string;
};

export function registerAccount(input: RegisterInput) {
  return apiFetch<{ account: Account; accessToken: string }>("/api/marketplace-accounts/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: TENANT_ID, ...input }),
  });
}

export function loginAccount(phone: string, password: string) {
  return apiFetch<{ account: Account; accessToken: string }>("/api/marketplace-accounts/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: TENANT_ID, phone, password }),
  });
}

export function getMe(accessToken: string) {
  return apiFetch<{ account: Account }>("/api/marketplace-accounts/me", { accessToken });
}

export type RequestType = "louer" | "vendre";
export type RequestStatus = "en_attente" | "contactee" | "acceptee" | "refusee";

export type OwnerRequest = {
  id: number;
  requestType: RequestType;
  address: string;
  description: string | null;
  status: RequestStatus;
  createdAt: string;
};

export function submitRequest(
  accessToken: string,
  input: { requestType: RequestType; address: string; description?: string },
) {
  return apiFetch<{ requestId: number }>("/api/marketplace-accounts/requests", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function listMyRequests(accessToken: string) {
  return apiFetch<{ requests: OwnerRequest[] }>("/api/marketplace-accounts/requests/mine", { accessToken });
}

export type FavoriteListing = {
  unitId: number;
  unitCode: string;
  designation: string;
  designationCustom: string | null;
  monthlyRent: number;
  furnished: boolean;
  stillAvailable: boolean;
  propertyCode: string;
  address: string | null;
  propertyType: string;
  description: string | null;
  photoUrls: string[];
};

export function listFavorites(accessToken: string) {
  return apiFetch<{ favorites: FavoriteListing[] }>("/api/marketplace-accounts/favorites", { accessToken });
}

export function addFavorite(accessToken: string, unitId: number) {
  return apiFetch<{ ok: true }>(`/api/marketplace-accounts/favorites/${unitId}`, {
    method: "POST",
    accessToken,
  });
}

export function removeFavorite(accessToken: string, unitId: number) {
  return apiFetch<void>(`/api/marketplace-accounts/favorites/${unitId}`, {
    method: "DELETE",
    accessToken,
  });
}
