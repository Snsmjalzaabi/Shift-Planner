import readExcelFile from "read-excel-file/universal";

export type ScheduleCode = "D" | "N" | "OFF" | "AL";
export type ImportedShiftType = "day" | "night" | "off";

export type ImportCandidate = {
  id: string;
  date: string;
  code: ScheduleCode | null;
  type: ImportedShiftType | null;
  originalText: string;
  source: "image" | "xlsx";
  issues: string[];
  acknowledged: boolean;
  selected: boolean;
};

export type PositionedText = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type DateContext = { year: number; month: number };
type ParsedDate = { iso: string; inferred: boolean };

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const CODE_ALIASES: Record<string, ScheduleCode> = {
  D: "D",
  DAY: "D",
  DAYSHIFT: "D",
  N: "N",
  NIGHT: "N",
  NIGHTSHIFT: "N",
  X: "OFF",
  XOFF: "OFF",
  O: "OFF",
  "0": "OFF",
  OFF: "OFF",
  OFFDAY: "OFF",
  AL: "AL",
  ANNUALLEAVE: "AL",
  LEAVE: "AL",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isValidImportDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return !!match && !!validIso(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function normalizeScheduleCode(value: unknown): ScheduleCode | null {
  const compact = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s._/-]+/g, "")
    .replace(/[()]/g, "");
  return CODE_ALIASES[compact] ?? null;
}

export function codeToShiftType(code: ScheduleCode): ImportedShiftType {
  if (code === "D") return "day";
  if (code === "N") return "night";
  return "off";
}

export function codeToNote(code: ScheduleCode): string | null {
  return code === "AL" ? "Annual Leave (AL)" : null;
}

function inferContext(values: unknown[][], fallback: DateContext): DateContext {
  const text = values.flat().map(String).join(" ");
  const monthYear = new RegExp(
    `(${Object.keys(MONTHS).join("|")})[\\s,/-]+(20\\d{2})`,
    "i",
  ).exec(text);
  if (monthYear) {
    return { year: Number(monthYear[2]), month: MONTHS[monthYear[1].toLowerCase()] };
  }
  const yearMonth = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/.exec(text);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Number(yearMonth[2]) };
  }
  return fallback;
}

function parseDateCell(value: unknown, context: DateContext): ParsedDate | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      iso: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      inferred: false,
    };
  }

  if (typeof value === "number") {
    if (value >= 20000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + Math.floor(value) * 86_400_000);
      const iso = validIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      if (iso) return { iso, inferred: false };
    }
    if (Number.isInteger(value) && value >= 1 && value <= 31) {
      const iso = validIso(context.year, context.month, value);
      return iso ? { iso, inferred: true } : null;
    }
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  let match = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/.exec(text);
  if (match) {
    const iso = validIso(Number(match[1]), Number(match[2]), Number(match[3]));
    return iso ? { iso, inferred: false } : null;
  }

  match = /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/.exec(text);
  if (match) {
    const iso = validIso(Number(match[3]), Number(match[2]), Number(match[1]));
    return iso ? { iso, inferred: false } : null;
  }

  match = /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{2})\b/.exec(text);
  if (match) {
    const iso = validIso(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
    return iso ? { iso, inferred: false } : null;
  }

  match = new RegExp(
    `\\b(0?[1-9]|[12]\\d|3[01])\\s+(${Object.keys(MONTHS).join("|")})\\s+(20\\d{2})\\b`,
    "i",
  ).exec(text);
  if (match) {
    const iso = validIso(
      Number(match[3]),
      MONTHS[match[2].toLowerCase()],
      Number(match[1]),
    );
    return iso ? { iso, inferred: false } : null;
  }

  if (/^(0?[1-9]|[12]\d|3[01])$/.test(text)) {
    const iso = validIso(context.year, context.month, Number(text));
    return iso ? { iso, inferred: true } : null;
  }
  return null;
}

function makeCandidate(
  date: ParsedDate,
  code: ScheduleCode,
  source: ImportCandidate["source"],
  originalText: string,
  index: number,
  extraIssues: string[] = [],
): ImportCandidate {
  const issues = [
    ...(date.inferred ? ["Month or year was inferred; verify the date."] : []),
    ...extraIssues,
  ];
  return {
    id: `${source}-${index}-${date.iso}-${code}`,
    date: date.iso,
    code,
    type: codeToShiftType(code),
    originalText,
    source,
    issues,
    acknowledged: issues.length === 0,
    selected: true,
  };
}

function dedupe(candidates: ImportCandidate[]): ImportCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.date}|${candidate.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseScheduleMatrix(
  rows: unknown[][],
  source: ImportCandidate["source"],
  fallbackDate = new Date(),
): ImportCandidate[] {
  const fallback = { year: fallbackDate.getFullYear(), month: fallbackDate.getMonth() + 1 };
  const context = inferContext(rows, fallback);
  const output: ImportCandidate[] = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const code = normalizeScheduleCode(cell);
      if (!code) return;

      const sameRowDates = row
        .map((value, index) => ({ parsed: parseDateCell(value, context), index }))
        .filter((entry): entry is { parsed: ParsedDate; index: number } => !!entry.parsed);
      let dateEntry = sameRowDates.sort(
        (a, b) => Math.abs(a.index - columnIndex) - Math.abs(b.index - columnIndex),
      )[0];

      if (!dateEntry) {
        for (let up = rowIndex - 1; up >= Math.max(0, rowIndex - 6); up -= 1) {
          const parsed = parseDateCell(rows[up]?.[columnIndex], context);
          if (parsed) {
            dateEntry = { parsed, index: columnIndex };
            break;
          }
        }
      }

      if (!dateEntry) return;
      output.push(
        makeCandidate(
          dateEntry.parsed,
          code,
          source,
          `${String(rows[rowIndex]?.[dateEntry.index] ?? dateEntry.parsed.iso)} ${String(cell)}`,
          output.length,
        ),
      );
    });
  });
  return dedupe(output);
}

export async function parseWorkbook(
  data: ArrayBuffer,
  fallbackDate = new Date(),
): Promise<ImportCandidate[]> {
  const workbook = await readExcelFile(data);
  const candidates: ImportCandidate[] = [];
  workbook.forEach((sheet) => {
    candidates.push(...parseScheduleMatrix(sheet.data, "xlsx", fallbackDate));
  });
  return dedupe(candidates).map((candidate, index) => ({
    ...candidate,
    id: `xlsx-${index}-${candidate.date}-${candidate.code}`,
  }));
}

export function parseRecognizedText(
  elements: PositionedText[],
  rawText: string,
  fallbackDate = new Date(),
): ImportCandidate[] {
  const sorted = [...elements].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: PositionedText[][] = [];
  for (const element of sorted) {
    const centerY = (element.top + element.bottom) / 2;
    const matching = rows.find((row) => {
      const rowCenter = row.reduce((sum, item) => sum + (item.top + item.bottom) / 2, 0) / row.length;
      const rowHeight = Math.max(...row.map((item) => item.bottom - item.top), 12);
      return Math.abs(rowCenter - centerY) <= Math.max(10, rowHeight * 0.65);
    });
    if (matching) matching.push(element);
    else rows.push([element]);
  }

  const matrix = rows
    .sort((a, b) => Math.min(...a.map((item) => item.top)) - Math.min(...b.map((item) => item.top)))
    .map((row) => row.sort((a, b) => a.left - b.left).map((item) => item.text));

  // Full line text helps when ML Kit returns a date and code as one element.
  matrix.push(...rawText.split(/\r?\n/).map((line) => line.trim().split(/\s+/)));
  return parseScheduleMatrix(matrix, "image", fallbackDate).map((candidate, index) => ({
    ...candidate,
    id: `image-${index}-${candidate.date}-${candidate.code}`,
    issues: [...candidate.issues, "Photo import must be visually checked against the original."],
    acknowledged: false,
  }));
}
