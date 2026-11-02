// Roster shift codes are kept exactly as the roster writes them.
//
// The old importer mapped X -> "OFF", AL -> an "off" shift with an
// "Annual Leave" note, and silently dropped anything it did not know. Here the
// code that is stored and shown is always the code that was read; the calendar
// colour bucket is a separate, display-only concern.

export const KNOWN_CODES = ["D", "N", "X", "XL", "AL"] as const;

export type CodeReading = {
  /** Code as written (letters/digits only, upper-cased), or null if unreadable. */
  code: string | null;
  /** Exactly what the reader returned, for the "Read as" line. */
  raw: string;
  /** Reasons the user must confirm this value before it can be imported. */
  issues: string[];
};

const MAX_CODE_LENGTH = 6;

/**
 * Turn the text read from one cell into a roster code without changing its
 * meaning. Only whitespace and stray punctuation (OCR specks, quote marks) are
 * removed; letters are never substituted for other letters and abbreviations
 * are never expanded. Anything outside the known set is kept as read but
 * flagged so it cannot be imported unchecked.
 */
export function readCode(raw: string, knownCodes: readonly string[] = KNOWN_CODES): CodeReading {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) return { code: null, raw: text, issues: [] };
  const compact = trimmed.replace(/\s+/g, "");
  const cleaned = compact.replace(/[^0-9A-Za-z]/g, "");
  const issues: string[] = [];
  if (!cleaned) {
    return { code: null, raw: text, issues: ["Cell has marks but no readable code."] };
  }
  if (cleaned.length > MAX_CODE_LENGTH) {
    return { code: null, raw: text, issues: [`"${trimmed}" is not a roster code.`] };
  }
  const code = cleaned.toUpperCase();
  if (cleaned !== compact) issues.push(`Read as "${trimmed}"; extra marks were ignored.`);
  // Rosters write codes in capitals; a lower-case reading ("x", "aL") is a
  // sign the recogniser was unsure, so it is never accepted unchecked.
  if (/[a-z]/.test(cleaned)) issues.push(`Read as "${trimmed}" (lower case); confirm the code.`);
  if (!knownCodes.includes(code)) issues.push(`"${code}" is not a recognised code; confirm it.`);
  return { code, raw: text, issues };
}

/** Code typed by the user in the review screen. */
export function normaliseTypedCode(value: string): string | null {
  const cleaned = value.replace(/\s+/g, "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return cleaned && cleaned.length <= MAX_CODE_LENGTH ? cleaned : null;
}

/**
 * Calendar colour bucket for a code. This only picks the chip colour; the
 * label shown everywhere is the code itself. Only D and N carry a meaning the
 * calendar already models (day / night); every other code, including X, is
 * shown in the neutral colour with its own label rather than being renamed.
 */
export function codeToCalendarType(code: string): "day" | "night" | "off" {
  if (code === "D") return "day";
  if (code === "N") return "night";
  return "off";
}
