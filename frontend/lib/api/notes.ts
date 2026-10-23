import { apiFetch, type Actor } from "@/lib/api/client";

export type NoteEntityType = "renter" | "owner" | "property";
export type EntityNote = { id: number; body: string; createdAt: string; author: Actor };

export function listNotes(accessToken: string, entityType: NoteEntityType, entityId: number) {
  return apiFetch<{ notes: EntityNote[] }>(`/api/notes?entityType=${entityType}&entityId=${entityId}`, { accessToken });
}
export function addNote(accessToken: string, entityType: NoteEntityType, entityId: number, body: string) {
  return apiFetch<{ notes: EntityNote[] }>("/api/notes", {
    method: "POST",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType, entityId, body }),
  });
}
