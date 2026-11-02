import { describe, expect, it } from "vitest";

import { analyseRoster, extractEmployee } from "../extract";
import { createSheetGridSource } from "../sheetSource";

const FALLBACK = { year: 2026, month: 11 };

describe("Excel rosters use the same structure-aware reader", () => {
  it("reads one employee's row and keeps codes as written", async () => {
    const rows = [
      ["Name", new Date(Date.UTC(2026, 10, 29)), new Date(Date.UTC(2026, 10, 30)), new Date(Date.UTC(2026, 11, 1)), new Date(Date.UTC(2026, 11, 2))],
      ["Aisha Rahman", "D", "X", "", "AL"],
      ["Omar Haddad", "N", "N", "XL", "X"],
    ];
    const source = createSheetGridSource(rows);
    const { analysis } = await analyseRoster(source, { fallback: FALLBACK });
    expect(analysis!.employees.map((e) => e.name)).toEqual(["Aisha Rahman", "Omar Haddad"]);
    const cells = await extractEmployee(source, analysis!, analysis!.employees[1].line);
    expect(cells.map((c) => [c.date, c.code, c.status])).toEqual([
      ["2026-11-29", "N", "detected"],
      ["2026-11-30", "N", "detected"],
      ["2026-12-01", "XL", "detected"],
      ["2026-12-02", "X", "detected"],
    ]);
    const aisha = await extractEmployee(source, analysis!, analysis!.employees[0].line);
    expect(aisha[2]).toMatchObject({ date: "2026-12-01", code: null, status: "blank" });
  });

  it("handles a plain date / code list", async () => {
    const rows = [
      ["Date", "Shift"],
      ["2026-11-01", "D"],
      ["2026-11-02", "N"],
      ["2026-11-03", "X"],
      ["2026-11-04", "AL"],
    ];
    const source = createSheetGridSource(rows);
    const { analysis } = await analyseRoster(source, { fallback: FALLBACK });
    expect(analysis!.orientation).toBe("dates-down");
    expect(analysis!.employees.map((e) => e.name)).toEqual(["Shift"]);
    const cells = await extractEmployee(source, analysis!, analysis!.employees[0].line);
    expect(cells.map((c) => c.code)).toEqual(["D", "N", "X", "AL"]);
  });

  it("does not mix employees when a code sits next to another person's date", async () => {
    const rows = [
      ["", "1", "2", "3"],
      ["A", "D", "", ""],
      ["B", "", "N", ""],
    ];
    const source = createSheetGridSource(rows, "November 2026");
    const { analysis } = await analyseRoster(source, { fallback: FALLBACK });
    const a = await extractEmployee(source, analysis!, analysis!.employees[0].line);
    expect(a.filter((c) => c.code).map((c) => [c.date, c.code])).toEqual([["2026-11-01", "D"]]);
  });
});
