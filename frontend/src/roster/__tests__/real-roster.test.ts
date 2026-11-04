import { existsSync, readFileSync } from "fs";
import { expect, it } from "vitest";

import { analyseRoster, extractEmployee, suggestEmployee } from "../extract";
import { decodePng } from "../image";
import { createImageGridSource } from "../imageSource";
import { buildTable } from "../table";
import { hasTesseract, tesseractEngine } from "./helpers";

// Verifies a real roster screenshot against a hand-checked row. Real rosters
// contain colleagues' names and schedules, so they are never committed: point
// the test at local files instead.
//
//   ROSTER_IMAGE=/path/roster.png ROSTER_TRUTH=/path/row.json npm test
//
// row.json: {"name": "<employee as written>", "codes": ["N", "", "D", ...]}
// with one entry per date column, "" for a blank cell.
const IMAGE = process.env.ROSTER_IMAGE ?? "";
const TRUTH = process.env.ROSTER_TRUTH ?? "";

it.skipIf(!IMAGE || !TRUTH || !existsSync(IMAGE) || !hasTesseract())(
  "real roster screenshot matches the hand-checked row",
  async () => {
    const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as { name: string; codes: string[] };
    const image = decodePng(new Uint8Array(readFileSync(IMAGE)));
    const table = buildTable(image);
    expect(table).not.toBeNull();
    const engine = tesseractEngine();
    try {
      const source = createImageGridSource(image, table!, engine);
      const { analysis } = await analyseRoster(source, { fallback: { year: 2026, month: 10 } });
      expect(analysis!.dates).toHaveLength(truth.codes.length);
      const row = suggestEmployee(analysis!.employees, truth.name);
      expect(row?.name).toBe(truth.name);
      const cells = await extractEmployee(source, analysis!, row!.line);
      const wrong = cells.filter((cell, i) =>
        cell.status === "blank" ? truth.codes[i] !== "" : cell.status === "detected" && cell.code !== truth.codes[i],
      );
      expect(wrong).toEqual([]);
    } finally {
      engine.dispose();
    }
  },
  600_000,
);
