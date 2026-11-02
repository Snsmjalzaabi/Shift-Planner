// Deterministic date assignment for roster date columns (or rows).
//
// Each date column is read on its own (banner month, weekday row, day number)
// and the column dates are then fixed by position: columns run one calendar
// day apart, so the whole axis is anchored on the start date that agrees with
// the most readings. A column whose header is unreadable or disagrees gets
// the date its position implies but is marked "derived" so the review screen
// asks the user to confirm it. Nothing here depends on how far apart the text
// happened to be printed, which is what used to shift dates.

export type HeaderToken = {
  day?: number;
  month?: number; // 1-12
  year?: number;
  weekday?: number; // 0 = Monday … 6 = Sunday
  /** Alternative month for ambiguous numeric dates (01/11 could be 1 Nov or 11 Jan). */
  altDay?: number;
  altMonth?: number;
  text: string;
};

export type AxisColumn = {
  /** Text of this column's cell in the date line (the row/column of dates). */
  dateText: string;
  /** Other header texts of this column (weekday line etc.), top to bottom. */
  texts: string[];
  /** Month/year from a merged banner above this column, if any. */
  banner?: { month: number; year?: number };
};

export type ColumnDate = {
  iso: string | null;
  status: "read" | "derived";
  note?: string;
};

export type DateAxisResult = {
  dates: ColumnDate[];
  issues: string[];
  /** True when month/year could not be taken from the roster itself. */
  monthAssumed: boolean;
  mode: "consecutive" | "as-read";
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  mo: 0, mon: 0, monday: 0, tu: 1, tue: 1, tues: 1, tuesday: 1, we: 2, wed: 2,
  wednesday: 2, th: 3, thu: 3, thur: 3, thurs: 3, thursday: 3, fr: 4, fri: 4,
  friday: 4, sa: 5, sat: 5, saturday: 5, su: 6, sun: 6, sunday: 6,
};
const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function fullYear(value: number): number {
  return value < 100 ? 2000 + value : value;
}

/** Fix the classic digit look-alikes, but only inside an otherwise numeric token. */
function numericLookalikes(token: string): string {
  if (!/^[0-9OoIl|]+$/.test(token) || !/[0-9]/.test(token)) return token;
  return token.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
}

/**
 * Undo common OCR slips inside numeric dates only: "O6/ 11" -> "06/11",
 * "31°10/2026" -> "31/10/2026". Words are left alone, and every column's date
 * is still checked against the day-by-day sequence afterwards.
 */
export function normaliseNumericDate(raw: string): string {
  const collapsed = raw.replace(/\s*([/\-.°*:\\])\s*/g, "$1");
  return collapsed.replace(
    /(^|\s)([0-9OoIl|]{1,4}(?:[/\-.°*:\\][0-9OoIl|]{1,4}){1,2})(?=\s|$)/g,
    (_m, lead: string, token: string) => {
      if (!/[0-9]/.test(token)) return lead + token;
      return lead + token.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[°*:\\]/g, "/");
    },
  );
}

/** Read one header cell's text. Several facts can come from one cell ("Mon 3"). */
export function parseHeaderText(raw: string): HeaderToken {
  const text = normaliseNumericDate(String(raw ?? "").replace(/\s+/g, " ").trim());
  const token: HeaderToken = { text };
  if (!text) return token;
  const lower = text.toLowerCase();

  const weekday = lower.match(/\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?|mo|tu|we|th|fr|sa|su)\b/);
  if (weekday) token.weekday = WEEKDAYS[weekday[1]];

  let m = lower.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    if (isoFromParts(+m[1], +m[2], +m[3])) Object.assign(token, { year: +m[1], month: +m[2], day: +m[3] });
    return token;
  }
  m = lower.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const year = m[3] ? fullYear(+m[3]) : undefined;
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) Object.assign(token, { day: a, month: b, year });
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && a !== b) {
      if (token.day === undefined) Object.assign(token, { day: b, month: a, year });
      else Object.assign(token, { altDay: b, altMonth: a });
    }
    return token;
  }
  m = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/.]*(${MONTH_PATTERN})\\b[\\s\\-/.,']*(\\d{4}|\\d{2})?`));
  if (m) {
    token.day = +m[1];
    token.month = MONTHS[m[2]];
    if (m[3]) token.year = fullYear(+m[3]);
    return token;
  }
  m = lower.match(new RegExp(`\\b(${MONTH_PATTERN})[\\s\\-/.]*(\\d{1,2})\\b(?:[\\s,\\-/.']+(\\d{4}))?`));
  if (m && +m[2] >= 1 && +m[2] <= 31) {
    token.day = +m[2];
    token.month = MONTHS[m[1]];
    if (m[3]) token.year = +m[3];
    return token;
  }
  m = lower.match(new RegExp(`\\b(${MONTH_PATTERN})\\b[\\s\\-/.,']*(\\d{4}|\\d{2})?`));
  if (m) {
    token.month = MONTHS[m[1]];
    if (m[2]) token.year = fullYear(+m[2]);
    return token;
  }
  const words = text.split(/[\s,]+/).map(numericLookalikes);
  const day = words.find((w) => /^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31);
  if (day) token.day = +day;
  return token;
}

/** Month/year mentioned in free text (title, banner), e.g. "ICU Roster November 2026". */
export function parseMonthMention(raw: string): { month: number; year?: number } | null {
  const lower = String(raw ?? "").toLowerCase();
  // A two-digit year must be attached to the month ("Nov-26", "Nov '26");
  // "Dec 21" in a run of date headers is a day, not the year 2021.
  const m = lower.match(new RegExp(`\\b(${MONTH_PATTERN})\\b(?:[\\s,]*(\\d{4})\\b|[-'/](\\d{2})\\b)?`));
  if (m) {
    const year = m[2] ? +m[2] : m[3] ? fullYear(+m[3]) : undefined;
    return { month: MONTHS[m[1]], year };
  }
  const n = lower.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if (n) return { month: +n[1], year: +n[2] };
  return null;
}

type Constraint = {
  day?: number;
  month?: number;
  year?: number;
  weekday?: number;
  altDay?: number;
  altMonth?: number;
  readable: boolean;
  text: string;
};

function constraintsFor(column: AxisColumn): Constraint {
  const out: Constraint = {
    readable: false,
    text: [column.dateText, ...column.texts].filter(Boolean).join(" / "),
  };
  // The day number only ever comes from the date line itself; a stray digit
  // misread in the weekday line must not become this column's date.
  const main = parseHeaderText(column.dateText);
  if (main.day !== undefined) {
    out.day = main.day;
    out.altDay = main.altDay;
    out.altMonth = main.altMonth;
    out.month = main.month;
    out.year = main.year;
  }
  out.weekday = main.weekday;
  for (const text of column.texts) {
    const t = parseHeaderText(text);
    if (t.day === undefined && t.weekday !== undefined && out.weekday === undefined) out.weekday = t.weekday;
  }
  if (column.banner) {
    out.month ??= column.banner.month;
    out.year ??= column.banner.year;
  }
  out.readable = out.day !== undefined;
  return out;
}

/**
 * How well "column i is start + i days" fits the readings. `agree` counts
 * columns whose day number matches; `support` also counts columns whose day
 * was unreadable or misread but whose weekday matches the position.
 */
function scoreStart(start: string, constraints: Constraint[]): { score: number; agree: number; support: number } {
  let score = 0;
  let agree = 0;
  let support = 0;
  constraints.forEach((c, i) => {
    const iso = addDays(start, i);
    const [y, m, d] = iso.split("-").map(Number);
    let dayOk = false;
    if (c.day !== undefined) {
      const primary = c.day === d && (c.month === undefined || c.month === m) && (c.year === undefined || c.year === y);
      const alt = c.altDay === d && c.altMonth === m && (c.year === undefined || c.year === y);
      dayOk = primary || alt;
      if (dayOk) {
        score += 2;
        agree += 1;
      } else score -= 1;
    } else if (c.month !== undefined && c.month !== m) score -= 1;
    const weekdayOk = c.weekday !== undefined && c.weekday === weekdayOf(iso);
    if (c.weekday !== undefined) score += weekdayOk ? 1 : -1;
    if (dayOk || weekdayOk) support += 1;
  });
  return { score, agree, support };
}

function monthSpan(center: { year: number; month: number }, radius: number) {
  const out: { year: number; month: number }[] = [];
  for (let k = -radius; k <= radius; k += 1) {
    const total = center.year * 12 + (center.month - 1) + k;
    out.push({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  }
  return out;
}

/**
 * Assign a calendar date to every date column.
 *
 * @param columns  header readings per date column, in axis order
 * @param title    month/year mentioned outside the table (title row), if any
 * @param fallback month used only when the roster never states one
 */
export function inferDateAxis(
  columns: AxisColumn[],
  title: { month: number; year?: number } | null,
  fallback: { year: number; month: number },
): DateAxisResult {
  const constraints = columns.map(constraintsFor);
  const readable = constraints.filter((c) => c.readable).length;
  const issues: string[] = [];
  if (!columns.length) return { dates: [], issues: ["No date columns found."], monthAssumed: true, mode: "consecutive" };

  const statedMonth = constraints.some((c) => c.month !== undefined) || !!title;
  const statedYear = constraints.some((c) => c.year !== undefined) || !!title?.year;
  const centre = title
    ? { year: title.year ?? fallback.year, month: title.month }
    : (() => {
        const first = constraints.find((c) => c.month !== undefined);
        return first ? { year: first.year ?? fallback.year, month: first.month! } : fallback;
      })();

  // Candidate anchors: every readable column, under every plausible month.
  const candidates = new Set<string>();
  const searchMonths = monthSpan(centre, statedMonth ? (statedYear ? 1 : 13) : 13);
  constraints.forEach((c, i) => {
    if (!c.readable) return;
    const options: { year: number; month: number; day: number }[] = [];
    if (c.month !== undefined) {
      const years = c.year !== undefined ? [c.year] : [centre.year - 1, centre.year, centre.year + 1];
      for (const y of years) options.push({ year: y, month: c.month, day: c.day! });
      if (c.altMonth !== undefined)
        for (const y of years) options.push({ year: y, month: c.altMonth, day: c.altDay! });
    } else {
      for (const ym of searchMonths) options.push({ ...ym, day: c.day! });
    }
    for (const o of options) {
      const iso = isoFromParts(o.year, o.month, o.day);
      if (iso) candidates.add(addDays(iso, -i));
    }
  });

  let best: { start: string; score: number; agree: number; support: number; distance: number } | null = null;
  const scored: { start: string; score: number }[] = [];
  for (const start of candidates) {
    const { score, agree, support } = scoreStart(start, constraints);
    scored.push({ start, score });
    const [y, m] = start.split("-").map(Number);
    const distance = Math.abs(y * 12 + m - (centre.year * 12 + centre.month));
    if (
      !best ||
      score > best.score ||
      (score === best.score && distance < best.distance) ||
      (score === best.score && distance === best.distance && start < best.start)
    )
      best = { start, score, agree, support, distance };
  }

  // Misread headers rarely agree on a common start date by chance, so on a
  // long roster 40% of readable headers agreeing is strong evidence (the rest
  // are flagged). Short rosters need a clear majority.
  const needed = Math.max(Math.min(3, readable), Math.ceil(readable * (readable >= 14 ? 0.4 : 0.6)));
  const accepted =
    !!best &&
    readable > 0 &&
    (best.agree >= needed ||
      // Matching weekdays vouch for columns whose number was misread.
      (best.agree >= Math.min(3, readable) && best.support >= Math.ceil(columns.length * 0.8)));
  if (best && accepted) {
    const hasWeekdays = constraints.filter((c) => c.weekday !== undefined).length >= 3;
    // Without a stated month, weekdays only pin the month down if no other
    // month fits them equally well.
    const ties = scored.filter((c) => c.score === best!.score && c.start !== best!.start).length;
    const monthAssumed = !statedMonth && (!hasWeekdays || ties > 0);
    if (monthAssumed) {
      issues.push(
        "The roster does not show the month or year; dates were placed in the nearest matching month. Check the date range.",
      );
    } else if (!statedYear && !hasWeekdays) {
      issues.push("The roster does not show the year; check the date range.");
    }
    const dates: ColumnDate[] = constraints.map((c, i) => {
      const iso = addDays(best!.start, i);
      const [, m, d] = iso.split("-").map(Number);
      if (!c.readable) {
        return { iso, status: "derived", note: c.text ? `Header read as "${c.text}"; date taken from column position.` : "Date header unreadable; date taken from column position." };
      }
      const ok =
        (c.day === d && (c.month === undefined || c.month === m)) ||
        (c.altDay === d && c.altMonth === m);
      if (!ok) {
        return { iso, status: "derived", note: `Header read as "${c.text}" but its position is ${iso}; check this column.` };
      }
      if (c.weekday !== undefined && c.weekday !== weekdayOf(iso)) {
        return { iso, status: "derived", note: `Weekday in header does not match ${iso}; check this column.` };
      }
      return { iso, status: "read" };
    });
    const misaligned = dates.filter((d) => d.status === "derived").length;
    if (misaligned) issues.push(`${misaligned} date column${misaligned === 1 ? "" : "s"} could not be confirmed from the header.`);
    return { dates, issues, monthAssumed, mode: "consecutive" };
  }

  // Not consecutive (for example weekdays only, or skipped dates): take every
  // column as read, rolling the month forward when the day number drops.
  const dates: ColumnDate[] = [];
  let cursor = { ...centre };
  let previousDay = 0;
  const seen = new Set<string>();
  for (const c of constraints) {
    if (!c.readable) {
      dates.push({ iso: null, status: "derived", note: "Date header unreadable." });
      continue;
    }
    if (c.month !== undefined) cursor = { year: c.year ?? cursor.year, month: c.month };
    else if (c.day! < previousDay) cursor = monthSpan(cursor, 1)[2];
    previousDay = c.day!;
    const iso = isoFromParts(cursor.year, cursor.month, c.day!);
    if (!iso) {
      dates.push({ iso: null, status: "derived", note: `"${c.text}" is not a valid date.` });
      continue;
    }
    if (seen.has(iso)) {
      dates.push({ iso, status: "derived", note: `${iso} appears in more than one column.` });
      continue;
    }
    seen.add(iso);
    // Without a consistent day-by-day sequence nothing confirms the column
    // order, so every date in this mode must be checked by the user.
    dates.push({ iso, status: "derived", note: `Header read as "${c.text}"; dates are not consecutive, so check this column.` });
  }
  issues.push("Date columns are not consecutive; gaps or repeated dates were found. Check every date.");
  if (!statedMonth) issues.push("The roster does not show the month; check the date range.");
  return { dates, issues, monthAssumed: !statedMonth, mode: "as-read" };
}
