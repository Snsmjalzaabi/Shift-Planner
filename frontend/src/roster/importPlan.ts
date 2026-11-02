// Idempotent import of confirmed roster assignments into the calendar.
//
// Each imported assignment carries an import key built from the employee and
// the calendar date. Re-importing the same roster finds the existing entry by
// that key and leaves it alone; a different code on a date that already has
// an entry is a conflict the user resolves (keep or replace). Nothing that the
// user did not choose to replace is ever modified or deleted.

import { codeToCalendarType } from "./codes";

export type CalendarShift = {
  id: string;
  date: string;
  type: string;
  code?: string | null;
  import_key?: string | null;
};

export type ImportItem = { date: string; code: string };

export type PlannedAction =
  | { kind: "create"; item: ImportItem; key: string }
  | { kind: "unchanged"; item: ImportItem; key: string; existing: CalendarShift }
  | { kind: "conflict"; item: ImportItem; key: string; existing: CalendarShift[] }
  | { kind: "duplicate"; item: ImportItem; key: string };

export type Resolution = "keep" | "replace";

export function employeeSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function importKey(employee: string, date: string): string {
  return `roster:${employeeSlug(employee)}:${date}`;
}

/** Label shown for an existing entry: its roster code when it has one. */
export function shiftDisplayCode(shift: Pick<CalendarShift, "code" | "type">): string {
  if (shift.code) return shift.code;
  return { day: "Day", night: "Night", on_call: "On Call", off: "Off" }[shift.type] ?? shift.type;
}

export function planImport(employee: string, items: ImportItem[], existing: CalendarShift[]): PlannedAction[] {
  const byDate = new Map<string, CalendarShift[]>();
  for (const shift of existing) byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);
  const seen = new Set<string>();
  return items.map((item) => {
    const key = importKey(employee, item.date);
    if (seen.has(item.date)) return { kind: "duplicate", item, key };
    seen.add(item.date);
    const sameDay = byDate.get(item.date) ?? [];
    const previous = sameDay.find((s) => s.import_key === key);
    if (previous && previous.code === item.code)
      return { kind: "unchanged", item, key, existing: previous };
    if (sameDay.length) return { kind: "conflict", item, key, existing: sameDay };
    return { kind: "create", item, key };
  });
}

export type ImportApi = {
  create(body: {
    date: string;
    type: string;
    code: string;
    import_key: string;
    source: string;
    is_draft: boolean;
    start_time: null;
    end_time: null;
    note: null;
  }): Promise<CalendarShift>;
  update(id: string, body: { type: string; code: string; import_key: string }): Promise<CalendarShift>;
};

export type ImportResult = {
  created: number;
  replaced: number;
  kept: number;
  unchanged: number;
  skippedDuplicates: number;
  failed: { date: string; error: unknown }[];
};

/**
 * Apply a plan. Conflicts default to "keep". "replace" updates exactly one
 * existing entry: the one this roster created earlier, or the only entry on
 * that date. With several unrelated entries on the date nothing is replaced.
 */
export async function applyImport(
  plan: PlannedAction[],
  resolutions: Record<string, Resolution>,
  api: ImportApi,
  source: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, replaced: 0, kept: 0, unchanged: 0, skippedDuplicates: 0, failed: [] };
  for (const action of plan) {
    const { item, key } = action;
    try {
      if (action.kind === "unchanged") {
        result.unchanged += 1;
      } else if (action.kind === "duplicate") {
        result.skippedDuplicates += 1;
      } else if (action.kind === "create") {
        await api.create({
          date: item.date,
          type: codeToCalendarType(item.code),
          code: item.code,
          import_key: key,
          source,
          is_draft: true,
          start_time: null,
          end_time: null,
          note: null,
        });
        result.created += 1;
      } else {
        const target = replaceTarget(action);
        if (resolutions[item.date] === "replace" && target) {
          await api.update(target.id, { type: codeToCalendarType(item.code), code: item.code, import_key: key });
          result.replaced += 1;
        } else {
          result.kept += 1;
        }
      }
    } catch (error) {
      result.failed.push({ date: item.date, error });
    }
  }
  return result;
}

export function replaceTarget(action: Extract<PlannedAction, { kind: "conflict" }>): CalendarShift | null {
  return action.existing.find((s) => s.import_key === action.key) ?? (action.existing.length === 1 ? action.existing[0] : null);
}
