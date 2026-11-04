import { describe, expect, it } from "vitest";

import { analyseRoster, extractEmployee } from "../extract";
import { createImageGridSource } from "../imageSource";
import { hasTesseract, loadFixture, tesseractEngine } from "./helpers";

// End-to-end check of the real image path with a real OCR engine. Tesseract
// stands in for ML Kit / Apple Vision and reads the exact single-cell crops
// the app sends on device; results are compared with the manually checked
// reference in each fixture's JSON.
//
// The hard requirement is that nothing is imported wrong: every cell marked
// "detected" must match the reference exactly and every date column must sit
// on its true calendar date. Cells the engine cannot read reliably must come
// back as "uncertain", never as a guess. Recall floors are deliberately
// conservative because Tesseract is weaker than the on-device engines on
// single letters.
const RECALL_FLOOR: Record<string, number> = {
  monthly_rotated: 0.75,
  cross_year: 0.75,
  weekly: 0.4,
  vertical: 0.7,
  poor_quality: 0,
  high_dpi: 0.75,
  huc_style: 0.6,
};

describe.skipIf(!hasTesseract())("roster image reader against reference (real OCR)", () => {
  it.each(Object.keys(RECALL_FLOOR))("%s", async (name) => {
    const { image, table, truth } = loadFixture(name);
    const engine = tesseractEngine();
    try {
      const source = createImageGridSource(image, table, engine);
      const { analysis, error } = await analyseRoster(source, { fallback: { year: 2026, month: 11 } });
      expect(error).toBeUndefined();
      // Every date column found, each on its true date (derived ones too).
      expect(analysis!.dates.map((d) => d.iso)).toEqual(truth.dates);
      expect(analysis!.employees).toHaveLength(truth.employees.length);

      let detected = 0;
      let filled = 0;
      const wrong: string[] = [];
      for (const [i, employee] of truth.employees.entries()) {
        const cells = await extractEmployee(source, analysis!, analysis!.employees[i].line);
        expect(cells).toHaveLength(truth.dates.length);
        for (const cell of cells) {
          const expected = employee.assignments[cell.date!];
          if (expected) filled += 1;
          if (cell.status === "blank") {
            // A cell with a code must never be reported blank.
            if (expected) wrong.push(`${employee.name} ${cell.date}: blank, expected ${expected}`);
            continue;
          }
          if (cell.status === "detected") {
            detected += 1;
            if (cell.code !== expected) wrong.push(`${employee.name} ${cell.date}: ${cell.code} != ${expected}`);
          }
        }
      }
      expect(wrong).toEqual([]);
      expect(detected / filled).toBeGreaterThanOrEqual(RECALL_FLOOR[name]);
    } finally {
      engine.dispose();
    }
  });
});
