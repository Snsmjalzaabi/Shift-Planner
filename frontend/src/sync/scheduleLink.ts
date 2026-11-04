// Device wiring for the hospital schedule-link sync (Foxory Plus).
//
// Runs when the user taps "Sync now", when the app opens (if the last sync is
// over 20 hours old), and once a day in the background. Background runs read
// Excel rosters only; image rosters need on-device OCR and are synced the
// next time the app is opened.

import * as BackgroundTask from "expo-background-task";
import { File, Paths } from "expo-file-system";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import readExcelFile from "read-excel-file/universal";

import { api, AuthUser } from "@/src/lib/api";
import { createDeviceOcrEngine, loadRosterImage } from "@/src/roster/device";
import { GridSource } from "@/src/roster/extract";
import { createImageGridSource } from "@/src/roster/imageSource";
import { SyncResult, syncSchedule } from "@/src/roster/scheduleSync";
import { downloadRosterFile, listRosterFiles, parseScheduleLink, RosterFile } from "@/src/roster/sharepoint";
import { createSheetGridSource } from "@/src/roster/sheetSource";
import { buildTable } from "@/src/roster/table";
import { loadCachedUser, loadToken } from "@/src/utils/authStorage";
import { storage } from "@/src/utils/storage";

import { graphFetch } from "./microsoftAuth";

export const SYNC_TASK = "foxory-schedule-link-sync";
const SETTINGS_KEY = "foxory_schedule_link";
const DAY_MS = 86_400_000;

export type ScheduleLinkSettings = {
  link: string;
  /** Row name the user confirmed; the stable identity for imported shifts. */
  employeeName: string | null;
  lastSyncAt: string | null;
  lastResult: Omit<SyncResult, "employees"> | null;
  lastError: string | null;
};

export async function loadScheduleLink(): Promise<ScheduleLinkSettings | null> {
  const raw = await storage.getItem<string>(SETTINGS_KEY, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ScheduleLinkSettings;
  } catch {
    return null;
  }
}

async function saveScheduleLink(settings: ScheduleLinkSettings) {
  await storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function setScheduleLink(link: string): Promise<ScheduleLinkSettings> {
  parseScheduleLink(link); // throws a readable error for a bad link
  const previous = await loadScheduleLink();
  const settings: ScheduleLinkSettings = {
    link: link.trim(),
    employeeName: previous?.link === link.trim() ? previous.employeeName : null,
    lastSyncAt: null,
    lastResult: null,
    lastError: null,
  };
  await saveScheduleLink(settings);
  return settings;
}

export async function setScheduleEmployee(employeeName: string) {
  const settings = await loadScheduleLink();
  if (settings) await saveScheduleLink({ ...settings, employeeName });
}

export async function clearScheduleLink() {
  await storage.removeItem(SETTINGS_KEY);
  if (Platform.OS === "web") return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  } catch {
    // Nothing scheduled.
  }
}

export function isPlusUser(user: Pick<AuthUser, "plan" | "is_superuser"> | null | undefined): boolean {
  return !!user && (user.plan === "plus" || !!user.is_superuser);
}

/** Download a roster from the folder and open it as one grid per sheet. */
async function readRoster(file: RosterFile, allowOcr: boolean): Promise<GridSource[] | null> {
  if (file.kind === "image" && !allowOcr) return null;
  const bytes = await downloadRosterFile(graphFetch, file);
  if (file.kind === "xlsx") {
    const sheets = await readExcelFile(bytes);
    return sheets.map((sheet) => createSheetGridSource(sheet.data, sheet.sheet));
  }
  const ext = file.name.toLowerCase().endsWith(".png") ? "png" : "jpg";
  const temp = new File(Paths.cache, `roster-sync-${Date.now()}.${ext}`);
  try {
    temp.write(new Uint8Array(bytes));
    const engine = await createDeviceOcrEngine();
    if (!engine) return null;
    const image = await loadRosterImage(temp.uri);
    const table = buildTable(image);
    return table ? [createImageGridSource(image, table, engine)] : null;
  } finally {
    try {
      temp.delete();
    } catch {
      // cache is cleared by the OS
    }
  }
}

/** The newest roster file in the folder, downloaded to the cache (for the review screen). */
export async function downloadNewestRoster(link: string): Promise<{ uri: string; name: string; kind: RosterFile["kind"] }> {
  const [file] = await listRosterFiles(graphFetch, link, { max: 1 });
  const bytes = await downloadRosterFile(graphFetch, file);
  const target = new File(Paths.cache, `roster-review-${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`);
  target.write(new Uint8Array(bytes));
  return { uri: target.uri, name: file.name, kind: file.kind };
}

export async function runScheduleSync(options: {
  token: string;
  user: AuthUser;
  background?: boolean;
}): Promise<{ settings: ScheduleLinkSettings; result: SyncResult | null }> {
  const settings = await loadScheduleLink();
  if (!settings) throw new Error("Add your schedule link first.");
  if (!isPlusUser(options.user)) throw new Error("Schedule-link sync is part of Foxory Plus.");
  const now = new Date();
  try {
    const result = await syncSchedule(
      {
        listFiles: () => listRosterFiles(graphFetch, settings.link),
        readFile: (file) => readRoster(file, !options.background),
        fetchExisting: async (months) => {
          const all = await Promise.all(months.map((m) => api.listShifts(options.token, m)));
          return all.flat();
        },
        api: {
          create: (body) => api.createShift(options.token, body),
          update: (id, body) => api.updateShift(options.token, id, body),
        },
        fallbackMonth: { year: now.getFullYear(), month: now.getMonth() + 1 },
      },
      { employeeName: settings.employeeName, displayName: options.user.display_name ?? null },
    );
    const { employees: _employees, ...summary } = result;
    const next: ScheduleLinkSettings = {
      ...settings,
      employeeName: result.employeeName ?? settings.employeeName,
      lastSyncAt: now.toISOString(),
      lastResult: summary,
      lastError: null,
    };
    await saveScheduleLink(next);
    return { settings: next, result };
  } catch (error: any) {
    const next = { ...settings, lastError: error?.message || "Sync failed." };
    await saveScheduleLink(next);
    throw error;
  }
}

/** Sync on app open when the last successful sync is older than ~a day. */
export async function syncIfDue(token: string, user: AuthUser): Promise<SyncResult | null> {
  const settings = await loadScheduleLink();
  if (!settings || !isPlusUser(user)) return null;
  const last = settings.lastSyncAt ? Date.parse(settings.lastSyncAt) : 0;
  if (Date.now() - last < DAY_MS * 0.83) return null;
  try {
    return (await runScheduleSync({ token, user })).result;
  } catch {
    return null; // shown on the Import screen from lastError
  }
}

export async function registerDailySync() {
  if (Platform.OS === "web") return;
  try {
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 24 * 60 });
  } catch {
    // Background tasks unavailable (e.g. restricted by the OS); sync on open still runs.
  }
}

// Must be defined at module load (imported from the root layout) so the OS
// can run it while the app is in the background.
if (Platform.OS !== "web" && !TaskManager.isTaskDefined(SYNC_TASK)) {
  TaskManager.defineTask(SYNC_TASK, async () => {
    try {
      const token = await loadToken();
      const cached = await loadCachedUser();
      if (!token || !cached) return BackgroundTask.BackgroundTaskResult.Success;
      const user = JSON.parse(cached) as AuthUser;
      await runScheduleSync({ token, user, background: true });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
