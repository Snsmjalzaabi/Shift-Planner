import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { FoxoryLogo } from "@/src/components/FoxoryLogo";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing } from "@/src/theme/colors";

type Props = {
  showBack?: boolean;
  title?: string;
};

export function DashboardHeader({ showBack, title }: Props) {
  const { user } = useAuth();
  const router = useRouter();

  const plan = user?.plan === "plus" ? "plus" : "free";
  const badgeLabel = plan === "plus" ? "Foxory Plus" : "Foxory Free";
  const badgeVariant: "plus" | "free" = plan;

  return (
    <View testID="dashboard-header" style={styles.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          {showBack ? (
            <TouchableOpacity
              testID="header-back-btn"
              onPress={() => router.back()}
              style={styles.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <FoxoryLogo size="sm" />
          )}
          <View style={styles.titleBlock}>
            <Text style={styles.appName} numberOfLines={1}>
              {title || "Foxory Shift Calendar"}
            </Text>
            {!title && (
              <Text style={styles.appTagline} numberOfLines={1}>
                Smart shift planning
              </Text>
            )}
          </View>
        </View>

        <View
          testID={`account-badge-${badgeVariant}`}
          style={[
            styles.badge,
            badgeVariant === "plus"
              ? styles.badgePlus
              : styles.badgeFree,
          ]}
        >
          <Ionicons
            name={
              badgeVariant === "plus"
                ? "sparkles"
                : "shield-checkmark"
            }
            size={11}
            color={
              badgeVariant === "plus"
                ? colors.neonHover
                : colors.textAccent
            }
            style={{ marginRight: 4 }}
          />
          <Text
            style={[
              styles.badgeText,
              badgeVariant === "plus"
                ? styles.badgePlusText
                : styles.badgeFreeText,
            ]}
          >
            {badgeLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flex: 1,
    flexShrink: 1,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  appName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  appTagline: {
    color: colors.textMuted,
    fontSize: 10.5,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 0,
  },
  badgeFree: {
    borderColor: "rgba(168, 85, 247, 0.35)",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  badgePlus: {
    borderColor: colors.neon,
    backgroundColor: "rgba(168, 85, 247, 0.22)",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  badgeFreeText: {
    color: colors.textAccent,
  },
  badgePlusText: {
    color: colors.neonHover,
  },
});
