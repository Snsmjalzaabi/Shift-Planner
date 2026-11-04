import { describe, expect, it } from "vitest";

import { listRosterFiles, parseScheduleLink, shareId } from "../sharepoint";

const HUC_LINK =
  "https://caregiverconnect.sharepoint.com/sites/collab-depts-NUR/CN/Clinical%20and%20Nursing%20Departmental%20Folders/Forms/AllItems.aspx?id=%2Fsites%2Fcollab%2Ddepts%2DNUR%2FCN%2FClinical%20and%20Nursing%20Departmental%20Folders%2FAcute%20and%20Critical%20Care%2FCritical%20Care%2FSchedules%2FHUC&viewid=1bda509a%2Db91d%2D4a80%2Dbf21%2D1ae5aa5e9259";

describe("schedule links", () => {
  it("reads the library and folder from a SharePoint folder page link", () => {
    expect(parseScheduleLink(HUC_LINK)).toEqual({
      kind: "library-folder",
      host: "caregiverconnect.sharepoint.com",
      libraryPath: "/sites/collab-depts-NUR/CN/Clinical and Nursing Departmental Folders",
      folderPath: "Acute and Critical Care/Critical Care/Schedules/HUC",
    });
  });

  it("treats Copy-link sharing links as Graph shares", () => {
    const link = "https://contoso.sharepoint.com/:f:/s/team/EabcDEF123?e=xyz";
    expect(parseScheduleLink(link)).toEqual({ kind: "share", url: link });
    expect(shareId("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1")).toBe(
      "u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx",
    );
  });

  it("rejects links that are not SharePoint or OneDrive", () => {
    expect(() => parseScheduleLink("https://example.com/roster.xlsx")).toThrow(/SharePoint or OneDrive/);
    expect(() => parseScheduleLink("not a link")).toThrow(/valid link/);
  });
});

function fakeGraph(routes: Record<string, unknown | number>) {
  const calls: string[] = [];
  const graph = async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const value = key === undefined ? 404 : routes[key];
    if (typeof value === "number") return new Response("{}", { status: value });
    return new Response(JSON.stringify(value), { status: 200 });
  };
  return { graph, calls };
}

describe("listing roster files", () => {
  const G = "https://graph.microsoft.com/v1.0";
  const routes = {
    [`${G}/sites/caregiverconnect.sharepoint.com:/sites/collab-depts-NUR/CN`]: { id: "site-cn" },
    [`${G}/sites/site-cn/drives`]: {
      value: [
        { id: "d-docs", name: "Documents", webUrl: "https://caregiverconnect.sharepoint.com/sites/collab-depts-NUR/CN/Shared%20Documents" },
        {
          id: "d-nur",
          name: "Clinical and Nursing Departmental Folders",
          webUrl: "https://caregiverconnect.sharepoint.com/sites/collab-depts-NUR/CN/Clinical%20and%20Nursing%20Departmental%20Folders",
        },
      ],
    },
    [`${G}/drives/d-nur/root:/Acute%20and%20Critical%20Care/Critical%20Care/Schedules/HUC:/children`]: {
      value: [
        { id: "1", name: "HUC Sep-Nov.xlsx", file: {}, lastModifiedDateTime: "2026-10-20T08:00:00Z", size: 1 },
        { id: "2", name: "HUC Nov-Dec.xlsx", file: {}, lastModifiedDateTime: "2026-11-02T08:00:00Z", size: 1 },
        { id: "3", name: "~$HUC Nov-Dec.xlsx", file: {}, lastModifiedDateTime: "2026-11-03T08:00:00Z", size: 1 },
        { id: "4", name: "Notes.docx", file: {}, lastModifiedDateTime: "2026-11-04T08:00:00Z", size: 1 },
        { id: "5", name: "Old 2025.xlsx", file: {}, lastModifiedDateTime: "2025-01-01T08:00:00Z", size: 1 },
        { id: "6", name: "Archive", folder: { childCount: 3 } },
        { id: "7", name: "Screenshot.png", file: {}, lastModifiedDateTime: "2026-10-01T08:00:00Z", size: 1 },
      ],
    },
  };

  it("finds the folder through its subsite and lists the newest rosters first", async () => {
    const { graph } = fakeGraph(routes);
    const files = await listRosterFiles(graph, HUC_LINK, { now: new Date("2026-11-05T00:00:00Z") });
    expect(files.map((f) => [f.name, f.kind, f.driveId])).toEqual([
      ["HUC Nov-Dec.xlsx", "xlsx", "d-nur"],
      ["HUC Sep-Nov.xlsx", "xlsx", "d-nur"],
      ["Screenshot.png", "image", "d-nur"],
    ]);
  });

  it("explains a missing permission instead of failing silently", async () => {
    const { graph } = fakeGraph({ ...routes, [`${G}/sites/site-cn/drives`]: 403 });
    await expect(listRosterFiles(graph, HUC_LINK)).rejects.toThrow(/does not have access/);
  });

  it("asks the user to sign in again when the session has expired", async () => {
    const { graph } = fakeGraph({ [`${G}/sites/`]: 401 });
    await expect(listRosterFiles(graph, HUC_LINK)).rejects.toMatchObject({ code: "signed-out" });
  });
});
