import { Image } from "expo-image";
import { StyleSheet, View, ViewStyle } from "react-native";

import { colors, radius } from "@/src/theme/colors";

// Central logo asset. Replace the require path below to swap in an official
// Foxory logo file — the rest of the app consumes this component only.
const LOGO_SOURCE = require("../../assets/images/foxory-logo.png");

type LogoSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<LogoSize, number> = {
  sm: 28,
  md: 40,
  lg: 64,
  xl: 112,
};

type Props = {
  size?: LogoSize;
  withHalo?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function FoxoryLogo({
  size = "md",
  withHalo = false,
  style,
  testID = "foxory-logo",
}: Props) {
  const dim = SIZES[size];
  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        {
          width: dim,
          height: dim,
          borderRadius: size === "sm" ? radius.md : radius.lg,
        },
        withHalo && styles.halo,
        style,
      ]}
    >
      <Image
        source={LOGO_SOURCE}
        style={{ width: dim, height: dim }}
        contentFit="contain"
        transition={200}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  halo: {
    shadowColor: colors.neon,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    // Android
    elevation: 12,
  },
});
