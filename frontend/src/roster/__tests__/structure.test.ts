import { describe, expect, it } from "vitest";

import { analyseRoster, extractEmployee, summarise } from "../extract";
import { loadFixture, oracleSource } from "./helpers";

// Table structure + date alignment + per-employee extraction, with the text of
// each cell supplied from the fixture's ground truth (no OCR involved).
const FALLBACK = { year: 2026, month: 11 };

describe.each(["monthly_rotated", "cross_year", "weekly", "vertical", "poor_quality", "high_dpi", "huc_style"])(
  "roster structure: %s",
  (name) => {
    it("finds every date column with the right calendar date", async () => {
      const { image, table, truth } = loadFixture(name);
      const { analysis, error } = await analyseRoster(oracleSource(image, table, truth), { fallback: FALLBACK });
      expect(error).toBeUndefined();
      expect(analysis!.orientation).toBe(truth.datesAxis === "columns" ? "dates-across" : "dates-down");
      expect(analysis!.dates.map((d) => d.iso)).toEqual(truth.dates);
      expect(analysis!.dates.every((d) => d.status === "read")).toBe(true);
      expect(analysis!.dateAxis.monthAssumed).toBe(false);
    });

    it("lists each employee row once, in order", async () => {
      const { image, table, truth } = loadFixture(name);
      const { analysis } = await analyseRoster(oracleSource(image, table, truth), { fallback: FALLBACK });
      expect(analysis!.employees.map((e) => e.name)).toEqual(truth.employees.map((e) => e.name));
    });

    it("extracts exactly the selected employee's codes, one per date", async () => {
      const { image, table, truth } = loadFixture(name);
      const source = oracleSource(image, table, truth);
      const { analysis } = await analyseRoster(source, { fallback: FALLBACK });
      for (const [index, employee] of truth.employees.entries()) {
        const cells = await extractEmployee(source, analysis!, analysis!.employees[index].line);
        const got: Record<string, string> = {};
        for (const c of cells) if (c.code) got[c.date!] = c.code;
        expect(got).toEqual(employee.assignments);
        const blanks = cells.filter((c) => c.status === "blank").map((c) => c.date);
        expect(blanks).toEqual(truth.dates.filter((d) => !(d in employee.assignments)));
        const summary = summarise(cells, analysis!);
        expect(summary.duplicates).toBe(0);
        expect(summary.uncertain).toBe(0);
        expect(summary.complete).toBe(true);
        expect(summary.firstDate).toBe(truth.dates[0]);
        expect(summary.lastDate).toBe(truth.dates[truth.dates.length - 1]);
      }
    });
  },
);
