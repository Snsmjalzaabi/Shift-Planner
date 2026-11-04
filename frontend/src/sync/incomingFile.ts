// A roster file opened into Foxory from another app ("Open in Foxory" /
// "Open with"). The router hands it over here and the Import screen picks it up.

export type IncomingFile = { uri: string; name: string; kind: "xlsx" | "image" };

let pending: IncomingFile | null = null;
const listeners = new Set<(file: IncomingFile) => void>();

export function incomingKind(uri: string): IncomingFile["kind"] | null {
  const lower = decodeURIComponent(uri).toLowerCase().split("?")[0];
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (/\.(png|jpe?g)$/.test(lower)) return "image";
  // Android content:// URIs often carry no extension; let the Import screen
  // try it as a spreadsheet first, then as an image.
  if (lower.startsWith("content://")) return "xlsx";
  return null;
}

export function receiveFile(uri: string): boolean {
  const kind = incomingKind(uri);
  if (!kind) return false;
  const name = decodeURIComponent(uri.split("/").pop() ?? "Roster").split("?")[0] || "Roster";
  pending = { uri, name, kind };
  for (const listener of listeners) listener(pending);
  return true;
}

/** Take (and clear) the pending file, if any. */
export function takeIncomingFile(): IncomingFile | null {
  const file = pending;
  pending = null;
  return file;
}

export function onIncomingFile(listener: (file: IncomingFile) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
