import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DashboardHeader } from "@/src/components/DashboardHeader";
import { ShiftEditor } from "@/src/components/ShiftEditor";
import { useAuth } from "@/src/context/AuthContext";
import { api, Shift } from "@/src/lib/api";
import { colors, radius, shiftTheme, spacing } from "@/src/theme/colors";
import {
  buildMonthGrid,
  monthLabel,
  shiftDateDisplay,
  todayIso,
  ym,
} from "@/src/utils/dateUtils";

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DashboardScreen() {
  const { token } = useAuth();
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const currentMonthKey = ym(now.getFullYear(), now.getMonth());
  const currentShifts = shifts.filter((s) => s.date.startsWith(currentMonthKey));

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [plotting, setPlotting] = useState(false);
  const [plotNote, setPlotNote] = useState<string | null>(null);
  const today = todayIso();

  const monthKey = ym(year, month0);
  const grid = useMemo(() => buildMonthGrid(year, month0), [year, month0]);
  const weeks = useMemo(
    () =>
      Array.from({ length: grid.length / 7 }, (_, index) =>
        grid.slice(index * 7, index * 7 + 7),
      ),
    [grid],
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const arr = map.get(s.date) || [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return map;
  }, [shifts]);

  const fetchShifts = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.listShifts(token, monthKey);
      setShifts(data);
    } catch {
      // ignore
    }
  }, [token, monthKey]);

  useEffect(() => {
    setLoading(true);
    fetchShifts().finally(() => setLoading(false));
  }, [fetchShifts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchShifts();
    setRefreshing(false);
  };

  // "Import tap": plot the user's current roster on the calendar without
  // picking up a schedule image or Excel file — just one tap fetches the
  // roster from the backend and plots it on the grid.
  const plotCurrentRoster = async () => {
    if (!token || plotting) return;
    setPlotting(true);
    setPlotNote(null);
    try {
      const res = await api.currentShifts(token);
      // Move the grid to the current month so today's shifts are visible,
      // then refetch that month's roster so the chips render.
      const d = new Date();
      setYear(d.getFullYear());
      setMonth0(d.getMonth());
      setPlotNote(
        `${res.today_count} shift${res.today_count === 1 ? "" : "s"} today · ${res.shifts.length} shifts plotted`,
      );
      setTimeout(() => setPlotNote(null), 4000);
    } catch (e: any) {
      setPlotNote(e?.message || "Could not fetch current roster");
      setTimeout(() => setPlotNote(null), 4000);
    } finally {
      setPlotting(false);
    }
  };

  const goPrev = () => {
    if (month0 === 0) {
      setMonth0(11);
      setYear((y) => y - 1);
    } else {
      setMonth0((m) => m - 1);
    }
  };

  const goNext = () => {
    if (month0 === 11) {
      setMonth0(0);
      setYear((y) => y + 1);
    } else {
      setMonth0((m) => m + 1);
    }
  };

  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
  };

  const [plotStatus, setPlotStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [plotError, setPlotError] = useState<string | null>(null);

  const plotCurrentShifts = useCallback(async () => {
    if (!token) return;
    setPlotStatus("loading");
    try {
      const now = new Date();
      const currentMonth = ym(now.getFullYear(), now.getMonth());
      const fetched: Shift[] = await api.listShifts(token, currentMonth, true);
      const map = new Map<string, Shift>();
      for (const s of shifts) map.set(s.id, s);
      for (const s of fetched) map.set(s.id, s);
      const merged = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
      setShifts(merged);
      setPlotStatus("done");
      Alert.alert("Current shifts plotted", `${fetched.length} shift${fetched.length === 1 ? "" : "s"} loaded for ${currentMonth}.`, [
        { text: "OK", style: "default" },
      ]);
      setTimeout(() => setPlotStatus("idle"), 2000);
    } catch (e: any) {
      setPlotStatus("error");
      Alert.alert("Plot failed", e?.message || "Could not fetch current shifts from the server.");
    }
  }, [token, shifts]);

  const draftCount = shifts.filter((s) => s.is_draft).length;
  const confirmedCount = shifts.length - draftCount;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <DashboardHeader />

      <ScrollView
        contentContainerStyle={styles.scrollBody}
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
        {/* Month switcher */}
        <View style={styles.monthBar}>
          <TouchableOpacity
            testID="prev-month-btn"
            onPress={goPrev}
            style={styles.navBtn}
          >
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ alignItems: "center" }}>
            <Text style={styles.monthTitle}>{monthLabel(year, month0)}</Text>
            <TouchableOpacity onPress={goToday} testID="today-btn">
              <Text style={styles.todayLink}>Jump to today</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            testID="plot-current-btn"
            onPress={plotCurrentShifts}
            style={styles.plotBtn}
          >
            <Ionicons name="calendar-outline" size={15} color={colors.neonHover} />
            <Text style={styles.plotBtnText}>Plot current</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="next-month-btn"
            onPress={goNext}
            style={styles.navBtn}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textPrimary}
            />
          </TouchableOpacity>
        </View>

        {/* Plot current roster — the "import tap": fetch the roster from the
            backend and plot it on the calendar without a file pick. */}
        <View style={styles.plotActionBar}>
          <TouchableOpacity
            testID="plot-current-roster"
            style={styles.plotButton}
            onPress={plotCurrentRoster}
            disabled={plotting}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-download-outline" size={17} color="#0B0619" />
            <Text style={styles.plotButtonText}>
              {plotting ? "Plotting…" : "Plot current roster"}
            </Text>
          </TouchableOpacity>
          {plotting && <ActivityIndicator color={colors.neon} />}
        </View>
        {plotNote && (
          <View style={styles.plotNoteBox} testID="plot-note">
            <Text style={styles.plotNoteText}>{plotNote}</Text>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard label="Draft" count={draftCount} icon="document-outline" />
          <StatCard
            label="Confirmed"
            count={confirmedCount}
            icon="checkmark-done"
            accent
          />
          <StatCard
            label="Total"
            count={shifts.length}
            icon="calendar-outline"
          />
        </View>

        {/* Week header */}
        <View style={styles.weekHeader}>
          {WEEK_DAYS.map((d) => (
            <Text key={d} style={styles.weekLabel}>
              {d}
            </Text>
          ))}
        </View>

        {/* Grid */}
        {loading ? (
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.neon} />
          </View>
        ) : (
          <View style={styles.gridWrap} testID="calendar-grid">
            {weeks.map((week, weekIndex) => (
              <View key={`week-${weekIndex}`} style={styles.gridRow}>
                {week.map((cell) => {
                  const dayShifts = shiftsByDate.get(cell.date) || [];
                  const isToday = cell.date === today;
                  return (
                    <TouchableOpacity
                      key={cell.date}
                      testID={`calendar-cell-${cell.date}`}
                      activeOpacity={0.75}
                      onPress={() => cell.inMonth && setSelectedDate(cell.date)}
                      style={[
                        styles.cell,
                        !cell.inMonth && styles.cellOutside,
                        isToday && styles.cellToday,
                      ]}
                    >
                      <Text
                        style={[
                          styles.cellNum,
                          !cell.inMonth && styles.cellNumOutside,
                          isToday && styles.cellNumToday,
                        ]}
                      >
                        {cell.dayNum}
                      </Text>
                      <View style={styles.chipStack}>
                        {dayShifts.slice(0, 2).map((s) => {
                          const th = shiftTheme(s.type);
                          return (
                            <View
                              key={s.id}
                              testID={`shift-chip-${s.id}`}
                              style={[
                                styles.chip,
                                {
                                  backgroundColor: th.bg,
                                  borderColor: th.border,
                                  opacity: s.is_draft ? 1 : 0.85,
                                },
                              ]}
                            >
                              <Text
                                style={[styles.chipText, { color: th.text }]}
                                numberOfLines={1}
                              >
                                {th.label}
                              </Text>
                            </View>
                          );
                        })}
                        {dayShifts.length > 2 && (
                          <Text style={styles.moreText}>
                            +{dayShifts.length - 2}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* Current shifts */}
        <View style={styles.currentSection}>
          <View style={styles.currentHeader}>
            <Text style={styles.currentTitle}>Current shifts</Text>
            <TouchableOpacity
              onPress={plotCurrentShifts}
              disabled={plotStatus === "loading"}
              style={styles.currentPlotBtn}
            >
              <Ionicons
                name="calendar-outline"
                size={14}
                color={plotStatus === "loading" ? colors.textMuted : colors.neonHover}
              />
              <Text
                style={[
                  styles.currentPlotText,
                  plotStatus === "loading" && styles.currentPlotTextLoading,
                ]}
              >
                {plotStatus === "loading" ? "Plotting…" : "Plot"}
              </Text>
            </TouchableOpacity>
          </View>
          {plotStatus === "loading" && (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.neon} />
            </View>
          )}
          {plotStatus === "error" && plotError && (
            <View style={[styles.errorBox, { marginTop: spacing.sm }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{plotError}</Text>
            </View>
          )}
          {currentShifts.length === 0 ? (
            <Text style={styles.currentEmpty}>No shifts plotted yet for this month.</Text>
          ) : (
            <View style={styles.currentList}>
              {currentShifts.map((s) => {
                const th = shiftTheme(s.type);
                return (
                  <View key={s.id} style={styles.currentRow}>
                    <View
                      style={[
                        styles.currentDot,
                        { backgroundColor: th.text, borderColor: th.border },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.currentDate}>{shiftDateDisplay(s.date)}</Text>
                      <Text style={[styles.currentLabel, { color: th.text }]}>{th.label}</Text>
                      {s.start_time && s.end_time && (
                        <Text style={styles.currentTime}>
                          {s.start_time} → {s.end_time}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          {(["day", "night", "on_call", "off"] as const).map((t) => {
            const th = shiftTheme(t);
            return (
              <View key={t} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: th.text, borderColor: th.border },
                  ]}
                />
                <Text style={styles.legendText}>{th.label}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <ShiftEditor
        visible={!!selectedDate}
        token={token || ""}
        onClose={() => setSelectedDate(null)}
        date={selectedDate || today}
        existing={selectedDate ? shiftsByDate.get(selectedDate) || [] : []}
        onChanged={fetchShifts}
      />
    </SafeAreaView>
  );
}

function StatCard({
  label,
  count,
  icon,
  accent,
}: {
  label: string;
  count: number;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: boolean;
}) {
  return (
    <View
      testID={`stat-${label.toLowerCase()}`}
      style={[styles.statCard, accent && styles.statCardAccent]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={accent ? colors.neonHover : colors.textMuted}
      />
      <Text style={styles.statCount}>{count}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scrollBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  todayLink: {
    color: colors.textAccent,
    fontSize: 11,
    marginTop: 2,
    fontWeight: "600",
  },
  plotActionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  plotButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.neonHover,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 40,
    flexShrink: 1,
  },
  plotButtonText: {
    color: "#0B0619",
    fontSize: 12,
    fontWeight: "800",
  },
  plotNoteBox: {
    backgroundColor: colors.neonSoft,
    borderColor: colors.borderActive,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginBottom: spacing.xs,
  },
  plotNoteText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "flex-start",
    gap: 4,
  },
  statCardAccent: {
    borderColor: "rgba(168, 85, 247, 0.35)",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  statCount: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  weekHeader: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  gridWrap: {
    backgroundColor: colors.border,
    borderRadius: radius.lg,
    padding: 1,
    gap: 1,
    overflow: "hidden",
  },
  gridRow: {
    flexDirection: "row",
    gap: 1,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 0.94,
    backgroundColor: colors.bg,
    padding: 4,
    gap: 2,
  },
  cellOutside: {
    backgroundColor: "#080311",
  },
  cellToday: {
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  cellNum: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  cellNumOutside: {
    color: colors.textMuted,
    opacity: 0.4,
  },
  cellNumToday: {
    color: colors.neonHover,
  },
  chipStack: {
    gap: 2,
    marginTop: 2,
  },
  chip: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  moreText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "700",
    marginLeft: 2,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
    justifyContent: "center",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  legendText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  plotBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.neonSoft,
    borderWidth: 1,
    borderColor: colors.borderActive,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  plotBtnText: {
    color: colors.neonHover,
    fontSize: 13,
    fontWeight: "800",
  },
  currentSection: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  currentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  currentTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  currentPlotBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.neonSoft,
    borderWidth: 1,
    borderColor: colors.borderActive,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  currentPlotText: {
    color: colors.neonHover,
    fontSize: 11,
    fontWeight: "800",
  },
  currentPlotTextLoading: {
    color: colors.textMuted,
  },
  currentList: {
    gap: spacing.xs,
  },
  currentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  currentDate: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  currentLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  currentTime: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  currentEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorBox: {
    flexDirection: "row",
    backgroundColor: "rgba(248, 113, 113, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.4)",
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
});
