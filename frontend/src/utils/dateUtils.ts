export type CalendarCell = {
  date: string; // YYYY-MM-DD
  dayNum: number;
  inMonth: boolean;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function ymd(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

export function ym(year: number, month0: number): string {
  return `${year}-${pad(month0 + 1)}`;
}

export function todayIso(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

export function currentMonthKey(): string {
  const d = new Date();
  return ym(d.getFullYear(), d.getMonth());
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export function buildMonthGrid(year: number, month0: number): CalendarCell[] {
  const first = new Date(year, month0, 1);
  const startWeekday = first.getDay(); // 0 (Sun) - 6 (Sat)
  const total = daysInMonth(year, month0);
  const prevMonthDays = daysInMonth(year, month0 - 1);

  const cells: CalendarCell[] = [];
  // preceding
  for (let i = startWeekday - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const d = new Date(year, month0 - 1, dayNum);
    cells.push({
      date: ymd(d.getFullYear(), d.getMonth(), d.getDate()),
      dayNum,
      inMonth: false,
    });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ date: ymd(year, month0, d), dayNum: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const idx = cells.length - (startWeekday + total) + 1;
    const d = new Date(year, month0 + 1, idx);
    cells.push({
      date: ymd(d.getFullYear(), d.getMonth(), d.getDate()),
      dayNum: idx,
      inMonth: false,
    });
  }
  return cells;
}

export function monthLabel(year: number, month0: number): string {
  return new Date(year, month0, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function shiftDateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
