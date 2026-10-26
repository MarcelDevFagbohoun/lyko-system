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

export type NoteSheet = {
  content: string;
  /** 0 = fiche jamais enregistrée. À renvoyer tel quel à l'enregistrement (détection des modifications simultanées). */
  version: number;
  updatedAt: string | null;
  updatedBy: Actor;
};
export type SheetEntityType = "renter" | "owner";

export function getNoteSheet(accessToken: string, entityType: SheetEntityType, entityId: number) {
  return apiFetch<{ sheet: NoteSheet; legacyNotes: EntityNote[] }>(`/api/notes/sheet?entityType=${entityType}&entityId=${entityId}`, { accessToken });
}
export function saveNoteSheet(accessToken: string, entityType: SheetEntityType, entityId: number, content: string, version: number) {
  return apiFetch<{ sheet: NoteSheet }>("/api/notes/sheet", {
    method: "PUT",
    accessToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType, entityId, content, version }),
  });
}
/** Fiche courante renvoyée par le serveur quand l'enregistrement est refusé parce que quelqu'un d'autre a écrit entre-temps. */
export function conflictSheet(err: unknown): NoteSheet | null {
  const d = (err as { status?: number; details?: unknown })?.details as { sheet?: NoteSheet } | undefined;
  return (err as { status?: number })?.status === 409 && d?.sheet ? d.sheet : null;
}
