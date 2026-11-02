import { describe, expect, it } from "vitest";

import { AxisColumn, inferDateAxis, normaliseNumericDate, parseHeaderText, parseMonthMention } from "../dates";

const FALLBACK = { year: 2026, month: 11 };
const col = (dateText: string, ...texts: string[]): AxisColumn => ({ dateText, texts });
const days = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => col(String(from + i)));

describe("header text", () => {
  it("reads common header formats", () => {
    expect(parseHeaderText("12")).toMatchObject({ day: 12 });
    expect(parseHeaderText("20-Dec")).toMatchObject({ day: 20, month: 12 });
    expect(parseHeaderText("02/11")).toMatchObject({ day: 2, month: 11, altDay: 11, altMonth: 2 });
    expect(parseHeaderText("01/11/2026")).toMatchObject({ day: 1, month: 11, year: 2026 });
    expect(parseHeaderText("2026-11-03")).toMatchObject({ day: 3, month: 11, year: 2026 });
    expect(parseHeaderText("Mon 3")).toMatchObject({ day: 3, weekday: 0 });
    expect(parseHeaderText("Su")).toMatchObject({ weekday: 6 });
    expect(parseHeaderText("Name").day).toBeUndefined();
  });

  it("fixes OCR slips only inside numeric dates", () => {
    expect(normaliseNumericDate("O6/ 11")).toBe("06/11");
    expect(normaliseNumericDate("31°10/2026")).toBe("31/10/2026");
    expect(normaliseNumericDate("Hello Oscar")).toBe("Hello Oscar");
  });

  it("does not read a day as a two-digit year", () => {
    expect(parseMonthMention("Dec 21 Dec 22")).toEqual({ month: 12, year: undefined });
    expect(parseMonthMention("NOVEMBER 2026")).toEqual({ month: 11, year: 2026 });
    expect(parseMonthMention("Nov-26")).toEqual({ month: 11, year: 2026 });
  });
});

describe("date axis", () => {
  it("anchors day numbers on the stated month", () => {
    const r = inferDateAxis(days(1, 30), { month: 11, year: 2026 }, FALLBACK);
    expect(r.dates[0].iso).toBe("2026-11-01");
    expect(r.dates[29].iso).toBe("2026-11-30");
    expect(r.dates.every((d) => d.status === "read")).toBe(true);
  });

  it("crosses month and year boundaries", () => {
    const cols = [...days(28, 31), ...days(1, 3)];
    cols.forEach((c, i) => (c.banner = i < 4 ? { month: 12, year: 2026 } : { month: 1, year: 2027 }));
    const r = inferDateAxis(cols, null, FALLBACK);
    expect(r.dates.map((d) => d.iso)).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("flags a misread header instead of shifting the dates", () => {
    const cols = days(1, 10);
    cols[4] = col("8"); // should be 5
    const r = inferDateAxis(cols, { month: 11, year: 2026 }, FALLBACK);
    expect(r.dates[4]).toMatchObject({ iso: "2026-11-05", status: "derived" });
    expect(r.dates[5]).toMatchObject({ iso: "2026-11-06", status: "read" });
  });

  it("keeps an unreadable header column in place and flags it", () => {
    const cols = days(1, 10);
    cols[0] = col("");
    const r = inferDateAxis(cols, { month: 11, year: 2026 }, FALLBACK);
    expect(r.dates[0]).toMatchObject({ iso: "2026-11-01", status: "derived" });
    expect(r.issues.join(" ")).toMatch(/could not be confirmed/);
  });

  it("uses weekdays to pin the month when only day numbers are shown", () => {
    // 1 Nov 2026 is a Sunday.
    const names = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const cols = Array.from({ length: 14 }, (_, i) => col(String(i + 1), names[i % 7]));
    const r = inferDateAxis(cols, null, { year: 2026, month: 11 });
    expect(r.dates[0].iso).toBe("2026-11-01");
  });

  it("says when the month had to be assumed", () => {
    const r = inferDateAxis(days(1, 7), null, FALLBACK);
    expect(r.monthAssumed).toBe(true);
    expect(r.issues.join(" ")).toMatch(/does not show the month/);
  });

  it("treats non-consecutive headers as needing review", () => {
    const cols = [col("1"), col("2"), col("5"), col("6"), col("9"), col("12"), col("14")];
    const r = inferDateAxis(cols, { month: 11, year: 2026 }, FALLBACK);
    expect(r.mode).toBe("as-read");
    expect(r.dates.map((d) => d.iso)).toEqual([
      "2026-11-01", "2026-11-02", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-12", "2026-11-14",
    ]);
    expect(r.dates.every((d) => d.status === "derived")).toBe(true);
  });

  it("flags a date that appears twice", () => {
    const cols = [col("1"), col("2"), col("3"), col("3"), col("9"), col("12"), col("20")];
    const r = inferDateAxis(cols, { month: 11, year: 2026 }, FALLBACK);
    expect(r.dates.some((d) => d.note?.includes("more than one column"))).toBe(true);
  });
});
