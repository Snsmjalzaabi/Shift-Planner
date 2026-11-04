import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import readExcelFile from "read-excel-file/universal";

import { DashboardHeader } from "@/src/components/DashboardHeader";
import { useAuth } from "@/src/context/AuthContext";
import { api, isPlusRequired } from "@/src/lib/api";
import { KNOWN_CODES, normaliseTypedCode } from "@/src/roster/codes";
import { createDeviceOcrEngine, loadRosterImage } from "@/src/roster/device";
import {
  analyseRoster,
  EmployeeRow,
  extractEmployee,
  GridSource,
  RosterAnalysis,
  suggestEmployee,
  summarise,
} from "@/src/roster/extract";
import { createImageGridSource } from "@/src/roster/imageSource";
import {
  applyImport,
  CalendarShift,
  PlannedAction,
  replaceTarget,
  Resolution,
  shiftDisplayCode,
} from "@/src/roster/importPlan";
import {
  buildPlan,
  itemProblems,
  monthsCovered,
  ReviewItem,
  reviewCounts,
  toReviewItems,
} from "@/src/roster/session";
import { createSheetGridSource } from "@/src/roster/sheetSource";
import { buildTable } from "@/src/roster/table";
import { onIncomingFile, takeIncomingFile } from "@/src/sync/incomingFile";
import {
  isMicrosoftConfigured,
  microsoftAccount,
  MicrosoftAuthError,
  signInWithMicrosoft,
  signOutMicrosoft,
} from "@/src/sync/microsoftAuth";
import {
  clearScheduleLink,
  downloadNewestRoster,
  isPlusUser,
  loadScheduleLink,
  runScheduleSync,
  ScheduleLinkSettings,
  setScheduleEmployee,
  setScheduleLink,
} from "@/src/sync/scheduleLink";
import { colors, radius, spacing } from "@/src/theme/colors";

type Stage = "source" | "employee" | "review";

type Loaded = {
  source: GridSource;
  analysis: RosterAnalysis;
  name: string;
  kind: "roster-image" | "roster-xlsx";
  image?: { uri: string; width: number; height: number };
  /** Opened from the saved schedule link: the confirmed row is remembered for sync. */
  fromLink?: boolean;
};

export default function ImportScheduleScreen() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("source");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [employeeLine, setEmployeeLine] = useState<number | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [existing, setExisting] = useState<CalendarShift[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState<"image" | "xlsx" | "row" | "saving" | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentRoster, setCurrentRoster] = useState<{
    today_count: number;
    total: number;
    loaded: boolean;
  } | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [link, setLink] = useState<ScheduleLinkSettings | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkAccount, setLinkAccount] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const progressAt = useRef(0);
  const isPlus = isPlusUser(user);
  const linkAvailable = Platform.OS !== "web";

  const plan: PlannedAction[] = useMemo(
    () => (stage === "review" ? buildPlan(employeeName, items, existing) : []),
    [stage, employeeName, items, existing],
  );
  const counts = useMemo(() => reviewCounts(items, plan), [items, plan]);
  const planByDate = useMemo(() => {
    const map = new Map<string, PlannedAction>();
    for (const action of plan) if (!map.has(action.item.date)) map.set(action.item.date, action);
    return map;
  }, [plan]);
  const range = useMemo(() => {
    const dates = items.map((i) => i.date).filter(Boolean).sort();
    return dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "";
  }, [items]);
  const writes = plan.filter(
    (a) => a.kind === "create" || (a.kind === "conflict" && resolutions[a.item.date] === "replace"),
  ).length;
  const canSave = stage === "review" && counts.unresolved === 0 && writes > 0 && !busy;

  // Throttle progress text so the UI is not re-rendered for every cell.
  const report = (message: string) => {
    const now = Date.now();
    if (now - progressAt.current > 250) {
      progressAt.current = now;
      setProgress(message);
    }
  };

  const fallbackMonth = () => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  };

  const startAnalysis = async (
    source: GridSource,
    name: string,
    kind: Loaded["kind"],
    image?: Loaded["image"],
    fromLink = false,
  ) => {
    const { analysis, error: problem } = await analyseRoster(source, {
      fallback: fallbackMonth(),
      progress: report,
    });
    if (!analysis) {
      setError(problem ?? "The roster could not be read.");
      return;
    }
    if (!analysis.employees.length) {
      setError("A date header was found, but no employee rows below it.");
      return;
    }
    setLoaded({ source, analysis, name, kind, image, fromLink });
    // Pre-select the row that matches the signed-in user's name (or the row
    // they confirmed for their schedule link); the user still confirms it.
    const remembered = fromLink ? link?.employeeName : null;
    const suggested =
      (remembered ? suggestEmployee(analysis.employees, remembered) : null) ??
      suggestEmployee(analysis.employees, user?.display_name);
    setEmployeeLine(suggested?.line ?? null);
    setEmployeeName(suggested?.name ?? "");
    setStage("employee");
  };

  const openImage = async (
    uri: string,
    name: string,
    size?: { width?: number; height?: number },
    fromLink = false,
  ) => {
    setBusy("image");
    setProgress("Finding the table…");
    const engine = await createDeviceOcrEngine();
    if (!engine) {
      setError("Text recognition is not available on this device. Try importing an Excel file instead.");
      return;
    }
    const image = await loadRosterImage(uri, size);
    const table = buildTable(image);
    if (!table) {
      setError(
        "No table grid was found. Use a straight, uncropped screenshot of the roster with its row and column lines visible.",
      );
      return;
    }
    const source = createImageGridSource(image, table, engine);
    await startAnalysis(source, name, "roster-image", { uri, width: image.width, height: image.height }, fromLink);
  };

  const openWorkbook = async (data: ArrayBuffer, name: string, fromLink = false) => {
    setBusy("xlsx");
    const sheets = await readExcelFile(data);
    let lastError = "No dates were found in the workbook.";
    for (const sheet of sheets) {
      const source = createSheetGridSource(sheet.data, sheet.sheet);
      const { analysis, error: problem } = await analyseRoster(source, { fallback: fallbackMonth() });
      if (analysis && analysis.employees.length) {
        await startAnalysis(source, name, "roster-xlsx", undefined, fromLink);
        return;
      }
      if (problem) lastError = problem;
    }
    setError(lastError);
  };

  /** A roster file opened from another app, or downloaded from the schedule link. */
  const openFile = async (file: { uri: string; name: string; kind: "xlsx" | "image" }, fromLink = false) => {
    setError(null);
    setStage("source");
    try {
      if (file.kind === "image") {
        await openImage(file.uri, file.name, undefined, fromLink);
        return;
      }
      try {
        await openWorkbook(await new File(file.uri).arrayBuffer(), file.name, fromLink);
      } catch (caught) {
        // Android may hand over an image without a file extension.
        if (file.uri.startsWith("content://")) await openImage(file.uri, file.name, undefined, fromLink);
        else throw caught;
      }
    } catch (caught: any) {
      setError(caught?.message || "This file could not be opened as a roster.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  // Files opened into Foxory ("Open in Foxory") arrive here.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  useEffect(() => {
    const pending = takeIncomingFile();
    if (pending) openFileRef.current(pending);
    return onIncomingFile(() => {
      const file = takeIncomingFile();
      if (file) openFileRef.current(file);
    });
  }, []);

  const refreshLink = useCallback(async () => {
    if (!linkAvailable) return;
    const settings = await loadScheduleLink();
    setLink(settings);
    setLinkInput(settings?.link ?? "");
    setLinkAccount(settings ? await microsoftAccount() : null);
  }, [linkAvailable]);
  useEffect(() => {
    refreshLink();
  }, [refreshLink]);

  const describeSync = (settings: ScheduleLinkSettings | null) => {
    const r = settings?.lastResult;
    if (!settings?.lastSyncAt || !r) return null;
    const when = new Date(settings.lastSyncAt).toLocaleString();
    const parts = [`${r.added} added`, `${r.updated} updated`, `${r.unchanged} unchanged`];
    if (r.needsReview.length) parts.push(`${r.needsReview.length} to review`);
    return `Last sync ${when} · ${parts.join(" · ")}`;
  };

  const syncLink = async () => {
    if (!token || !user) return;
    if (!isPlus) {
      router.push("/(app)/upgrade");
      return;
    }
    setLinkBusy(true);
    setLinkMessage(null);
    setError(null);
    try {
      if (!link || link.link !== linkInput.trim()) await setScheduleLink(linkInput);
      if (!(await microsoftAccount())) await signInWithMicrosoft();
      const { settings, result } = await runScheduleSync({ token, user });
      await refreshLink();
      if (result?.status === "needs-employee") {
        setLinkMessage("Choose your name once; future syncs will find it automatically.");
        await openFile(await downloadNewestRoster(settings.link), true);
        return;
      }
      setLinkMessage(describeSync(settings));
    } catch (caught: any) {
      await refreshLink();
      if (caught instanceof MicrosoftAuthError && caught.code === "cancelled") return;
      setError(caught?.message || "The schedule could not be synced.");
    } finally {
      setLinkBusy(false);
    }
  };

  const reviewLink = async () => {
    if (!link) return;
    setLinkBusy(true);
    try {
      await openFile(await downloadNewestRoster(link.link), true);
    } catch (caught: any) {
      setError(caught?.message || "The newest roster could not be opened.");
    } finally {
      setLinkBusy(false);
    }
  };

  const removeLink = async () => {
    await clearScheduleLink();
    await signOutMicrosoft();
    setLinkMessage(null);
    await refreshLink();
  };

  const readImage = async (mode: "camera" | "library") => {
    if (Platform.OS === "web") {
      setError("Photo recognition is available in the Android and iOS app.");
      return;
    }
    setError(null);
    try {
      if (mode === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError("Camera permission is required to photograph a schedule.");
          return;
        }
      }
      const result =
        mode === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      await openImage(asset.uri, asset.fileName || "Schedule image", { width: asset.width, height: asset.height });
    } catch (caught: any) {
      setError(caught?.message || "The schedule image could not be processed. Try a clearer image or the Excel import.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const readXlsx = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const data = asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
      await openWorkbook(data, asset.name || "Excel schedule");
    } catch (caught: any) {
      setError(caught?.message || "The Excel schedule could not be read.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const chooseEmployee = (employee: EmployeeRow) => {
    setEmployeeLine(employee.line);
    setEmployeeName(employee.name);
  };

  const readEmployeeRow = async () => {
    if (!loaded || employeeLine === null || !token) return;
    setBusy("row");
    setError(null);
    try {
      // Remember the confirmed row so the daily sync finds it by itself.
      if (loaded.fromLink && employeeName.trim()) await setScheduleEmployee(employeeName.trim());
      const cells = await extractEmployee(loaded.source, loaded.analysis, employeeLine, report);
      const summary = summarise(cells, loaded.analysis);
      const nextItems = toReviewItems(cells);
      const months = monthsCovered(nextItems);
      const shifts: CalendarShift[] = [];
      for (const month of months) shifts.push(...(await api.listShifts(token, month)));
      setItems(nextItems);
      setWarnings(summary.warnings);
      setExisting(shifts);
      setResolutions({});
      setStage("review");
    } catch (caught: any) {
      setError(caught?.message || "This row could not be read.");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  // "Current roster" import path: instead of picking up a photo or Excel
  // file, fetch the roster that is already on the backend and plot it on the
  // calendar. Used when the schedule is managed elsewhere and just needs to
  // be reflected on the calendar.
  const loadCurrentRoster = async () => {
    if (!token) return;
    setCurrentLoading(true);
    setError(null);
    try {
      const res = await api.currentShifts(token);
      setCurrentRoster({
        today_count: res.today_count,
        total: res.shifts.length,
        loaded: true,
      });
    } catch (caught: any) {
      setCurrentRoster(null);
      setError(caught?.message || "Could not fetch the current roster.");
    } finally {
      setCurrentLoading(false);
    }
  };

  const viewCalendar = () => {
    router.replace("/(app)/dashboard");
  };

  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const saveImport = async () => {
    if (!token || !canSave || !loaded) return;
    setBusy("saving");
    setError(null);
    try {
      // Roster codes must be stored as written; refuse to import into a
      // server that would silently drop them.
      const info = await api.serverInfo();
      if (!info.features?.includes("shift_code") || !info.features.includes("import_key")) {
        setError("The server needs an update before roster codes can be saved. Nothing was imported.");
        return;
      }
      const result = await applyImport(
        plan,
        resolutions,
        {
          create: (body) => api.createShift(token, body),
          update: (id, body) => api.updateShift(token, id, body),
        },
        loaded.kind,
      );
      const firstFailure = result.failed[0]?.error;
      if (firstFailure && isPlusRequired(firstFailure)) {
        router.push("/(app)/upgrade");
        return;
      }
      const lines = [
        `${result.created} added`,
        result.replaced ? `${result.replaced} replaced` : "",
        result.kept ? `${result.kept} kept as they were` : "",
        result.unchanged ? `${result.unchanged} already on the calendar` : "",
        result.failed.length ? `${result.failed.length} failed` : "",
      ].filter(Boolean);
      if (result.failed.length) {
        setError(`Import finished with errors: ${lines.join(" · ")}. Review and try again.`);
        const months = monthsCovered(items);
        const shifts: CalendarShift[] = [];
        for (const month of months) shifts.push(...(await api.listShifts(token, month)));
        setExisting(shifts);
        return;
      }
      Alert.alert("Import complete", `${employeeName}: ${lines.join(" · ")}.`, [
        { text: "View calendar", onPress: () => router.replace("/(app)/dashboard") },
      ]);
      reset();
    } catch (caught: any) {
      setError(caught?.message || "The import could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setStage("source");
    setLoaded(null);
    setEmployeeLine(null);
    setEmployeeName("");
    setItems([]);
    setWarnings([]);
    setExisting([]);
    setResolutions({});
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <DashboardHeader title="Import Schedule" />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {stage === "source" && (
          <>
            <Text style={styles.eyebrow}>Schedule import</Text>
            <Text style={styles.title}>Bring in your roster</Text>
            <Text style={styles.subtitle}>
              Choose a photo or an Excel file. Nothing is saved until you review every result.
            </Text>

            <View style={styles.sourceCard}>
              <View style={styles.sourceIcon}>
                <Ionicons name="camera-outline" size={25} color={colors.neonHover} />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceTitle}>Schedule image or photo</Text>
                <Text style={styles.sourceText}>
                  Use a clear, straight image with visible dates and shift codes.
                </Text>
              </View>
              <View style={styles.actionRow}>
                <ActionButton
                  label="Choose image"
                  icon="images-outline"
                  onPress={() => readImage("library")}
                  disabled={!!busy}
                />
                <ActionButton
                  label="Take photo"
                  icon="camera-outline"
                  onPress={() => readImage("camera")}
                  disabled={!!busy}
                />
              </View>
            </View>

            <View style={styles.sourceCard}>
              <View style={styles.sourceIcon}>
                <Ionicons name="grid-outline" size={25} color={colors.success} />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceTitle}>Excel .xlsx file</Text>
                <Text style={styles.sourceText}>
                  Supports date-and-code lists and common monthly roster layouts.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.primaryAction}
                onPress={readXlsx}
                disabled={!!busy}
                testID="import-xlsx"
              >
                <Ionicons name="document-attach-outline" size={18} color="#140C27" />
                <Text style={styles.primaryActionText}>Choose Excel file</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sourceCard}>
              <View style={styles.sourceIcon}>
                <Ionicons name="sync-outline" size={25} color={colors.neon} />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceTitle}>Current roster</Text>
                <Text style={styles.sourceText}>
                  Plot the roster already on your account onto the calendar
                  directly from the server — no photo or file needed.
                </Text>
              </View>
              {currentRoster && currentRoster.loaded && (
                <Text style={styles.currentRosterNote} testID="current-roster-note">
                  {currentRoster.today_count} shift
                  {currentRoster.today_count === 1 ? "" : "s"} today ·{" "}
                  {currentRoster.total} total
                </Text>
              )}
              {currentLoading ? (
                <ActivityIndicator color={colors.neon} style={{ marginTop: spacing.xs }} />
              ) : (
                <TouchableOpacity
                  style={[styles.primaryAction, { marginTop: spacing.xs }]}
                  onPress={loadCurrentRoster}
                  disabled={!!busy}
                  testID="import-current-roster"
                >
                  <Ionicons name="cloud-download-outline" size={18} color="#140C27" />
                  <Text style={styles.primaryActionText}>Fetch &amp; plot current roster</Text>
                </TouchableOpacity>
              )}
              {currentRoster && currentRoster.loaded && (
                <TouchableOpacity
                  style={[styles.secondaryAction, { marginTop: spacing.xs }]}
                  onPress={viewCalendar}
                >
                  <Ionicons name="calendar-outline" size={17} color={colors.textPrimary} />
                  <Text style={styles.secondaryActionText}>View on Calendar</Text>
                </TouchableOpacity>
              )}
            </View>

            {linkAvailable && (
              <View style={styles.sourceCard} testID="schedule-link-card">
                <View style={styles.sourceIcon}>
                  <Ionicons name="link-outline" size={25} color={colors.neonHover} />
                </View>
                <View style={styles.sourceCopy}>
                  <Text style={styles.sourceTitle}>Hospital schedule link</Text>
                  <Text style={styles.sourceText}>
                    Paste the SharePoint folder where your unit posts its roster. Foxory signs in with
                    your work account, finds your name, imports only your row, and checks for
                    changes every day.
                  </Text>
                </View>
                {isPlus ? (
                  <>
                    <TextInput
                      value={linkInput}
                      onChangeText={setLinkInput}
                      placeholder="https://…sharepoint.com/…/Schedules/…"
                      placeholderTextColor={colors.textMuted}
                      style={styles.dateInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      editable={!linkBusy}
                      testID="schedule-link-input"
                    />
                    {!!link && (
                      <Text style={styles.currentRosterNote} testID="schedule-link-status">
                        {[
                          linkAccount ? `Signed in as ${linkAccount}` : "Not signed in",
                          link.employeeName ? `Row: ${link.employeeName}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {describeSync(link) ? `\n${describeSync(link)}` : ""}
                      </Text>
                    )}
                    {!!link?.lastError && <Text style={styles.issueText}>{link.lastError}</Text>}
                    {!!linkMessage && <Text style={styles.issueText}>{linkMessage}</Text>}
                    {!isMicrosoftConfigured() && (
                      <Text style={styles.issueText}>Work-account sign-in is coming in the next app update.</Text>
                    )}
                    {linkBusy ? (
                      <ActivityIndicator color={colors.neon} style={{ marginTop: spacing.xs }} />
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.primaryAction,
                            (!linkInput.trim() || !isMicrosoftConfigured() || !!busy) && styles.disabledButton,
                          ]}
                          onPress={syncLink}
                          disabled={!linkInput.trim() || !isMicrosoftConfigured() || !!busy}
                          testID="schedule-link-sync"
                        >
                          <Ionicons name="sync-outline" size={18} color="#140C27" />
                          <Text style={styles.primaryActionText}>
                            {link ? "Sync now" : "Connect & sync"}
                          </Text>
                        </TouchableOpacity>
                        {!!link && (
                          <View style={styles.actionRow}>
                            {(!!link.lastResult?.needsReview.length || !link.employeeName) && (
                              <ActionButton
                                label={link.employeeName ? "Review flagged" : "Choose my row"}
                                icon="eye-outline"
                                onPress={reviewLink}
                                disabled={!!busy}
                              />
                            )}
                            <ActionButton
                              label="Remove link"
                              icon="close-circle-outline"
                              onPress={removeLink}
                              disabled={!!busy}
                            />
                          </View>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.primaryAction}
                    onPress={() => router.push("/(app)/upgrade")}
                    testID="schedule-link-upgrade"
                  >
                    <Ionicons name="lock-closed-outline" size={18} color="#140C27" />
                    <Text style={styles.primaryActionText}>Connect schedule link · Plus</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.codeGuide}>
              <Text style={styles.codeGuideTitle}>Codes are kept exactly as written</Text>
              <View style={styles.codeRow}>
                {KNOWN_CODES.map((code) => (
                  <View key={code} style={styles.codePill}>
                    <Text style={styles.codeValue}>{code}</Text>
                  </View>
                ))}
                <View style={styles.codePill}>
                  <Text style={styles.codeLabel}>Other codes are flagged for review</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {stage === "employee" && loaded && (
          <>
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>Choose employee</Text>
                <Text style={styles.reviewTitle}>{loaded.name}</Text>
                <Text style={styles.reviewMeta}>
                  {loaded.analysis.employees.length} row
                  {loaded.analysis.employees.length === 1 ? "" : "s"} ·{" "}
                  {loaded.analysis.dates.length} date
                  {loaded.analysis.dates.length === 1 ? "" : "s"}
                  {datesRange(loaded.analysis)}
                </Text>
              </View>
              <TouchableOpacity onPress={reset} style={styles.resetButton}>
                <Text style={styles.resetText}>Start over</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.warningBox}>
              <Ionicons name="person-circle-outline" size={20} color={colors.neonHover} />
              <Text style={styles.warningText}>
                Pick your row. Only that row is read, so shifts from other employees are never combined with yours.
              </Text>
            </View>
            <IssueList issues={loaded.analysis.issues} />
            {loaded.image && <OriginalImage image={loaded.image} />}

            {loaded.analysis.employees.map((employee) => {
              const active = employee.line === employeeLine;
              return (
                <TouchableOpacity
                  key={employee.line}
                  style={styles.reviewCard}
                  onPress={() => chooseEmployee(employee)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  testID={`employee-${employee.line}`}
                >
                  <View style={styles.reviewCardTop}>
                    <Ionicons
                      name={active ? "radio-button-on" : "radio-button-off"}
                      size={22}
                      color={active ? colors.neonHover : colors.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sourceTitle} numberOfLines={1}>
                        {employee.name}
                      </Text>
                      <Text style={styles.originalText} numberOfLines={1}>
                        Read as: {employee.parts.join(" · ") || "(no name)"} · {employee.filled} filled cell
                        {employee.filled === 1 ? "" : "s"}
                      </Text>
                    </View>
                  </View>
                  {active && (
                    <>
                      <Text style={styles.fieldLabel}>Name (correct it if it was misread)</Text>
                      <TextInput
                        value={employeeName}
                        onChangeText={setEmployeeName}
                        style={styles.dateInput}
                        autoCapitalize="words"
                        testID="employee-name-input"
                      />
                    </>
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[
                styles.saveButton,
                (employeeLine === null || !employeeName.trim() || !!busy) && styles.disabledButton,
              ]}
              onPress={readEmployeeRow}
              disabled={employeeLine === null || !employeeName.trim() || !!busy}
              testID="confirm-employee"
            >
              {busy === "row" ? (
                <ActivityIndicator color="#140C27" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={19} color="#140C27" />
                  <Text style={styles.saveText}>Read this row</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {stage === "review" && loaded && (
          <>
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>Review before import</Text>
                <Text style={styles.reviewTitle}>{employeeName}</Text>
                <Text style={styles.reviewMeta}>{range}</Text>
                <Text style={styles.reviewMeta} testID="review-counts">
                  {counts.detected} detected · {counts.uncertain} uncertain · {counts.skipped} skipped ·{" "}
                  {counts.duplicates} duplicate{counts.duplicates === 1 ? "" : "s"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setStage("employee")} style={styles.resetButton}>
                <Text style={styles.resetText}>Change row</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.warningBox}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.neonHover} />
              <Text style={styles.warningText}>
                Check every date and code against the original. Rows marked “Needs review” cannot be imported until you
                confirm, correct or exclude them. Blank cells are never imported.
              </Text>
            </View>
            <IssueList issues={warnings} />
            {loaded.image && <OriginalImage image={loaded.image} />}

            {items.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                action={item.selected ? planByDate.get(item.date.trim()) : undefined}
                resolution={resolutions[item.date.trim()] ?? "keep"}
                onResolve={(value) => setResolutions((current) => ({ ...current, [item.date.trim()]: value }))}
                onUpdate={(patch) => updateItem(item.id, patch)}
              />
            ))}

            <TouchableOpacity
              style={[styles.saveButton, !canSave && styles.disabledButton]}
              onPress={saveImport}
              disabled={!canSave}
              testID="save-imported-drafts"
            >
              {busy === "saving" ? (
                <ActivityIndicator color="#140C27" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={19} color="#140C27" />
                  <Text style={styles.saveText}>
                    Import {writes} shift{writes === 1 ? "" : "s"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {counts.unresolved > 0 ? (
              <Text style={styles.blockedText}>
                Confirm, correct or exclude {counts.unresolved} row{counts.unresolved === 1 ? "" : "s"} to continue.
              </Text>
            ) : writes === 0 ? (
              <Text style={styles.blockedText}>Nothing new to import — these shifts are already on your calendar.</Text>
            ) : null}
          </>
        )}

        {!!busy && busy !== "saving" && busy !== "row" && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.neon} />
            <Text style={styles.loadingText}>
              {progress || (busy === "image" ? "Reading schedule image…" : "Reading Excel schedule…")}
            </Text>
          </View>
        )}
        {busy === "row" && !!progress && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.neon} />
            <Text style={styles.loadingText}>{progress}</Text>
          </View>
        )}
        {!!error && (
          <View style={styles.errorBox} testID="import-error">
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function datesRange(analysis: RosterAnalysis): string {
  const dates = analysis.dates.map((d) => d.iso).filter((d): d is string => !!d).sort();
  return dates.length ? ` · ${dates[0]} → ${dates[dates.length - 1]}` : "";
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <TouchableOpacity style={styles.secondaryAction} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={17} color={colors.textPrimary} />
      <Text style={styles.secondaryActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return (
    <View style={styles.errorBox} testID="import-warnings">
      <Ionicons name="warning-outline" size={20} color={colors.danger} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        {issues.map((issue) => (
          <Text key={issue} style={styles.errorText}>
            {issue}
          </Text>
        ))}
      </View>
    </View>
  );
}

function OriginalImage({ image }: { image: { uri: string; width: number; height: number } }) {
  const height = 200;
  const width = Math.max(1, Math.round((image.width / Math.max(1, image.height)) * height));
  return (
    <View style={styles.reviewCard}>
      <Text style={styles.fieldLabel}>Original image — scroll to compare</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
        <Image
          source={{ uri: image.uri }}
          style={{ width, height, borderRadius: radius.sm }}
          resizeMode="contain"
          accessibilityLabel="Original roster image"
        />
      </ScrollView>
    </View>
  );
}

function ReviewRow({
  item,
  action,
  resolution,
  onResolve,
  onUpdate,
}: {
  item: ReviewItem;
  action?: PlannedAction;
  resolution: Resolution;
  onResolve: (value: Resolution) => void;
  onUpdate: (patch: Partial<ReviewItem>) => void;
}) {
  const problems = itemProblems(item);
  const needsReview = item.selected && problems.length > 0;
  const typed = normaliseTypedCode(item.code);
  const isOther = !!item.code && !(KNOWN_CODES as readonly string[]).includes(typed ?? "");
  const conflict = action?.kind === "conflict" ? action : null;
  const canReplace = !!conflict && !!replaceTarget(conflict);
  return (
    <View style={[styles.reviewCard, !item.selected && styles.reviewCardExcluded]}>
      <View style={styles.reviewCardTop}>
        <TouchableOpacity
          onPress={() => onUpdate({ selected: !item.selected })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.selected }}
        >
          <Ionicons
            name={item.selected ? "checkmark-circle" : "ellipse-outline"}
            size={24}
            color={item.selected ? colors.neonHover : colors.textMuted}
          />
        </TouchableOpacity>
        <Text style={styles.originalText} numberOfLines={1}>
          {item.status === "blank" ? "Blank in roster — not imported" : `Read as: ${item.raw || "(unreadable)"}`}
        </Text>
        {needsReview && <Text style={styles.needsReview}>Needs review</Text>}
        {action?.kind === "unchanged" && <Text style={styles.savedInline}>Already imported</Text>}
      </View>

      <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
      <TextInput
        value={item.date}
        onChangeText={(date) => onUpdate({ date, acknowledged: true })}
        style={[styles.dateInput, item.selected && problems.some((p) => p.includes("date")) && styles.invalidInput]}
        editable={item.selected}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.fieldLabel}>Shift code (as written on the roster)</Text>
      <View style={styles.choiceRow}>
        {KNOWN_CODES.map((code) => (
          <TouchableOpacity
            key={code}
            style={[styles.choice, typed === code && styles.choiceActive]}
            onPress={() => onUpdate({ code, acknowledged: true })}
            disabled={!item.selected}
          >
            <Text style={[styles.choiceText, typed === code && styles.choiceTextActive]}>{code}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        value={isOther ? item.code : ""}
        onChangeText={(code) => onUpdate({ code, acknowledged: true })}
        placeholder="Other code"
        placeholderTextColor={colors.textMuted}
        style={[styles.dateInput, isOther && styles.choiceActive]}
        editable={item.selected}
        autoCapitalize="characters"
        maxLength={6}
      />

      {conflict && item.selected && (
        <>
          <Text style={styles.fieldLabel}>
            Already on calendar: {conflict.existing.map(shiftDisplayCode).join(", ")}
          </Text>
          <View style={styles.choiceRow}>
            {(["keep", "replace"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                style={[
                  styles.choice,
                  resolution === value && styles.choiceActive,
                  value === "replace" && !canReplace && styles.disabledButton,
                ]}
                onPress={() => onResolve(value)}
                disabled={value === "replace" && !canReplace}
              >
                <Text style={[styles.choiceText, resolution === value && styles.choiceTextActive]}>
                  {value === "keep" ? "Keep existing" : `Replace with ${typed ?? "?"}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!canReplace && (
            <Text style={styles.issueText}>Several entries share this date; edit them on the Calendar instead.</Text>
          )}
        </>
      )}

      {item.selected && !item.acknowledged && (
        <TouchableOpacity style={styles.confirmButton} onPress={() => onUpdate({ acknowledged: true })}>
          <Ionicons name="eye-outline" size={16} color={colors.neonHover} />
          <Text style={styles.confirmText}>I checked this row</Text>
        </TouchableOpacity>
      )}
      {item.selected &&
        item.issues.map((issue) => (
          <Text key={issue} style={styles.issueText}>
            {issue}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  eyebrow: {
    color: colors.textAccent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: "900" },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  sourceCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sourceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.neonSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceCopy: { gap: spacing.xs },
  sourceTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "800" },
  sourceText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  currentRosterNote: {
    color: colors.textAccent,
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderActive,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: spacing.sm,
  },
  secondaryActionText: { color: colors.textPrimary, fontSize: 12, fontWeight: "700" },
  primaryAction: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryActionText: { color: "#140C27", fontSize: 13, fontWeight: "900" },
  codeGuide: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  codeGuideTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  codeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  codePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  codeValue: { color: colors.neonHover, fontSize: 11, fontWeight: "900" },
  codeLabel: { color: colors.textSecondary, fontSize: 10 },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  reviewTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: "800", marginTop: 3 },
  reviewMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  resetButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resetText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  warningBox: {
    flexDirection: "row",
    backgroundColor: colors.neonSoft,
    borderWidth: 1,
    borderColor: colors.borderActive,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  warningText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  reviewCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reviewCardExcluded: { opacity: 0.45 },
  reviewCardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  originalText: { flex: 1, color: colors.textMuted, fontSize: 11 },
  needsReview: { color: colors.danger, fontSize: 10, fontWeight: "800" },
  savedInline: { color: colors.success, fontSize: 10, fontWeight: "800" },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateInput: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    fontSize: 14,
  },
  invalidInput: { borderColor: colors.danger },
  choiceRow: { flexDirection: "row", gap: spacing.sm },
  choice: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  choiceActive: { borderColor: colors.borderActive, backgroundColor: colors.neonSoft },
  choiceText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  choiceTextActive: { color: colors.neonHover },
  confirmButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderActive,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  confirmText: { color: colors.neonHover, fontSize: 11, fontWeight: "800" },
  issueText: { color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  saveButton: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.neonHover,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  disabledButton: { opacity: 0.4 },
  saveText: { color: "#140C27", fontSize: 14, fontWeight: "900" },
  blockedText: { color: colors.textMuted, textAlign: "center", fontSize: 11 },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  loadingText: { color: colors.textSecondary, fontSize: 12 },
  errorBox: {
    flexDirection: "row",
    backgroundColor: "rgba(248, 113, 113, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.4)",
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
});
