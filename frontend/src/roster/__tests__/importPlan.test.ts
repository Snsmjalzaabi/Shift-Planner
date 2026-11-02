import { describe, expect, it } from "vitest";

import { applyImport, CalendarShift, ImportApi, ImportItem, importKey, planImport } from "../importPlan";

/** In-memory calendar that behaves like the backend (unique import_key per user). */
function fakeCalendar(initial: CalendarShift[] = []) {
  const shifts = [...initial];
  let next = 1;
  const api: ImportApi = {
    async create(body) {
      const dup = shifts.find((s) => s.import_key === body.import_key);
      if (dup) return dup;
      const shift = { id: `s${next++}`, date: body.date, type: body.type, code: body.code, import_key: body.import_key };
      shifts.push(shift);
      return shift;
    },
    async update(id, body) {
      const shift = shifts.find((s) => s.id === id)!;
      Object.assign(shift, body);
      return shift;
    },
  };
  return { shifts, api };
}

const ROSTER: ImportItem[] = [
  { date: "2026-11-01", code: "N" },
  { date: "2026-11-02", code: "X" },
  { date: "2026-11-03", code: "XL" },
  { date: "2026-11-04", code: "AL" },
];

describe("idempotent roster import", () => {
  it("creates each assignment once with its code preserved", async () => {
    const cal = fakeCalendar();
    const result = await applyImport(planImport("Aisha Rahman", ROSTER, cal.shifts), {}, cal.api, "roster-image");
    expect(result.created).toBe(4);
    expect(cal.shifts.map((s) => [s.date, s.code, s.type])).toEqual([
      ["2026-11-01", "N", "night"],
      ["2026-11-02", "X", "off"],
      ["2026-11-03", "XL", "off"],
      ["2026-11-04", "AL", "off"],
    ]);
  });

  it("re-importing the same roster creates nothing new", async () => {
    const cal = fakeCalendar();
    await applyImport(planImport("Aisha Rahman", ROSTER, cal.shifts), {}, cal.api, "roster-image");
    const plan = planImport("Aisha Rahman", ROSTER, cal.shifts);
    expect(plan.every((a) => a.kind === "unchanged")).toBe(true);
    const again = await applyImport(plan, {}, cal.api, "roster-image");
    expect(again).toMatchObject({ created: 0, unchanged: 4 });
    expect(cal.shifts).toHaveLength(4);
  });

  it("asks before changing a date that already has an entry, and keeps it by default", async () => {
    const manual: CalendarShift = { id: "m1", date: "2026-11-02", type: "day", code: null, import_key: null };
    const cal = fakeCalendar([manual]);
    const plan = planImport("Aisha Rahman", ROSTER, cal.shifts);
    expect(plan[1].kind).toBe("conflict");
    const result = await applyImport(plan, {}, cal.api, "roster-image");
    expect(result).toMatchObject({ created: 3, kept: 1, replaced: 0 });
    expect(cal.shifts.find((s) => s.id === "m1")).toMatchObject({ type: "day", code: null });
  });

  it("replaces only when the user chooses to", async () => {
    const manual: CalendarShift = { id: "m1", date: "2026-11-02", type: "day", code: null, import_key: null };
    const cal = fakeCalendar([manual]);
    const plan = planImport("Aisha Rahman", ROSTER, cal.shifts);
    const result = await applyImport(plan, { "2026-11-02": "replace" }, cal.api, "roster-image");
    expect(result.replaced).toBe(1);
    expect(cal.shifts.filter((s) => s.date === "2026-11-02")).toHaveLength(1);
    expect(cal.shifts.find((s) => s.id === "m1")).toMatchObject({ code: "X", import_key: importKey("Aisha Rahman", "2026-11-02") });
  });

  it("an updated roster shows changed codes as conflicts against the earlier import", async () => {
    const cal = fakeCalendar();
    await applyImport(planImport("Aisha Rahman", ROSTER, cal.shifts), {}, cal.api, "roster-image");
    const updated = ROSTER.map((r) => (r.date === "2026-11-01" ? { ...r, code: "D" } : r));
    const plan = planImport("Aisha Rahman", updated, cal.shifts);
    expect(plan.map((a) => a.kind)).toEqual(["conflict", "unchanged", "unchanged", "unchanged"]);
    await applyImport(plan, { "2026-11-01": "replace" }, cal.api, "roster-image");
    expect(cal.shifts.filter((s) => s.date === "2026-11-01")).toEqual([
      expect.objectContaining({ code: "D", type: "day" }),
    ]);
  });

  it("never replaces when several unrelated entries share the date", async () => {
    const cal = fakeCalendar([
      { id: "a", date: "2026-11-01", type: "day" },
      { id: "b", date: "2026-11-01", type: "on_call" },
    ]);
    const plan = planImport("Aisha Rahman", ROSTER, cal.shifts);
    const result = await applyImport(plan, { "2026-11-01": "replace" }, cal.api, "roster-image");
    expect(result.replaced).toBe(0);
    expect(result.kept).toBe(1);
    expect(cal.shifts.filter((s) => s.date === "2026-11-01").map((s) => s.type)).toEqual(["day", "on_call"]);
  });

  it("skips a date listed twice in one import", () => {
    const plan = planImport("Aisha Rahman", [...ROSTER, { date: "2026-11-01", code: "N" }], []);
    expect(plan[4].kind).toBe("duplicate");
  });

  it("keys assignments by employee, so two people never collide", () => {
    expect(importKey("Aisha Rahman", "2026-11-01")).not.toBe(importKey("Omar Haddad", "2026-11-01"));
    expect(importKey(" Aisha  Rahman ", "2026-11-01")).toBe(importKey("aisha rahman", "2026-11-01"));
  });
});
