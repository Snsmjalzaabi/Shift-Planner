// Review-screen state for one roster import: detected employee, every date
// column with its original code, and what will happen on import.

import { normaliseTypedCode } from "./codes";
import { isoFromParts } from "./dates";
import { ExtractedCell } from "./extract";
import { CalendarShift, ImportItem, PlannedAction, planImport } from "./importPlan";

export type ReviewItem = {
  id: string;
  date: string;
  code: string;
  /** Text as read from the roster cell. */
  raw: string;
  status: ExtractedCell["status"];
  issues: string[];
  selected: boolean;
  /** Uncertain rows must be checked (or excluded) before import. */
  acknowledged: boolean;
};

export function toReviewItems(cells: ExtractedCell[]): ReviewItem[] {
  return cells.map((cell, index) => ({
    id: `${index}-${cell.row}-${cell.col}`,
    date: cell.date ?? "",
    code: cell.code ?? "",
    raw: cell.raw.trim(),
    status: cell.status,
    issues: cell.issues,
    // Blank cells stay blank: never imported, never treated as a day off.
    selected: cell.status !== "blank",
    acknowledged: cell.status === "detected",
  }));
}

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return !!m && !!isoFromParts(+m[1], +m[2], +m[3]);
}

export function itemProblems(item: ReviewItem): string[] {
  if (!item.selected) return [];
  const problems: string[] = [];
  if (!isValidIsoDate(item.date)) problems.push("Enter a valid date (YYYY-MM-DD).");
  if (!normaliseTypedCode(item.code)) problems.push("Enter the roster code.");
  if (!item.acknowledged) problems.push("Check this row against the roster.");
  return problems;
}

export function importItems(items: ReviewItem[]): ImportItem[] {
  return items
    .filter((item) => item.selected && itemProblems(item).length === 0)
    .map((item) => ({ date: item.date.trim(), code: normaliseTypedCode(item.code)! }));
}

export function monthsCovered(items: ReviewItem[]): string[] {
  const months = new Set<string>();
  for (const item of items) if (isValidIsoDate(item.date)) months.add(item.date.slice(0, 7));
  return [...months].sort();
}

export function reviewCounts(items: ReviewItem[], plan: PlannedAction[]) {
  const selected = items.filter((i) => i.selected);
  return {
    detected: items.filter((i) => i.status === "detected").length,
    uncertain: items.filter((i) => i.status === "uncertain").length,
    blank: items.filter((i) => i.status === "blank").length,
    skipped: items.filter((i) => !i.selected).length,
    unresolved: selected.filter((i) => itemProblems(i).length > 0).length,
    duplicates:
      plan.filter((a) => a.kind === "unchanged" || a.kind === "duplicate").length,
    conflicts: plan.filter((a) => a.kind === "conflict").length,
    toCreate: plan.filter((a) => a.kind === "create").length,
  };
}

export function buildPlan(employee: string, items: ReviewItem[], existing: CalendarShift[]): PlannedAction[] {
  return planImport(employee, importItems(items), existing);
}
