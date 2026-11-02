/**
 * Encodage des photos jointes à une plainte pour la file hors-ligne (étape 11,
 * extension). Le `body` de la file est stocké en JSON chiffré (voir
 * `crypto.ts` — `JSON.stringify` ne peut pas sérialiser un `File`/`Blob`) :
 * chaque photo est donc encodée en base64 avant d'entrer dans la file, et
 * reconstruite en `File` juste avant l'envoi réseau (voir `queue.ts`).
 *
 * Limite assumée : une photo encodée pèse ~33 % de plus qu'un fichier binaire
 * et plusieurs photos de plusieurs mégapixels peuvent remplir le quota
 * IndexedDB sur un vieux téléphone — pas de compression ici, volontairement
 * simple ; à revoir si ça devient un problème réel en usage terrain.
 */

export type EncodedFile = { name: string; type: string; dataBase64: string };

export async function encodeFileToBase64(file: File): Promise<EncodedFile> {
  const buf = await file.arrayBuffer();
  let binary = "";
  new Uint8Array(buf).forEach((b) => (binary += String.fromCharCode(b)));
  return { name: file.name, type: file.type, dataBase64: btoa(binary) };
}

export function decodeBase64ToFile(encoded: EncodedFile): File {
  const binary = atob(encoded.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], encoded.name, { type: encoded.type });
}
