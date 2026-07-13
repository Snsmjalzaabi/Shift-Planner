import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CreatorSignature } from "@/src/components/CreatorSignature";
import { DashboardHeader } from "@/src/components/DashboardHeader";
import { FoxoryLogo } from "@/src/components/FoxoryLogo";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing } from "@/src/theme/colors";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const source = user?.plan_source || (user?.plan === "plus" ? "paid" : "free");
  const isPlus = user?.plan === "plus";
  const isCcad = source === "ccad";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <DashboardHeader />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={styles.profileCard} testID="settings-profile-card">
          <FoxoryLogo size="lg" withHalo />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>
              {user?.display_name || user?.email?.split("@")[0]}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {user?.email}
            </Text>
            <View style={styles.profileBadges}>
              <View
                style={[
                  styles.smallBadge,
                  isCcad
                    ? styles.smallBadgeCcad
                    : isPlus
                    ? styles.smallBadgePlus
                    : styles.smallBadgeFree,
                ]}
              >
                <Text
                  style={[
                    styles.smallBadgeText,
                    isCcad
                      ? styles.smallBadgeCcadText
                      : isPlus
                      ? styles.smallBadgePlusText
                      : styles.smallBadgeFreeText,
                  ]}
                >
                  {isCcad
                    ? "CCAD FREE ACCESS"
                    : isPlus
                    ? "PLUS $2.99/YEAR"
                    : "FOXORY FREE"}
                </Text>
              </View>
              {user?.is_superuser && (
                <View style={[styles.smallBadge, styles.smallBadgeAdmin]}>
                  <Text
                    style={[styles.smallBadgeText, styles.smallBadgeAdminText]}
                  >
                    SUPERUSER
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* App section */}
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.group}>
          <Row
            icon="information-circle-outline"
            label="App name"
            value="Foxory Shift Calendar"
          />
          <Row
            icon="ribbon-outline"
            label="Tagline"
            value="Smart shift planning for nurses and caregivers"
            multiline
          />
          <Row
            icon="code-slash-outline"
            label="Version"
            value="1.0.0 MVP"
            last
          />
        </View>

        {/* Plan */}
        <Text style={styles.sectionTitle}>Access</Text>
        <View style={styles.group}>
          {isCcad ? (
            <View style={styles.planRow} testID="ccad-access-row">
              <Ionicons name="medical" size={18} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>CCAD Free Access — active</Text>
                <Text style={styles.planSub}>
                  Full Foxory Plus features are complimentary for Cleveland
                  Clinic Abu Dhabi staff.
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              testID="upgrade-open-btn"
              onPress={() => router.push("/(app)/upgrade")}
              style={styles.planRow}
              activeOpacity={0.75}
            >
              <Ionicons
                name={isPlus ? "ribbon" : "sparkles"}
                size={18}
                color={colors.neonHover}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>
                  {isPlus ? "Foxory Plus — active" : "Upgrade to Foxory Plus"}
                </Text>
                <Text style={styles.planSub}>
                  {isPlus
                    ? "Multi-month planning, XLSX export, email delivery."
                    : "AED 10.99/year · XLSX exports, email sending, multi-month planning."}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Actions */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.group}>
          <TouchableOpacity
            testID="logout-btn"
            onPress={logout}
            style={styles.actionRow}
            activeOpacity={0.75}
          >
            <View style={[styles.actionIconWrap, styles.actionIconDanger]}>
              <Ionicons name="log-out-outline" size={16} color={colors.danger} />
            </View>
            <Text style={[styles.actionLabel, { color: colors.danger }]}>
              Sign out
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Footer signature */}
        <View style={styles.footer} testID="settings-footer">
          <CreatorSignature />
          <Text style={styles.footerDetail}>
            A creator signature — not an advertisement.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  multiline,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  multiline?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={15} color={colors.textAccent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={multiline ? 3 : 1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  profileCard: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  profileName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
  },
  profileEmail: {
    color: colors.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  profileBadges: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    flexWrap: "wrap",
  },
  smallBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  smallBadgeFree: {
    borderColor: "rgba(168, 85, 247, 0.35)",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  smallBadgePlus: {
    borderColor: colors.neon,
    backgroundColor: "rgba(168, 85, 247, 0.22)",
  },
  smallBadgeCcad: {
    borderColor: "rgba(74, 222, 128, 0.45)",
    backgroundColor: "rgba(74, 222, 128, 0.14)",
  },
  smallBadgeAdmin: {
    borderColor: "rgba(74, 222, 128, 0.4)",
    backgroundColor: "rgba(74, 222, 128, 0.12)",
  },
  smallBadgeText: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  smallBadgeFreeText: { color: colors.textAccent },
  smallBadgePlusText: { color: colors.neonHover },
  smallBadgeCcadText: { color: colors.success },
  smallBadgeAdminText: { color: colors.success },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowDivider: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: "600",
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  planTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  planSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  actionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  actionIconDanger: {
    backgroundColor: "rgba(248, 113, 113, 0.12)",
  },
  actionLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  footer: {
    alignItems: "center",
    gap: 4,
    marginTop: spacing.md,
  },
  footerDetail: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontStyle: "italic",
  },
});
