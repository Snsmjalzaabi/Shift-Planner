import { describe, expect, it } from "vitest";

import { ExtractedCell } from "../extract";
import { buildPlan, importItems, itemProblems, reviewCounts, toReviewItems } from "../session";

const cell = (date: string, code: string | null, status: ExtractedCell["status"], issues: string[] = []): ExtractedCell => ({
  date,
  dateStatus: "read",
  code,
  raw: code ?? "",
  status,
  issues,
  row: 3,
  col: 2,
});

describe("review screen state", () => {
  const cells = [
    cell("2026-11-01", "N", "detected"),
    cell("2026-11-02", "X", "detected"),
    cell("2026-11-03", null, "blank"),
    cell("2026-11-04", "SL", "uncertain", ['"SL" is not a recognised code; confirm it.']),
  ];

  it("blank cells are listed but never selected for import", () => {
    const items = toReviewItems(cells);
    expect(items[2]).toMatchObject({ selected: false, status: "blank" });
    expect(importItems(items).map((i) => i.date)).not.toContain("2026-11-03");
  });

  it("uncertain cells block import until checked", () => {
    const items = toReviewItems(cells);
    expect(itemProblems(items[3])).toContain("Check this row against the roster.");
    expect(importItems(items).map((i) => i.code)).toEqual(["N", "X"]);
    items[3].acknowledged = true;
    expect(importItems(items).map((i) => i.code)).toEqual(["N", "X", "SL"]);
  });

  it("counts detected, uncertain, skipped and duplicate rows", () => {
    const items = toReviewItems(cells);
    const plan = buildPlan("Aisha Rahman", items, [
      { id: "1", date: "2026-11-01", type: "night", code: "N", import_key: "roster:aisha rahman:2026-11-01" },
    ]);
    expect(reviewCounts(items, plan)).toMatchObject({
      detected: 2,
      uncertain: 1,
      blank: 1,
      skipped: 1,
      unresolved: 1,
      duplicates: 1,
      toCreate: 1,
    });
  });

  it("codes edited by the user are kept as typed (upper-cased), not renamed", () => {
    const items = toReviewItems(cells);
    items[1].code = "xl";
    expect(importItems(items)[1]).toEqual({ date: "2026-11-02", code: "XL" });
  });
});
