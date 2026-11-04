import { describe, expect, it } from "vitest";

import { CalendarShift, ImportApi, importKey } from "../importPlan";
import { syncSchedule, SyncDeps } from "../scheduleSync";
import { RosterFile } from "../sharepoint";
import { createSheetGridSource } from "../sheetSource";

const d = (day: number) => new Date(Date.UTC(2026, 10, day));
const header = ["Name", d(1), d(2), d(3), d(4)];

function sheet(rows: unknown[][]) {
  return createSheetGridSource([header, ...rows], "November 2026");
}

function calendar(initial: CalendarShift[] = []) {
  const shifts = [...initial];
  let n = 1;
  const api: ImportApi = {
    async create(body) {
      const s = { id: `s${n++}`, date: body.date, type: body.type, code: body.code, import_key: body.import_key };
      shifts.push(s);
      return s;
    },
    async update(id, body) {
      const s = shifts.find((x) => x.id === id)!;
      Object.assign(s, body);
      return s;
    },
  };
  return { shifts, api };
}

function deps(files: { file: RosterFile; rows: unknown[][] | null }[], cal: ReturnType<typeof calendar>): SyncDeps {
  return {
    listFiles: async () => files.map((f) => f.file),
    readFile: async (file) => {
      const rows = files.find((f) => f.file.id === file.id)!.rows;
      return rows ? [sheet(rows)] : null;
    },
    fetchExisting: async (months) => cal.shifts.filter((s) => months.includes(s.date.slice(0, 7))),
    api: cal.api,
    fallbackMonth: { year: 2026, month: 11 },
  };
}

const file = (id: string, modified: string): RosterFile => ({
  id,
  driveId: "d",
  name: `${id}.xlsx`,
  modified,
  size: 1,
  kind: "xlsx",
});

describe("daily schedule sync", () => {
  it("finds the user's row by account name and imports only that row", async () => {
    const cal = calendar();
    const result = await syncSchedule(
      deps([{ file: file("a", "2026-11-01"), rows: [["Omar Haddad", "N", "N", "X", "D"], ["Sultan Al Zaabi", "D", "", "XL", "AL"]] }], cal),
      { employeeName: null, displayName: "Sultan" },
    );
    expect(result).toMatchObject({ status: "synced", employeeName: "Sultan Al Zaabi", added: 3 });
    expect(cal.shifts.map((s) => [s.date, s.code])).toEqual([
      ["2026-11-01", "D"],
      ["2026-11-03", "XL"],
      ["2026-11-04", "AL"],
    ]);
  });

  it("running again changes nothing, and a roster change updates only that day", async () => {
    const cal = calendar();
    const input = { employeeName: "Sultan Al Zaabi", displayName: null };
    await syncSchedule(deps([{ file: file("a", "1"), rows: [["Sultan Al Zaabi", "D", "", "XL", "AL"]] }], cal), input);
    const again = await syncSchedule(deps([{ file: file("a", "1"), rows: [["Sultan Al Zaabi", "D", "", "XL", "AL"]] }], cal), input);
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    const changed = await syncSchedule(deps([{ file: file("a", "2"), rows: [["Sultan Al Zaabi", "N", "", "XL", "AL"]] }], cal), input);
    expect(changed).toMatchObject({ added: 0, updated: 1, unchanged: 2 });
    expect(cal.shifts).toHaveLength(3);
    expect(cal.shifts.find((s) => s.date === "2026-11-01")).toMatchObject({ code: "N", type: "night" });
  });

  it("never changes a shift the user entered by hand", async () => {
    const cal = calendar([{ id: "mine", date: "2026-11-01", type: "on_call", code: null, import_key: null }]);
    const result = await syncSchedule(
      deps([{ file: file("a", "1"), rows: [["Sultan Al Zaabi", "D", "", "", ""]] }], cal),
      { employeeName: "Sultan Al Zaabi", displayName: null },
    );
    expect(result).toMatchObject({ kept: 1, added: 0, updated: 0 });
    expect(cal.shifts).toEqual([{ id: "mine", date: "2026-11-01", type: "on_call", code: null, import_key: null }]);
  });

  it("the newest file wins for dates that appear in two rosters", async () => {
    const cal = calendar();
    const result = await syncSchedule(
      deps(
        [
          { file: file("new", "2026-11-03"), rows: [["Sultan Al Zaabi", "N", "", "", ""]] },
          { file: file("old", "2026-10-01"), rows: [["Sultan Al Zaabi", "D", "D", "", ""]] },
        ],
        cal,
      ),
      { employeeName: "Sultan Al Zaabi", displayName: null },
    );
    expect(result.added).toBe(2);
    expect(cal.shifts.map((s) => [s.date, s.code])).toEqual([
      ["2026-11-01", "N"],
      ["2026-11-02", "D"],
    ]);
  });

  it("does not save unrecognised codes; returns them for review", async () => {
    const cal = calendar();
    const result = await syncSchedule(
      deps([{ file: file("a", "1"), rows: [["Sultan Al Zaabi", "D", "SL", "", ""]] }], cal),
      { employeeName: "Sultan Al Zaabi", displayName: null },
    );
    expect(result.added).toBe(1);
    expect(result.needsReview).toEqual([expect.objectContaining({ date: "2026-11-02", raw: "SL" })]);
    expect(cal.shifts.map((s) => s.date)).toEqual(["2026-11-01"]);
  });

  it("asks the user to pick their row when no name matches", async () => {
    const cal = calendar();
    const result = await syncSchedule(
      deps([{ file: file("a", "1"), rows: [["Omar Haddad", "N", "", "", ""]] }], cal),
      { employeeName: null, displayName: "Sultan" },
    );
    expect(result).toMatchObject({ status: "needs-employee", employees: ["Omar Haddad"], added: 0 });
    expect(cal.shifts).toHaveLength(0);
  });

  it("uses the confirmed name as identity, so a misread name cannot duplicate shifts", async () => {
    const cal = calendar();
    await syncSchedule(deps([{ file: file("a", "1"), rows: [["Sultan Al Zaabi", "D", "", "", ""]] }], cal), {
      employeeName: "Sultan Al Zaabi",
      displayName: null,
    });
    const again = await syncSchedule(deps([{ file: file("a", "2"), rows: [["Sultan Al Zaabl", "D", "", "", ""]] }], cal), {
      employeeName: "Sultan Al Zaabi",
      displayName: null,
    });
    expect(again).toMatchObject({ status: "synced", unchanged: 1, added: 0 });
    expect(cal.shifts[0].import_key).toBe(importKey("Sultan Al Zaabi", "2026-11-01"));
  });

  it("skips files that cannot be read here (images during background sync)", async () => {
    const cal = calendar();
    const result = await syncSchedule(
      deps(
        [
          { file: { ...file("img", "2026-11-04"), kind: "image" }, rows: null },
          { file: file("x", "2026-11-01"), rows: [["Sultan Al Zaabi", "D", "", "", ""]] },
        ],
        cal,
      ),
      { employeeName: "Sultan Al Zaabi", displayName: null },
    );
    expect(result.files.map((f) => f.read)).toEqual([false, true]);
    expect(result.added).toBe(1);
  });
});
