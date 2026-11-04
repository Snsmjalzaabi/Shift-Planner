// Roster extraction over a recognised table.
//
// Works on an abstract grid so the same logic serves roster images (cells read
// one at a time by on-device OCR) and Excel workbooks (cells read from the
// file). Steps:
//   1. find the date axis (a header row of dates, or a header column of dates)
//   2. assign each date column a calendar date deterministically (dates.ts)
//   3. list the employee rows so the user can pick theirs
//   4. read only the chosen employee's cells, one cell -> one date
// No step ever merges values from two employees or two dates.

import { CodeReading, readCode, RECOGNISED_CODES } from "./codes";
import { AxisColumn, ColumnDate, DateAxisResult, inferDateAxis, parseHeaderText, parseMonthMention } from "./dates";

const KNOWN_SET = new Set<string>(RECOGNISED_CODES);

export type GridCell = {
  /** Identity of the logical (possibly merged) cell. */
  key: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** Known to be empty without reading it (pixel analysis / empty Excel cell). */
  blank: boolean;
};

export type ReadPurpose = "header" | "label" | "code";

export interface GridSource {
  rows: number;
  cols: number;
  cell(row: number, col: number): GridCell;
  read(cell: GridCell, purpose: ReadPurpose): Promise<string>;
  /** Text outside the table (sheet title). */
  readTitle(): Promise<string>;
  /** Optional: true when two cells hold pixel-identical glyphs. */
  sameGlyph?(a: GridCell, b: GridCell): boolean;
  /**
   * Optional second, independent reading of a shift-code cell (OCR at another
   * scale). Returns false when it disagrees with `text`.
   */
  verifyCode?(cell: GridCell, text: string): Promise<boolean | null>;
  /** Optional: pixel width of a column / height of a row. */
  size?(axis: "col" | "row", index: number): number;
}

export type Orientation = "dates-across" | "dates-down";

export type EmployeeRow = {
  /** Row index (dates-across) or column index (dates-down) in the grid. */
  line: number;
  name: string;
  /** Label cells as read (ID, name, grade…). */
  parts: string[];
  /** Number of non-blank cells in the date range. */
  filled: number;
};

export type RosterAnalysis = {
  orientation: Orientation;
  headerLines: number[];
  datePositions: number[];
  dates: ColumnDate[];
  dateAxis: DateAxisResult;
  employees: EmployeeRow[];
  issues: string[];
};

export type ExtractedCell = {
  date: string | null;
  dateStatus: ColumnDate["status"];
  code: string | null;
  raw: string;
  status: "detected" | "uncertain" | "blank";
  issues: string[];
  /** Grid position of the source cell, for highlighting/back-reference. */
  row: number;
  col: number;
};

export type ProgressFn = (message: string) => void;

/** Axis-agnostic view: (line, position) -> grid cell. */
function axisCell(source: GridSource, orientation: Orientation, line: number, pos: number): GridCell {
  return orientation === "dates-across" ? source.cell(line, pos) : source.cell(pos, line);
}

function axisLength(source: GridSource, orientation: Orientation) {
  return orientation === "dates-across"
    ? { lines: source.rows, positions: source.cols }
    : { lines: source.cols, positions: source.rows };
}

function spanAlong(cell: GridCell, orientation: Orientation): [number, number] {
  return orientation === "dates-across"
    ? [cell.col, cell.col + cell.colSpan - 1]
    : [cell.row, cell.row + cell.rowSpan - 1];
}

class ReadCache {
  private texts = new Map<string, Promise<string>>();
  private readKeys: GridCell[] = [];
  reads = 0;
  constructor(private source: GridSource) {}

  read(cell: GridCell, purpose: ReadPurpose): Promise<string> {
    if (cell.blank) return Promise.resolve("");
    const cached = this.texts.get(`${purpose}:${cell.key}`);
    if (cached) return cached;
    // Pixel-identical shift codes are read once. Header and name cells are
    // always read individually: "01/11" and "04/11" differ by one glyph, too
    // little for a shape signature to tell apart safely.
    if (purpose === "code" && this.source.sameGlyph) {
      for (const other of this.readKeys) {
        if (this.source.sameGlyph(cell, other)) {
          const shared = this.texts.get(`${purpose}:${other.key}`);
          if (shared) {
            this.texts.set(`${purpose}:${cell.key}`, shared);
            return shared;
          }
        }
      }
    }
    this.reads += 1;
    const promise = this.source.read(cell, purpose);
    this.texts.set(`${purpose}:${cell.key}`, promise);
    this.readKeys.push(cell);
    return promise;
  }

  /** Drop a cached reading so the next read asks the source again. */
  forget(cell: GridCell, purpose: ReadPurpose) {
    this.texts.delete(`${purpose}:${cell.key}`);
  }
}

const isDateLike = (text: string) => parseHeaderText(text).day !== undefined;
const isWeekdayLike = (text: string) => {
  const t = parseHeaderText(text);
  return t.weekday !== undefined && t.day === undefined;
};

async function readLine(
  cache: ReadCache,
  source: GridSource,
  orientation: Orientation,
  line: number,
  purpose: ReadPurpose,
): Promise<{ pos: number; cell: GridCell; text: string }[]> {
  const { positions } = axisLength(source, orientation);
  const out: { pos: number; cell: GridCell; text: string }[] = [];
  const seen = new Set<string>();
  for (let pos = 0; pos < positions; pos += 1) {
    const cell = axisCell(source, orientation, line, pos);
    if (seen.has(cell.key)) continue;
    seen.add(cell.key);
    out.push({ pos, cell, text: (await cache.read(cell, purpose)).trim() });
  }
  return out;
}

type DateLine = { line: number; positions: number[]; hits: number };

/**
 * A first or last date column whose header could not be read must not simply
 * vanish from the roster (that silently drops a whole day). Neighbouring
 * columns of the same width with an unreadable, non-word header are kept as
 * date columns; their dates come from position and are flagged for review.
 */
function extendDateSpan(
  source: GridSource,
  orientation: Orientation,
  cells: { pos: number; cell: GridCell; text: string }[],
  positions: number[],
) {
  if (!source.size || positions.length < 3) return;
  const axis = orientation === "dates-across" ? "col" : "row";
  const sizes = positions.map((p) => source.size!(axis, p)).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const byPos = new Map(cells.map((c) => [c.pos, c]));
  const fits = (pos: number) => {
    const entry = byPos.get(pos);
    if (!entry || entry.cell.blank) return false;
    const [a, b] = spanAlong(entry.cell, orientation);
    if (a !== b) return false;
    if (/[A-Za-z]{3,}/.test(entry.text) && !isWeekdayLike(entry.text)) return false; // "Total", "Hours"
    return Math.abs(source.size!(axis, pos) - median) <= median * 0.15;
  };
  for (let pos = positions[positions.length - 1] + 1; fits(pos); pos += 1) positions.push(pos);
  for (let pos = positions[0] - 1; pos >= 0 && fits(pos); pos -= 1) positions.unshift(pos);
}

async function findDateLine(
  cache: ReadCache,
  source: GridSource,
  orientation: Orientation,
  progress?: ProgressFn,
): Promise<DateLine | null> {
  const { lines } = axisLength(source, orientation);
  const limit = Math.min(lines, 5);
  let best: DateLine | null = null;
  for (let line = 0; line < limit; line += 1) {
    progress?.(`Reading header ${line + 1}…`);
    let cells = await readLine(cache, source, orientation, line, "header");
    // The reader learns things while reading a line (for example that the
    // day numbers are rotated); give cells that failed a second attempt.
    const failed = cells.filter(({ text, cell }) => !cell.blank && !isDateLike(text) && !isWeekdayLike(text));
    if (failed.length && failed.length < cells.length) {
      for (const { cell } of failed) cache.forget(cell, "header");
      cells = await readLine(cache, source, orientation, line, "header");
    }
    const single = cells.filter(({ cell }) => {
      const [a, b] = spanAlong(cell, orientation);
      return a === b;
    });
    const hits = single.filter(({ text }) => isDateLike(text));
    if (hits.length < 3) continue;
    const first = hits[0].pos;
    const last = hits[hits.length - 1].pos;
    // Every single-width column between the first and last date belongs to
    // the axis, including ones whose header could not be read.
    const positions = single.filter(({ pos }) => pos >= first && pos <= last).map(({ pos }) => pos);
    extendDateSpan(source, orientation, cells, positions);
    if (hits.length < Math.max(3, positions.length * 0.4)) continue;
    if (!best || hits.length > best.hits) best = { line, positions, hits: hits.length };
    if (hits.length >= positions.length * 0.6) break;
  }
  return best;
}

/** Step 1-3: structure, dates and employee list. */
export async function analyseRoster(
  source: GridSource,
  options: { fallback: { year: number; month: number }; progress?: ProgressFn },
): Promise<{ analysis: RosterAnalysis | null; error?: string; reads: number }> {
  const cache = new ReadCache(source);
  let orientation: Orientation = "dates-across";
  let dateLine = await findDateLine(cache, source, "dates-across", options.progress);
  const down = !dateLine || dateLine.hits < 5 ? await findDateLine(cache, source, "dates-down", options.progress) : null;
  if (down && (!dateLine || down.hits > dateLine.hits)) {
    dateLine = down;
    orientation = "dates-down";
  }
  if (!dateLine) {
    return {
      analysis: null,
      reads: cache.reads,
      error: "No row or column of dates was found in the roster. Use a straight, uncropped screenshot that includes the date header.",
    };
  }

  const { lines } = axisLength(source, orientation);
  const headerLines: number[] = [];
  for (let line = 0; line <= dateLine.line; line += 1) headerLines.push(line);
  // A weekday line directly below the dates is still header, not an employee.
  for (let line = dateLine.line + 1; line < Math.min(lines, dateLine.line + 3); line += 1) {
    const cells = await readLine(cache, source, orientation, line, "header");
    const inRange = cells.filter(({ pos }) => dateLine!.positions.includes(pos));
    const weekdays = inRange.filter(({ text }) => isWeekdayLike(text)).length;
    if (weekdays >= Math.max(3, inRange.length * 0.6)) headerLines.push(line);
    else break;
  }

  // Banners (merged month cells) and per-column header texts.
  const columns: AxisColumn[] = dateLine.positions.map(() => ({ dateText: "", texts: [] }));
  for (const line of headerLines) {
    for (let i = 0; i < dateLine.positions.length; i += 1) {
      const cell = axisCell(source, orientation, line, dateLine.positions[i]);
      const text = (await cache.read(cell, "header")).trim();
      const [a, b] = spanAlong(cell, orientation);
      if (a !== b) {
        const mention = parseMonthMention(text);
        if (mention) columns[i].banner = mention;
      } else if (line === dateLine.line) {
        columns[i].dateText = text;
      } else if (text) {
        columns[i].texts.push(text);
      }
    }
  }
  // A month named in the title, or in a header line whose banner was split
  // into several cells ("NOVEMBER" | "2026"), anchors the month and year.
  const titleText = (await source.readTitle()).trim();
  let title = parseMonthMention(titleText);
  if (!title || title.year === undefined) {
    for (const line of headerLines) {
      const joined = (await readLine(cache, source, orientation, line, "header"))
        .map((c) => c.text)
        .filter((text) => parseHeaderText(text).day === undefined)
        .join(" ");
      const mention = parseMonthMention(joined);
      if (mention && (!title || mention.year !== undefined)) {
        title = mention;
        if (mention.year !== undefined) break;
      }
    }
  }
  const dateAxis = inferDateAxis(columns, title, options.fallback);

  // Employee rows: everything after the header that has a label or any shift.
  const labelPositions: number[] = [];
  for (let pos = 0; pos < dateLine.positions[0]; pos += 1) labelPositions.push(pos);
  const employees: EmployeeRow[] = [];
  for (let line = headerLines[headerLines.length - 1] + 1; line < lines; line += 1) {
    let filled = 0;
    for (const pos of dateLine.positions) if (!axisCell(source, orientation, line, pos).blank) filled += 1;
    const labelCells = labelPositions
      .map((pos) => axisCell(source, orientation, line, pos))
      .filter((cell, i, all) => all.findIndex((c) => c.key === cell.key) === i);
    // A label merged across several employee lines is a group heading
    // ("Night team"), not a person.
    const ownLabels = labelCells.filter((cell) => {
      const span = orientation === "dates-across" ? cell.rowSpan : cell.colSpan;
      return span === 1;
    });
    // Section headings ("Level 6 HUC") have no shifts at all.
    if (filled === 0) continue;
    // Count rows ("Level 6 HUC Days", "Total RN Nights") hold numbers, not
    // shift codes: sample a few cells and skip the row if all are numbers.
    const sample = dateLine.positions
      .map((pos) => axisCell(source, orientation, line, pos))
      .filter((cell) => !cell.blank)
      .filter((_, i, all) => i === 0 || i === Math.floor(all.length / 2) || i === all.length - 1);
    let numeric = 0;
    for (const cell of sample) {
      const text = (await cache.read(cell, "code")).trim();
      if (/^\d{1,3}([.,]\d+)?$/.test(text)) numeric += 1;
    }
    if (sample.length && numeric === sample.length) continue;
    options.progress?.(`Reading names… ${employees.length + 1}`);
    const parts: string[] = [];
    for (const cell of ownLabels) {
      const text = (await cache.read(cell, "label")).trim();
      if (text) parts.push(text);
    }
    const name =
      parts.filter((p) => /[A-Za-z]{2,}/.test(p)).sort((a, b) => b.length - a.length)[0] ??
      parts[0] ??
      `${orientation === "dates-across" ? "Row" : "Column"} ${line + 1}`;
    employees.push({ line, name, parts, filled });
  }

  const issues = [...dateAxis.issues];
  if (!employees.length) issues.push("No employee rows were found below the date header.");
  return {
    analysis: {
      orientation,
      headerLines,
      datePositions: dateLine.positions,
      dates: dateAxis.dates,
      dateAxis,
      employees,
      issues,
    },
    reads: cache.reads,
  };
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z\u0600-\u06ff]+/)
    .filter((t) => t.length >= 2 && t !== "al");
}

/** Edit distance, for matching OCR'd names that are off by a letter. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * The employee row that best matches the signed-in user's name, or null when
 * no row matches clearly. Used only to pre-select a row; the user confirms it.
 */
export function suggestEmployee(employees: EmployeeRow[], userName: string | null | undefined): EmployeeRow | null {
  const wanted = nameTokens(userName ?? "");
  if (!wanted.length) return null;
  let best: { row: EmployeeRow; score: number } | null = null;
  let second = 0;
  for (const row of employees) {
    const have = nameTokens(row.name);
    let score = 0;
    for (const w of wanted) {
      const hit = have.some((h) => h === w || (w.length >= 4 && distance(h, w) <= 1));
      if (hit) score += 1;
    }
    score /= wanted.length;
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { row, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < 0.99 || second >= best.score) return null;
  return best.row;
}

/** Step 4: read one employee's cells. */
export async function extractEmployee(
  source: GridSource,
  analysis: RosterAnalysis,
  line: number,
  progress?: ProgressFn,
): Promise<ExtractedCell[]> {
  const cache = new ReadCache(source);
  const { orientation, datePositions, dates } = analysis;
  const out: ExtractedCell[] = [];
  const readings = new Map<string, CodeReading>();
  const cells = datePositions.map((pos) => axisCell(source, orientation, line, pos));

  // A merged cell must cover only this employee's line; one that spans into
  // other employees' lines cannot be attributed safely.
  const crossesLines = (cell: GridCell) =>
    (orientation === "dates-across" ? cell.rowSpan : cell.colSpan) > 1;

  let done = 0;
  for (const cell of cells) {
    if (cell.blank || readings.has(cell.key)) continue;
    done += 1;
    progress?.(`Reading shifts… ${done}`);
    const reading = readCode(await cache.read(cell, "code"));
    if (reading.code && source.verifyCode) {
      const agreed = await source.verifyCode(cell, reading.code);
      if (agreed === false) reading.issues.push("A second reading of this cell disagreed; confirm the code.");
      // No second reading at all: only a known code read cleanly is trusted.
      else if (agreed === null && reading.issues.length === 0 && !KNOWN_SET.has(reading.code))
        reading.issues.push("This cell could only be read once; confirm the code.");
    }
    readings.set(cell.key, reading);
  }

  // Cross-check identical glyphs: if the same shape was read two different
  // ways, neither reading is trusted.
  if (source.sameGlyph) {
    const distinct = cells.filter((c, i) => !c.blank && cells.findIndex((d) => d.key === c.key) === i);
    for (let i = 0; i < distinct.length; i += 1)
      for (let j = i + 1; j < distinct.length; j += 1) {
        const a = distinct[i];
        const b = distinct[j];
        const ra = readings.get(a.key)!;
        const rb = readings.get(b.key)!;
        if (ra.code !== rb.code && source.sameGlyph(a, b)) {
          for (const r of [ra, rb])
            if (!r.issues.includes("Identical cells were read differently; confirm the code."))
              r.issues.push("Identical cells were read differently; confirm the code.");
        }
      }
  }

  const dateCount = new Map<string, number>();
  for (const d of dates) if (d.iso) dateCount.set(d.iso, (dateCount.get(d.iso) ?? 0) + 1);

  datePositions.forEach((pos, i) => {
    const cell = cells[i];
    const date = dates[i];
    const base = { date: date.iso, dateStatus: date.status, row: cell.row, col: cell.col };
    if (cell.blank) {
      out.push({ ...base, code: null, raw: "", status: "blank", issues: [] });
      return;
    }
    const reading = readings.get(cell.key)!;
    const issues = [...reading.issues];
    if (date.note) issues.push(date.note);
    if (!date.iso) issues.push("No date for this column.");
    if (date.iso && (dateCount.get(date.iso) ?? 0) > 1) issues.push("This date appears in more than one column.");
    if (!reading.code) issues.push(reading.raw.trim() ? `Unreadable cell (read as "${reading.raw.trim()}").` : "Cell has content that could not be read.");
    const [a, b] = spanAlong(cell, orientation);
    if (a !== b) issues.push(`Merged cell covering ${b - a + 1} dates; confirm it applies to each.`);
    if (crossesLines(cell)) issues.push("Merged cell is shared with another employee's row.");
    out.push({
      ...base,
      code: reading.code,
      raw: reading.raw,
      status: issues.length || !reading.code ? "uncertain" : "detected",
      issues: Array.from(new Set(issues)),
    });
  });
  return out;
}

export type ExtractionSummary = {
  totalDates: number;
  detected: number;
  uncertain: number;
  blank: number;
  duplicates: number;
  firstDate: string | null;
  lastDate: string | null;
  warnings: string[];
  complete: boolean;
};

/** Completeness check: compare what was read against the detected date range. */
export function summarise(cells: ExtractedCell[], analysis: RosterAnalysis): ExtractionSummary {
  const detected = cells.filter((c) => c.status === "detected").length;
  const uncertain = cells.filter((c) => c.status === "uncertain").length;
  const blank = cells.filter((c) => c.status === "blank").length;
  const dates = cells.map((c) => c.date).filter((d): d is string => !!d);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const d of dates) {
    if (seen.has(d)) duplicates += 1;
    seen.add(d);
  }
  const sorted = [...seen].sort();
  const warnings = [...analysis.issues];
  const filled = detected + uncertain;
  if (filled > 0 && uncertain / filled > 0.25)
    warnings.push(`Only ${detected} of ${filled} filled cells were read with confidence; the rest need checking.`);
  const unrecognised = cells.filter((c) => c.issues.some((i) => i.includes("not a recognised code"))).length;
  if (unrecognised) warnings.push(`${unrecognised} cell${unrecognised === 1 ? " has" : "s have"} a code that is not in the known list (${RECOGNISED_CODES.join(", ")}).`);
  if (duplicates) warnings.push(`${duplicates} date${duplicates === 1 ? " is" : "s are"} repeated in the roster.`);
  const misaligned = analysis.dates.filter((d) => d.status === "derived").length;
  return {
    totalDates: cells.length,
    detected,
    uncertain,
    blank,
    duplicates,
    firstDate: sorted[0] ?? null,
    lastDate: sorted[sorted.length - 1] ?? null,
    warnings: Array.from(new Set(warnings)),
    complete: uncertain === 0 && duplicates === 0 && misaligned === 0 && !analysis.dateAxis.monthAssumed,
  };
}
