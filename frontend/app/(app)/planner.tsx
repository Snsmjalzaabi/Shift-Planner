import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DashboardHeader } from "@/src/components/DashboardHeader";
import { useAuth } from "@/src/context/AuthContext";
import { api, Shift } from "@/src/lib/api";
import { colors, radius, shiftTheme, spacing } from "@/src/theme/colors";
import { currentMonthKey, monthLabel, shiftDateDisplay } from "@/src/utils/dateUtils";

type Filter = "all" | "draft" | "confirmed";

export default function PlannerScreen() {
  const { token } = useAuth();
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingEmail, setExportingEmail] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{
    to: string;
    subject: string;
    body: string;
  } | null>(null);
  const [xlsxResult, setXlsxResult] = useState<{
    filename: string;
    size_bytes: number;
    shift_count: number;
  } | null>(null);
  const [copied, setCopied] = useState<"body" | "subject" | null>(null);

  const [y, m] = month.split("-").map(Number);

  const fetchShifts = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.listShifts(token, month);
      setShifts(data);
    } catch {
      // ignore
    }
  }, [token, month]);

  useEffect(() => {
    setLoading(true);
    fetchShifts().finally(() => setLoading(false));
  }, [fetchShifts]);

  const filtered = useMemo(() => {
    if (filter === "draft") return shifts.filter((s) => s.is_draft);
    if (filter === "confirmed") return shifts.filter((s) => !s.is_draft);
    return shifts;
  }, [shifts, filter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShifts();
    setRefreshing(false);
  };

  const shiftMonth = (dir: -1 | 1) => {
    const nm = m + dir;
    let ny = y;
    let nn = nm;
    if (nm === 0) {
      ny = y - 1;
      nn = 12;
    } else if (nm === 13) {
      ny = y + 1;
      nn = 1;
    }
    setMonth(`${ny}-${String(nn).padStart(2, "0")}`);
  };

  const doXlsx = async () => {
    if (!token) return;
    setExportingXlsx(true);
    setXlsxResult(null);
    try {
      const res = await api.exportXlsx(token, { month, include_confirmed: filter === "all" });
      setXlsxResult({
        filename: res.filename,
        size_bytes: res.size_bytes,
        shift_count: res.shift_count,
      });
    } catch {
      // ignore
    } finally {
      setExportingXlsx(false);
    }
  };

  const doEmail = async () => {
    if (!token) return;
    setExportingEmail(true);
    setEmailPreview(null);
    try {
      const res = await api.exportEmail(token, {
        month,
        include_confirmed: filter === "all",
      });
      setEmailPreview({ to: res.to, subject: res.subject, body: res.body });
    } catch {
      // ignore
    } finally {
      setExportingEmail(false);
    }
  };

  const copyToClip = async (
    text: string,
    which: "body" | "subject",
  ) => {
    await Clipboard.setStringAsync(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const draftCount = shifts.filter((s) => s.is_draft).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <DashboardHeader />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.neon}
            colors={[colors.neon]}
          />
        }
      >
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.eyebrow}>Draft Planner</Text>
            <Text style={styles.title}>Plan &amp; Export</Text>
          </View>
          <View style={styles.monthBadge}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} testID="planner-prev-month">
              <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.monthText}>{monthLabel(y, m - 1)}</Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} testID="planner-next-month">
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Draft reminder */}
        <View style={styles.reminder}>
          <Ionicons name="information-circle" size={16} color={colors.textAccent} />
          <Text style={styles.reminderText}>
            This draft plan does not change the confirmed calendar.
          </Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {(["all", "draft", "confirmed"] as Filter[]).map((f) => {
            const active = filter === f;
            const label =
              f === "all"
                ? `All (${shifts.length})`
                : f === "draft"
                ? `Draft (${draftCount})`
                : `Confirmed (${shifts.length - draftCount})`;
            return (
              <TouchableOpacity
                key={f}
                testID={`filter-${f}`}
                onPress={() => setFilter(f)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Export actions */}
        <View style={styles.exportRow}>
          <ExportButton
            testID="export-xlsx-btn"
            label={exportingXlsx ? "Building…" : "Export XLSX"}
            icon="document-attach-outline"
            onPress={doXlsx}
            loading={exportingXlsx}
            primary
          />
          <ExportButton
            testID="export-email-btn"
            label={exportingEmail ? "Building…" : "Email draft"}
            icon="mail-outline"
            onPress={doEmail}
            loading={exportingEmail}
          />
        </View>

        {xlsxResult && (
          <View style={styles.resultBox} testID="xlsx-result">
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.success}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>{xlsxResult.filename}</Text>
              <Text style={styles.resultMeta}>
                {xlsxResult.shift_count} shift{xlsxResult.shift_count === 1 ? "" : "s"} · {(xlsxResult.size_bytes / 1024).toFixed(1)} KB
              </Text>
              <Text style={styles.resultSig}>Created by Foxory.net</Text>
            </View>
          </View>
        )}

        {/* Shift list */}
        <Text style={styles.sectionTitle}>
          Shifts in {monthLabel(y, m - 1)}
        </Text>

        {loading ? (
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.neon} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty} testID="planner-empty">
            <Ionicons
              name="clipboard-outline"
              size={28}
              color={colors.textMuted}
            />
            <Text style={styles.emptyText}>
              No {filter === "all" ? "" : filter + " "}shifts for this month.
            </Text>
            <Text style={styles.emptySub}>
              Tap any day on the Calendar tab to add a draft shift.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {filtered.map((s) => {
              const th = shiftTheme(s.type);
              return (
                <View
                  key={s.id}
                  testID={`planner-row-${s.id}`}
                  style={[styles.row, { borderColor: colors.border }]}
                >
                  <View
                    style={[
                      styles.rowStripe,
                      { backgroundColor: th.text },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowDate}>
                      {shiftDateDisplay(s.date)}
                    </Text>
                    <View style={styles.rowMeta}>
                      <View
                        style={[
                          styles.rowPill,
                          { backgroundColor: th.bg, borderColor: th.border },
                        ]}
                      >
                        <Text style={[styles.rowPillText, { color: th.text }]}>
                          {th.label}
                        </Text>
                      </View>
                      {(s.start_time || s.end_time) && (
                        <Text style={styles.rowTime}>
                          {s.start_time || "—"} → {s.end_time || "—"}
                        </Text>
                      )}
                      <Text style={styles.rowStatus}>
                        {s.is_draft ? "Draft" : "Confirmed"}
                      </Text>
                    </View>
                    {!!s.location && (
                      <Text style={styles.rowSub}>{s.location}</Text>
                    )}
                    {!!s.note && (
                      <Text style={styles.rowNote} numberOfLines={2}>
                        {s.note}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Email preview modal */}
      <Modal
        visible={!!emailPreview}
        transparent
        animationType="slide"
        onRequestClose={() => setEmailPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setEmailPreview(null)}
          />
          <View style={styles.emailSheet} testID="email-preview-sheet">
            <View style={styles.handle} />
            <View style={styles.emailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.emailEyebrow}>Email Preview</Text>
                <Text style={styles.emailTitle}>Draft Plan Export</Text>
              </View>
              <TouchableOpacity
                testID="email-preview-close"
                onPress={() => setEmailPreview(null)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {emailPreview && (
              <ScrollView
                style={{ maxHeight: 460 }}
                showsVerticalScrollIndicator={false}
              >
                <EmailField
                  label="To"
                  value={emailPreview.to}
                  testID="email-to"
                />
                <EmailField
                  label="Subject"
                  value={emailPreview.subject}
                  testID="email-subject"
                  onCopy={() => copyToClip(emailPreview.subject, "subject")}
                  copied={copied === "subject"}
                />
                <Text style={styles.emailLabel}>Body</Text>
                <View style={styles.emailBody} testID="email-body">
                  <Text style={styles.emailBodyText}>{emailPreview.body}</Text>
                </View>
                <TouchableOpacity
                  testID="copy-email-body"
                  onPress={() => copyToClip(emailPreview.body, "body")}
                  style={styles.copyBtn}
                >
                  <Ionicons
                    name={copied === "body" ? "checkmark" : "copy-outline"}
                    size={16}
                    color={copied === "body" ? colors.success : colors.textPrimary}
                  />
                  <Text style={styles.copyBtnText}>
                    {copied === "body" ? "Copied!" : "Copy full email body"}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function EmailField({
  label,
  value,
  testID,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  testID: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.emailLabel}>{label}</Text>
      <View style={styles.emailField}>
        <Text testID={testID} style={styles.emailFieldText}>
          {value}
        </Text>
        {onCopy && (
          <TouchableOpacity onPress={onCopy} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={16}
              color={copied ? colors.success : colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function ExportButton({
  label,
  icon,
  onPress,
  loading,
  primary,
  testID,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  loading: boolean;
  primary?: boolean;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={loading}
      style={[
        styles.exportBtn,
        primary ? styles.exportBtnPrimary : styles.exportBtnGhost,
        loading && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? "#0B0619" : colors.textPrimary} />
      ) : (
        <>
          <Ionicons
            name={icon}
            size={16}
            color={primary ? "#0B0619" : colors.textPrimary}
          />
          <Text
            style={[
              styles.exportBtnText,
              primary && styles.exportBtnPrimaryText,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: spacing.md,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  monthBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  monthText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 80,
    textAlign: "center",
  },
  reminder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(168, 85, 247, 0.08)",
    borderColor: "rgba(168, 85, 247, 0.28)",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  reminderText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    flex: 1,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingRight: spacing.md,
    marginBottom: spacing.md,
    height: 40,
    alignItems: "center",
  },
  filterChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  filterChipActive: {
    borderColor: colors.neon,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: colors.textAccent,
  },
  exportRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  exportBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
  },
  exportBtnPrimary: {
    backgroundColor: colors.neon,
    borderColor: colors.neon,
  },
  exportBtnGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  exportBtnText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 13.5,
  },
  exportBtnPrimaryText: {
    color: "#0B0619",
  },
  resultBox: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "rgba(74, 222, 128, 0.10)",
    borderColor: "rgba(74, 222, 128, 0.30)",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  resultTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  resultMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  resultSig: {
    color: colors.textMuted,
    fontSize: 10.5,
    marginTop: 4,
    fontStyle: "italic",
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13.5,
    fontWeight: "600",
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    maxWidth: 240,
  },
  row: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  rowStripe: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
  },
  rowDate: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  rowPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  rowPillText: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  rowTime: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  rowStatus: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  rowSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  rowNote: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    fontStyle: "italic",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(3, 1, 10, 0.7)",
  },
  emailSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  emailHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  emailEyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  emailTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  emailLabel: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  emailField: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  emailFieldText: {
    color: colors.textPrimary,
    fontSize: 13.5,
    flex: 1,
  },
  emailBody: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  emailBodyText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontFamily: "monospace",
    lineHeight: 20,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.elevated,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  copyBtnText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 13,
  },
});
