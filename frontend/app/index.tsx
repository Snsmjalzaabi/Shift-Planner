import { Redirect } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme/colors";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.neon} size="large" />
      </View>
    );
  }

  return isAuthenticated ? (
    <Redirect href="/(app)/dashboard" />
  ) : (
    <Redirect href="/(auth)/login" />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
