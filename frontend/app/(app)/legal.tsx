import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { LegalScreen, P } from "@/src/components/LegalScreen";
import { colors, radius, spacing } from "@/src/theme/colors";

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
};

export default function Legal() {
  const router = useRouter();
  const rows: Row[] = [
    {
      icon: "shield-checkmark-outline",
      title: "Privacy Policy",
      subtitle: "What data we collect and how we use it.",
      onPress: () => router.push("/(app)/privacy"),
      testID: "legal-open-privacy",
    },
    {
      icon: "document-text-outline",
      title: "Terms of Service",
      subtitle: "The agreement between you and Foxory.",
      onPress: () => router.push("/(app)/terms"),
      testID: "legal-open-terms",
    },
    {
      icon: "mail-outline",
      title: "Contact",
      subtitle: "support@foxory.info",
      onPress: () => Linking.openURL("mailto:support@foxory.info"),
      testID: "legal-open-contact",
    },
    {
      icon: "globe-outline",
      title: "foxory.net",
      subtitle: "The creator's site.",
      onPress: () => Linking.openURL("https://foxory.net"),
      testID: "legal-open-website",
    },
    {
      icon: "trash-outline",
      title: "Delete my account",
      subtitle: "Permanently remove your account and all data.",
      onPress: () => router.push("/(app)/delete-account"),
      testID: "legal-open-delete",
      danger: true,
    },
  ];

  return (
    <LegalScreen
      title="Legal & Support"
      eyebrow="Foxory Shift Calendar"
      testID="legal-index"
    >
      <P>
        Everything you need to know about how Foxory Shift Calendar handles
        your data, plus one-tap access to account controls Apple and Google
        require to live inside the app.
      </P>
      <View style={{ height: spacing.md }} />
      {rows.map((r) => (
        <TouchableOpacity
          key={r.testID}
          testID={r.testID}
          onPress={r.onPress}
          activeOpacity={0.8}
          style={[
            styles.row,
            r.danger && styles.rowDanger,
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              r.danger && { backgroundColor: "rgba(248, 113, 113, 0.12)" },
            ]}
          >
            <Ionicons
              name={r.icon}
              size={16}
              color={r.danger ? colors.danger : colors.textAccent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, r.danger && { color: colors.danger }]}>
              {r.title}
            </Text>
            <Text style={styles.sub}>{r.subtitle}</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      ))}
    </LegalScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  rowDanger: {
    borderColor: "rgba(248, 113, 113, 0.35)",
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  sub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
