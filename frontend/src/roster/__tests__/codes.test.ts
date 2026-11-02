import { describe, expect, it } from "vitest";

import { codeToCalendarType, normaliseTypedCode, readCode } from "../codes";

describe("roster codes are preserved exactly", () => {
  it.each(["D", "N", "X", "XL", "AL"])("%s stays %s", (code) => {
    expect(readCode(code)).toEqual({ code, raw: code, issues: [] });
  });

  it("never turns X into Off or expands abbreviations", () => {
    expect(readCode("X").code).toBe("X");
    expect(readCode("AL").code).toBe("AL");
    expect(readCode(" XL ").code).toBe("XL");
  });

  it("treats an empty cell as blank, not as a day off", () => {
    expect(readCode("")).toEqual({ code: null, raw: "", issues: [] });
    expect(readCode("   ").code).toBeNull();
  });

  it("keeps unknown codes as read but flags them", () => {
    const r = readCode("SL");
    expect(r.code).toBe("SL");
    expect(r.issues.join(" ")).toMatch(/not a recognised code/);
  });

  it("flags punctuation noise and lower-case readings instead of trusting them", () => {
    expect(readCode("N\"").issues.length).toBeGreaterThan(0);
    expect(readCode("x").issues.join(" ")).toMatch(/lower case/);
    expect(readCode("aL").issues.join(" ")).toMatch(/lower case/);
  });

  it("rejects text that cannot be a code", () => {
    expect(readCode("Aisha Rahman").code).toBeNull();
    expect(readCode("~").code).toBeNull();
  });

  it("only D and N pick a coloured chip; label is always the code", () => {
    expect(codeToCalendarType("D")).toBe("day");
    expect(codeToCalendarType("N")).toBe("night");
    expect(codeToCalendarType("X")).toBe("off");
    expect(codeToCalendarType("XL")).toBe("off");
  });

  it("normalises codes typed in the review screen", () => {
    expect(normaliseTypedCode(" xl ")).toBe("XL");
    expect(normaliseTypedCode("")).toBeNull();
  });
});
