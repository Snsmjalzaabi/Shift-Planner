// Reads roster files from a SharePoint / OneDrive folder through Microsoft
// Graph, signed in as the user (delegated access). The user only ever gets
// files their own work account can already open. Pure TypeScript: the HTTP
// call is injected, so it is unit-tested without a network.

export type GraphFetch = (url: string) => Promise<Response>;

export type RosterFile = {
  id: string;
  driveId: string;
  name: string;
  modified: string;
  size: number;
  kind: "xlsx" | "image";
};

export type ParsedLink =
  | {
      kind: "library-folder";
      host: string;
      /** Server-relative path of the document library, e.g. /sites/x/CN/Shared Documents */
      libraryPath: string;
      /** Folder inside the library, e.g. Acute and Critical Care/Critical Care/Schedules/HUC */
      folderPath: string;
    }
  | { kind: "share"; url: string };

export class ScheduleLinkError extends Error {
  constructor(
    message: string,
    public code: "invalid-link" | "not-found" | "no-access" | "signed-out" | "empty" | "network",
  ) {
    super(message);
  }
}

const GRAPH = "https://graph.microsoft.com/v1.0";

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Understands the two kinds of links people copy from SharePoint:
 * - the folder page in a document library (…/Forms/AllItems.aspx?id=/sites/…/HUC)
 * - a "Copy link" sharing link (…/:f:/s/…, …/:x:/r/…) or a direct file/folder URL
 */
export function parseScheduleLink(raw: string): ParsedLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ScheduleLinkError("That is not a valid link. Copy the folder link from SharePoint and paste it here.", "invalid-link");
  }
  if (url.protocol !== "https:" || !/\.(sharepoint\.com|sharepoint\.us|onedrive\.com|1drv\.ms)$/i.test(url.hostname)) {
    throw new ScheduleLinkError("Only SharePoint or OneDrive links are supported.", "invalid-link");
  }
  const id = url.searchParams.get("id") ?? url.searchParams.get("RootFolder");
  const formsIndex = url.pathname.toLowerCase().indexOf("/forms/");
  if (id && formsIndex > 0) {
    const libraryPath = decodeURIComponent(url.pathname.slice(0, formsIndex));
    const folder = decodeURIComponent(id);
    if (!folder.toLowerCase().startsWith(libraryPath.toLowerCase())) {
      throw new ScheduleLinkError("The folder in this link is not inside its document library.", "invalid-link");
    }
    return {
      kind: "library-folder",
      host: url.hostname,
      libraryPath,
      folderPath: trimSlashes(folder.slice(libraryPath.length)),
    };
  }
  return { kind: "share", url: url.toString() };
}

/** Graph "shares" id for a URL: u! + base64url(url). */
export function shareId(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return `u!${b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function getJson<T>(graph: GraphFetch, url: string): Promise<T> {
  let res: Response;
  try {
    res = await graph(url);
  } catch {
    throw new ScheduleLinkError("Could not reach Microsoft. Check your connection and try again.", "network");
  }
  if (res.status === 401) throw new ScheduleLinkError("Your work account session has ended. Sign in again.", "signed-out");
  if (res.status === 403)
    throw new ScheduleLinkError("Your work account does not have access to this folder.", "no-access");
  if (res.status === 404) throw new ScheduleLinkError("The folder in this link was not found.", "not-found");
  if (!res.ok) throw new ScheduleLinkError(`Microsoft returned an error (${res.status}).`, "network");
  return (await res.json()) as T;
}

type DriveItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
  webUrl?: string;
};

function rosterKind(item: DriveItem): RosterFile["kind"] | null {
  const name = item.name.toLowerCase();
  if (!item.file) return null;
  if (name.startsWith("~$")) return null; // Excel lock files
  if (name.endsWith(".xlsx")) return "xlsx";
  if (/\.(png|jpe?g)$/.test(name)) return "image";
  return null;
}

/** Locate the drive + folder for a parsed link. */
async function resolveFolder(graph: GraphFetch, link: ParsedLink): Promise<{ driveId: string; items: DriveItem[] }> {
  if (link.kind === "share") {
    const item = await getJson<DriveItem & { children?: DriveItem[] }>(
      graph,
      `${GRAPH}/shares/${shareId(link.url)}/driveItem?$expand=children`,
    );
    const driveId = item.parentReference?.driveId ?? "";
    // A link to one file is a folder of one.
    return { driveId, items: item.folder ? (item.children ?? []) : [item] };
  }
  // The library sits in a site or a subsite: try the longest site path first.
  const segments = trimSlashes(link.libraryPath).split("/");
  const libraryName = segments[segments.length - 1];
  let site: { id: string } | null = null;
  for (let end = segments.length - 1; end >= 2 && !site; end -= 1) {
    const sitePath = "/" + segments.slice(0, end).join("/");
    try {
      site = await getJson<{ id: string }>(graph, `${GRAPH}/sites/${link.host}:/${encodePath(sitePath)}`);
    } catch (error) {
      if (!(error instanceof ScheduleLinkError) || error.code !== "not-found") throw error;
    }
  }
  if (!site) throw new ScheduleLinkError("The SharePoint site in this link was not found.", "not-found");
  const drives = await getJson<{ value: { id: string; name: string; webUrl: string }[] }>(
    graph,
    `${GRAPH}/sites/${site.id}/drives?$select=id,name,webUrl`,
  );
  const wanted = link.libraryPath.toLowerCase();
  const drive =
    drives.value.find((d) => decodeURIComponent(new URL(d.webUrl).pathname).toLowerCase() === wanted) ??
    drives.value.find((d) => d.name.toLowerCase() === libraryName.toLowerCase());
  if (!drive) throw new ScheduleLinkError("The document library in this link was not found.", "not-found");
  const path = link.folderPath ? `root:/${encodePath(link.folderPath)}:` : "root";
  const children = await getJson<{ value: DriveItem[] }>(
    graph,
    `${GRAPH}/drives/${drive.id}/${path}/children?$top=200&$select=id,name,size,lastModifiedDateTime,file,folder,parentReference`,
  );
  return { driveId: drive.id, items: children.value };
}

/**
 * Newest roster files in the folder (Excel first-class, images supported).
 * Rosters are posted ahead of time, so the latest few files cover the current
 * and the next period; files untouched for months are ignored.
 */
export async function listRosterFiles(
  graph: GraphFetch,
  rawLink: string,
  options: { max?: number; maxAgeDays?: number; now?: Date } = {},
): Promise<RosterFile[]> {
  const { max = 3, maxAgeDays = 120, now = new Date() } = options;
  const { driveId, items } = await resolveFolder(graph, parseScheduleLink(rawLink));
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const files = items
    .map((item) => ({ item, kind: rosterKind(item) }))
    .filter((x): x is { item: DriveItem; kind: RosterFile["kind"] } => !!x.kind)
    .map(({ item, kind }) => ({
      id: item.id,
      driveId: item.parentReference?.driveId ?? driveId,
      name: item.name,
      modified: item.lastModifiedDateTime ?? "",
      size: item.size ?? 0,
      kind,
    }))
    .filter((f) => !f.modified || Date.parse(f.modified) >= cutoff)
    .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0))
    .slice(0, max);
  if (!files.length)
    throw new ScheduleLinkError("No Excel or image rosters were found in this folder.", "empty");
  return files;
}

export async function downloadRosterFile(graph: GraphFetch, file: RosterFile): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await graph(`${GRAPH}/drives/${file.driveId}/items/${file.id}/content`);
  } catch {
    throw new ScheduleLinkError("Could not download the roster. Check your connection.", "network");
  }
  if (res.status === 401) throw new ScheduleLinkError("Your work account session has ended. Sign in again.", "signed-out");
  if (!res.ok) throw new ScheduleLinkError(`Could not download ${file.name} (${res.status}).`, "network");
  return res.arrayBuffer();
}
