// Daily sync of the signed-in user's row from a hospital schedule folder.
//
// For each of the newest roster files: find the user's row (by the name they
// confirmed once, or their account name), read only that row, and bring the
// calendar in line with it:
// - dates read with confidence are added, or updated if this sync added them
//   before and the roster has changed since;
// - entries the user made themselves are never changed or deleted;
// - uncertain cells are never saved automatically: they are returned for the
//   user to review;
// - other employees' rows are never read past their name.
// Platform work (Graph, file decoding, OCR, the Foxory API) is injected.

import { analyseRoster, EmployeeRow, extractEmployee, GridSource, suggestEmployee } from "./extract";
import { applyImport, CalendarShift, ImportApi, ImportItem, importKey, planImport, replaceTarget, Resolution } from "./importPlan";
import { RosterFile } from "./sharepoint";

export const SYNC_SOURCE = "schedule-link";

export type SyncDeps = {
  listFiles(): Promise<RosterFile[]>;
  /**
   * Grids for a file (one per Excel sheet), or null when it cannot be read
   * here (e.g. an image during background sync, where OCR is not run).
   */
  readFile(file: RosterFile): Promise<GridSource[] | null>;
  fetchExisting(months: string[]): Promise<CalendarShift[]>;
  api: ImportApi;
  fallbackMonth: { year: number; month: number };
};

export type SyncInput = {
  /** Name of the row the user confirmed earlier; used as the stable identity. */
  employeeName: string | null;
  /** Account display name, used to find the row the first time. */
  displayName: string | null;
};

export type ReviewNeeded = { date: string | null; raw: string; issues: string[]; file: string };

export type SyncResult = {
  status: "synced" | "needs-employee";
  employeeName: string | null;
  files: { name: string; modified: string; read: boolean; matched: boolean }[];
  added: number;
  updated: number;
  unchanged: number;
  kept: number;
  failed: number;
  needsReview: ReviewNeeded[];
  /** Names found, when the user's row could not be identified. */
  employees: string[];
};

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)|\{.*?\}/g, " ")
    .replace(/[^a-z؀-ۿ]+/g, " ")
    .trim();
}

export function findUserRow(
  employees: EmployeeRow[],
  input: SyncInput,
): EmployeeRow | null {
  if (input.employeeName) {
    const wanted = normaliseName(input.employeeName);
    const exact = employees.filter((e) => normaliseName(e.name) === wanted);
    if (exact.length === 1) return exact[0];
    const close = suggestEmployee(employees, input.employeeName);
    if (close) return close;
  }
  return suggestEmployee(employees, input.displayName);
}

export async function syncSchedule(deps: SyncDeps, input: SyncInput): Promise<SyncResult> {
  const result: SyncResult = {
    status: "synced",
    employeeName: input.employeeName,
    files: [],
    added: 0,
    updated: 0,
    unchanged: 0,
    kept: 0,
    failed: 0,
    needsReview: [],
    employees: [],
  };
  const files = await deps.listFiles(); // newest first
  const chosen = new Map<string, ImportItem>();
  const reviewDates = new Set<string>();
  let anyMatched = false;

  for (const file of files) {
    const entry = { name: file.name, modified: file.modified, read: false, matched: false };
    result.files.push(entry);
    const sources = await deps.readFile(file);
    if (!sources) continue;
    const decided = new Set<string>([...chosen.keys(), ...reviewDates]);
    for (const source of sources) {
      const { analysis } = await analyseRoster(source, { fallback: deps.fallbackMonth });
      if (!analysis) continue;
      entry.read = true;
      const row = findUserRow(analysis.employees, { ...input, employeeName: result.employeeName });
      if (!row) {
        for (const e of analysis.employees) if (!result.employees.includes(e.name)) result.employees.push(e.name);
        continue;
      }
      entry.matched = true;
      anyMatched = true;
      // The first confirmed name stays the identity, so a slightly different
      // OCR reading of the name in a later file cannot create duplicates.
      result.employeeName ??= row.name;
      const cells = await extractEmployee(source, analysis, row.line);
      for (const cell of cells) {
        if (cell.status === "blank" || !cell.date) continue;
        // A newer file already decided this date.
        if (decided.has(cell.date) || chosen.has(cell.date) || reviewDates.has(cell.date)) continue;
        if (cell.status === "detected" && cell.dateStatus === "read" && cell.code) {
          chosen.set(cell.date, { date: cell.date, code: cell.code });
        } else {
          reviewDates.add(cell.date);
          result.needsReview.push({ date: cell.date, raw: cell.raw.trim(), issues: cell.issues, file: file.name });
        }
      }
    }
  }

  if (!anyMatched) {
    result.status = "needs-employee";
    return result;
  }

  const items = [...chosen.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!items.length) return result;
  const months = [...new Set(items.map((i) => i.date.slice(0, 7)))];
  const existing = await deps.fetchExisting(months);
  const employee = result.employeeName!;
  const plan = planImport(employee, items, existing);
  const resolutions: Record<string, Resolution> = {};
  for (const action of plan) {
    if (action.kind !== "conflict") continue;
    // Replace only entries this roster created earlier (same import key).
    const target = replaceTarget(action);
    if (target && target.import_key === importKey(employee, action.item.date)) resolutions[action.item.date] = "replace";
  }
  const applied = await applyImport(plan, resolutions, deps.api, SYNC_SOURCE);
  result.added = applied.created;
  result.updated = applied.replaced;
  result.unchanged = applied.unchanged;
  result.kept = applied.kept;
  result.failed = applied.failed.length;
  return result;
}
