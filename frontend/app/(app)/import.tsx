import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DashboardHeader } from "@/src/components/DashboardHeader";
import { useAuth } from "@/src/context/AuthContext";
import { api, isPlusRequired } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/colors";
import {
  codeToNote,
  codeToShiftType,
  ImportCandidate,
  isValidImportDate,
  parseRecognizedText,
  parseWorkbook,
  PositionedText,
  ScheduleCode,
} from "@/src/utils/importSchedule";

const CODES: { code: ScheduleCode; label: string }[] = [
  { code: "D", label: "Day" },
  { code: "N", label: "Night" },
  { code: "OFF", label: "Off" },
  { code: "AL", label: "Annual leave" },
];

export default function ImportScheduleScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [busy, setBusy] = useState<"image" | "xlsx" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const selected = useMemo(
    () => candidates.filter((candidate) => candidate.selected),
    [candidates],
  );
  const unresolved = selected.filter(
    (candidate) =>
      !candidate.acknowledged ||
      !candidate.code ||
      !candidate.type ||
      !isValidImportDate(candidate.date),
  );
  const canSave = selected.length > 0 && unresolved.length === 0 && !busy;

  const loadCandidates = (items: ImportCandidate[], name: string) => {
    setError(null);
    setSavedCount(0);
    if (items.length === 0) {
      setCandidates([]);
      setSourceName("");
      setError(
        "No dated D, N, X/OFF, or AL shifts were found. Try a clearer image or an Excel sheet with dates and shift codes.",
      );
      return;
    }
    setCandidates(items);
    setSourceName(name);
  };

  const readImage = async (mode: "camera" | "library") => {
    if (Platform.OS === "web") {
      setError("Photo recognition is available in the Android and iOS app.");
      return;
    }
    setBusy("image");
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
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 1,
            });
      if (result.canceled) return;

      const asset = result.assets[0];
      const { extractTextFromImage } = await import("expo-text-extractor");
      const lines = await extractTextFromImage(asset.uri);
      const elements: PositionedText[] = [];
      loadCandidates(
        parseRecognizedText(elements, lines.join("\n")),
        asset.fileName || "Schedule photo",
      );
    } catch (caught: any) {
      setError(caught?.message || "The schedule image could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const readXlsx = async () => {
    setBusy("xlsx");
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
      const data = asset.file
        ? await asset.file.arrayBuffer()
        : await new File(asset.uri).arrayBuffer();
      loadCandidates(await parseWorkbook(data), asset.name || "Excel schedule");
    } catch (caught: any) {
      setError(caught?.message || "The Excel schedule could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const updateCandidate = (id: string, patch: Partial<ImportCandidate>) => {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, ...patch } : candidate,
      ),
    );
  };

  const chooseCode = (candidate: ImportCandidate, code: ScheduleCode) => {
    updateCandidate(candidate.id, {
      code,
      type: codeToShiftType(code),
      acknowledged: true,
      issues: [],
    });
  };

  const saveDrafts = async () => {
    if (!token || !canSave) return;
    setBusy("saving");
    setError(null);
    const results = await Promise.allSettled(
      selected.map((candidate) =>
        api.createShift(token, {
          date: candidate.date,
          type: candidate.type!,
          start_time:
            candidate.code === "D" ? "07:00" : candidate.code === "N" ? "19:00" : null,
          end_time:
            candidate.code === "D" ? "19:00" : candidate.code === "N" ? "07:00" : null,
          note: codeToNote(candidate.code!),
          is_draft: true,
        }),
      ),
    );

    const failedIds = new Set<string>();
    let firstFailure: unknown;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failedIds.add(selected[index].id);
        firstFailure ||= result.reason;
      }
    });
    const completed = results.length - failedIds.size;
    setSavedCount((count) => count + completed);
    setCandidates((current) => current.filter((candidate) => failedIds.has(candidate.id)));
    setBusy(null);

    if (firstFailure && isPlusRequired(firstFailure)) {
      router.push("/(app)/upgrade");
      return;
    }
    if (failedIds.size > 0) {
      setError(
        `${completed} draft${completed === 1 ? "" : "s"} saved; ${failedIds.size} failed. Review the remaining rows and try again.`,
      );
      return;
    }
    Alert.alert(
      "Import complete",
      `${completed} draft shift${completed === 1 ? "" : "s"} saved. You can review them on the Calendar tab.`,
      [{ text: "View calendar", onPress: () => router.replace("/(app)/dashboard") }],
    );
  };

  const reset = () => {
    setCandidates([]);
    setSourceName("");
    setError(null);
    setSavedCount(0);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <DashboardHeader title="Import Schedule" />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {candidates.length === 0 ? (
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

            <View style={styles.codeGuide}>
              <Text style={styles.codeGuideTitle}>Supported codes</Text>
              <View style={styles.codeRow}>
                {CODES.map(({ code, label }) => (
                  <View key={code} style={styles.codePill}>
                    <Text style={styles.codeValue}>{code}</Text>
                    <Text style={styles.codeLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>Review before saving</Text>
                <Text style={styles.reviewTitle}>{sourceName}</Text>
                <Text style={styles.reviewMeta}>
                  {selected.length} selected · {unresolved.length} need review
                </Text>
              </View>
              <TouchableOpacity onPress={reset} style={styles.resetButton}>
                <Text style={styles.resetText}>Start over</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.warningBox}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.neonHover} />
              <Text style={styles.warningText}>
                Check dates and codes against the source. Rows marked “Needs review” cannot be saved until you confirm or edit them.
              </Text>
            </View>

            {candidates.map((candidate) => (
              <ReviewRow
                key={candidate.id}
                candidate={candidate}
                onUpdate={(patch) => updateCandidate(candidate.id, patch)}
                onChooseCode={(code) => chooseCode(candidate, code)}
              />
            ))}

            <TouchableOpacity
              style={[styles.saveButton, !canSave && styles.disabledButton]}
              onPress={saveDrafts}
              disabled={!canSave}
              testID="save-imported-drafts"
            >
              {busy === "saving" ? (
                <ActivityIndicator color="#140C27" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={19} color="#140C27" />
                  <Text style={styles.saveText}>
                    Save {selected.length} draft{selected.length === 1 ? "" : "s"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {unresolved.length > 0 && (
              <Text style={styles.blockedText}>
                Confirm or exclude {unresolved.length} unresolved row
                {unresolved.length === 1 ? "" : "s"} to continue.
              </Text>
            )}
          </>
        )}

        {!!busy && busy !== "saving" && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.neon} />
            <Text style={styles.loadingText}>
              {busy === "image" ? "Reading schedule image…" : "Reading Excel schedule…"}
            </Text>
          </View>
        )}
        {!!error && (
          <View style={styles.errorBox} testID="import-error">
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {savedCount > 0 && candidates.length > 0 && (
          <Text style={styles.savedText}>{savedCount} draft shifts saved so far.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
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

function ReviewRow({
  candidate,
  onUpdate,
  onChooseCode,
}: {
  candidate: ImportCandidate;
  onUpdate: (patch: Partial<ImportCandidate>) => void;
  onChooseCode: (code: ScheduleCode) => void;
}) {
  const needsReview =
    candidate.selected &&
    (!candidate.acknowledged || !candidate.code || !isValidImportDate(candidate.date));
  return (
    <View style={[styles.reviewCard, !candidate.selected && styles.reviewCardExcluded]}>
      <View style={styles.reviewCardTop}>
        <TouchableOpacity
          onPress={() => onUpdate({ selected: !candidate.selected })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: candidate.selected }}
        >
          <Ionicons
            name={candidate.selected ? "checkmark-circle" : "ellipse-outline"}
            size={24}
            color={candidate.selected ? colors.neonHover : colors.textMuted}
          />
        </TouchableOpacity>
        <Text style={styles.originalText} numberOfLines={1}>
          Read as: {candidate.originalText}
        </Text>
        {needsReview && <Text style={styles.needsReview}>Needs review</Text>}
      </View>

      <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
      <TextInput
        value={candidate.date}
        onChangeText={(date) =>
          onUpdate({ date, acknowledged: true, issues: [] })
        }
        style={[
          styles.dateInput,
          candidate.selected && !isValidImportDate(candidate.date) && styles.invalidInput,
        ]}
        editable={candidate.selected}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />

      <Text style={styles.fieldLabel}>Shift code</Text>
      <View style={styles.choiceRow}>
        {CODES.map(({ code }) => (
          <TouchableOpacity
            key={code}
            style={[styles.choice, candidate.code === code && styles.choiceActive]}
            onPress={() => onChooseCode(code)}
            disabled={!candidate.selected}
          >
            <Text
              style={[
                styles.choiceText,
                candidate.code === code && styles.choiceTextActive,
              ]}
            >
              {code}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {candidate.selected && !candidate.acknowledged && (
        <TouchableOpacity
          style={styles.confirmButton}
          onPress={() => onUpdate({ acknowledged: true })}
        >
          <Ionicons name="eye-outline" size={16} color={colors.neonHover} />
          <Text style={styles.confirmText}>I checked this row</Text>
        </TouchableOpacity>
      )}
      {candidate.selected && candidate.issues.map((issue) => (
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
  savedText: { color: colors.success, textAlign: "center", fontSize: 12, fontWeight: "700" },
});
