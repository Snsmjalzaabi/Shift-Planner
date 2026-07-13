import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, isPlusRequired, Shift } from "@/src/lib/api";
import { colors, radius, shiftTheme, spacing } from "@/src/theme/colors";
import { shiftDateDisplay } from "@/src/utils/dateUtils";
type Props = {
  visible: boolean;
  onClose: () => void;
  token: string;
  date: string;
  existing: Shift[];
  onChanged: () => void;
};

const TYPES: { value: Shift["type"]; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "day", label: "Day", icon: "sunny-outline" },
  { value: "night", label: "Night", icon: "moon-outline" },
  { value: "on_call", label: "On Call", icon: "call-outline" },
  { value: "off", label: "Off", icon: "cafe-outline" },
];

const DEFAULT_TIMES: Record<Shift["type"], [string, string]> = {
  day: ["07:00", "19:00"],
  night: ["19:00", "07:00"],
  on_call: ["09:00", "17:00"],
  off: ["", ""],
};

export function ShiftEditor({
  visible,
  onClose,
  token,
  date,
  existing,
  onChanged,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [type, setType] = useState<Shift["type"]>("day");
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedExisting = useMemo(
    () => [...existing].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [existing],
  );

  useEffect(() => {
    if (visible) {
      setType("day");
      setStartTime("07:00");
      setEndTime("19:00");
      setLocation("");
      setNote("");
      setError(null);
    }
  }, [visible, date]);

  const changeType = (t: Shift["type"]) => {
    setType(t);
    const [s, e] = DEFAULT_TIMES[t];
    setStartTime(s);
    setEndTime(e);
  };

  const addShift = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createShift(token, {
        date,
        type,
        start_time: startTime || null,
        end_time: endTime || null,
        location: location || null,
        note: note || null,
        is_draft: true,
      });
      setLocation("");
      setNote("");
      onChanged();
    } catch (e: any) {
      if (isPlusRequired(e)) {
        onClose();
        router.push("/(app)/upgrade");
        return;
      }
      setError(e?.message || "Could not save shift");
    } finally {
      setSaving(false);
    }
  };

  const removeShift = async (id: string) => {
    setBusyId(id);
    try {
      await api.deleteShift(token, id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const confirmShift = async (id: string) => {
    setBusyId(id);
    try {
      await api.confirmShift(token, id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ width: "100%" }}
        >
          <View
            testID="shift-editor-sheet"
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + spacing.lg },
            ]}
          >
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerLabel}>Draft Shift</Text>
                <Text style={styles.headerDate}>{shiftDateDisplay(date)}</Text>
              </View>
              <TouchableOpacity
                testID="shift-editor-close"
                onPress={onClose}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 460 }}
            >
              {sortedExisting.length > 0 && (
                <View style={styles.existingBlock}>
                  <Text style={styles.sectionTitle}>On this day</Text>
                  {sortedExisting.map((s) => {
                    const th = shiftTheme(s.type);
                    return (
                      <View
                        key={s.id}
                        style={[styles.existingRow, { borderColor: th.border }]}
                        testID={`existing-shift-${s.id}`}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={styles.existingHead}>
                            <View
                              style={[
                                styles.pill,
                                { backgroundColor: th.bg, borderColor: th.border },
                              ]}
                            >
                              <Text style={[styles.pillText, { color: th.text }]}>
                                {th.label}
                              </Text>
                            </View>
                            <Text style={styles.existingMeta}>
                              {s.is_draft ? "Draft" : "Confirmed"}
                            </Text>
                          </View>
                          {(s.start_time || s.end_time) && (
                            <Text style={styles.existingTime}>
                              {s.start_time || "—"} → {s.end_time || "—"}
                            </Text>
                          )}
                          {!!s.location && (
                            <Text style={styles.existingSub}>{s.location}</Text>
                          )}
                          {!!s.note && (
                            <Text style={styles.existingNote} numberOfLines={2}>
                              {s.note}
                            </Text>
                          )}
                        </View>
                        <View style={styles.existingActions}>
                          {s.is_draft && (
                            <TouchableOpacity
                              testID={`confirm-shift-${s.id}`}
                              disabled={busyId === s.id}
                              onPress={() => confirmShift(s.id)}
                              style={styles.iconBtn}
                            >
                              <Ionicons
                                name="checkmark-done"
                                size={18}
                                color={colors.success}
                              />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            testID={`delete-shift-${s.id}`}
                            disabled={busyId === s.id}
                            onPress={() => removeShift(s.id)}
                            style={styles.iconBtn}
                          >
                            {busyId === s.id ? (
                              <ActivityIndicator
                                size="small"
                                color={colors.danger}
                              />
                            ) : (
                              <Ionicons
                                name="trash-outline"
                                size={18}
                                color={colors.danger}
                              />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <Text style={styles.sectionTitle}>Add a shift</Text>

              <View style={styles.typeRow}>
                {TYPES.map((t) => {
                  const th = shiftTheme(t.value);
                  const active = type === t.value;
                  return (
                    <TouchableOpacity
                      key={t.value}
                      testID={`shift-type-${t.value}`}
                      onPress={() => changeType(t.value)}
                      style={[
                        styles.typeCard,
                        active && {
                          backgroundColor: th.bg,
                          borderColor: th.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={t.icon}
                        size={18}
                        color={active ? th.text : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.typeLabel,
                          active && { color: th.text },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {type !== "off" && (
                <View style={styles.timeRow}>
                  <TimeField
                    label="Start"
                    value={startTime}
                    onChangeText={setStartTime}
                    testID="input-start-time"
                  />
                  <TimeField
                    label="End"
                    value={endTime}
                    onChangeText={setEndTime}
                    testID="input-end-time"
                  />
                </View>
              )}

              <FieldSm
                label="Location"
                icon="location-outline"
                value={location}
                onChangeText={setLocation}
                placeholder="Ward 3, ICU, Home visit…"
                testID="input-location"
              />

              <FieldSm
                label="Note"
                icon="reader-outline"
                value={note}
                onChangeText={setNote}
                placeholder="Optional note"
                testID="input-note"
                multiline
              />

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={14}
                    color={colors.danger}
                  />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </ScrollView>

            <Pressable
              testID="save-shift-button"
              onPress={addShift}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && { opacity: 0.85 },
                saving && { opacity: 0.7 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#0B0619" />
              ) : (
                <>
                  <Ionicons name="add" size={18} color="#0B0619" />
                  <Text style={styles.saveText}>Save draft shift</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function TimeField({
  label,
  value,
  onChangeText,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  testID: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <View style={styles.timeInputWrap}>
        <Ionicons
          name="time-outline"
          size={16}
          color={colors.textMuted}
          style={{ marginRight: 6 }}
        />
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder="HH:MM"
          placeholderTextColor={colors.textMuted}
          style={styles.timeInput}
          keyboardType={
            Platform.OS === "ios" ? "numbers-and-punctuation" : "default"
          }
          maxLength={5}
        />
      </View>
    </View>
  );
}

function FieldSm({
  label,
  icon,
  testID,
  multiline,
  ...inputProps
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  testID?: string;
  multiline?: boolean;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.smallLabel}>{label}</Text>
      <View
        style={[
          styles.smInputWrap,
          multiline && { minHeight: 74, alignItems: "flex-start", paddingTop: 10 },
        ]}
      >
        <Ionicons
          name={icon}
          size={16}
          color={colors.textMuted}
          style={{ marginRight: 8, marginTop: multiline ? 2 : 0 }}
        />
        <TextInput
          testID={testID}
          placeholderTextColor={colors.textMuted}
          style={[styles.smInput, multiline && { textAlignVertical: "top" }]}
          multiline={multiline}
          {...inputProps}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(3, 1, 10, 0.7)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  headerLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerDate: {
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
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  existingBlock: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  existingRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  existingHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 6,
  },
  existingTime: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  existingSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  existingNote: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    fontStyle: "italic",
  },
  existingMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  existingActions: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  typeCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    gap: 4,
  },
  typeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  timeRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  smallLabel: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  timeInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  timeInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 0,
  },
  smInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  smInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14.5,
    paddingVertical: 8,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(248, 113, 113, 0.10)",
    borderColor: "rgba(248, 113, 113, 0.35)",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12.5,
    flex: 1,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.neon,
    borderRadius: radius.md,
    height: 50,
    marginTop: spacing.lg,
    shadowColor: colors.neon,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 6,
  },
  saveText: {
    color: "#0B0619",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
