import * as Linking from "expo-linking";
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";

import { colors } from "@/src/theme/colors";

type Props = {
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function CreatorSignature({
  compact = false,
  style,
  testID = "creator-signature",
}: Props) {
  const openLink = () => {
    Linking.openURL("https://foxory.net").catch(() => {});
  };

  return (
    <View testID={testID} style={[styles.container, style]}>
      <Text style={[styles.prefix, compact && styles.compactText]}>
        Created by{" "}
      </Text>
      <TouchableOpacity
        testID="creator-signature-link"
        onPress={openLink}
        activeOpacity={0.6}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.link, compact && styles.compactText]}>Foxory.net</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  prefix: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  link: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
    textDecorationColor: colors.neon,
  },
  compactText: {
    fontSize: 11,
  },
});
