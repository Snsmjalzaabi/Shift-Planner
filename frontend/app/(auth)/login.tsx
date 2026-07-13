import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { CreatorSignature } from "@/src/components/CreatorSignature";
import { FoxoryLogo } from "@/src/components/FoxoryLogo";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing } from "@/src/theme/colors";

type Mode = "login" | "register";

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName || undefined);
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <LinearGradient
        colors={["#0D0620", "#090514", "#090514"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} pointerEvents="none" />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <FoxoryLogo size="xl" withHalo testID="login-logo" />
          <Text style={styles.title} testID="app-name">
            Foxory Shift Calendar
          </Text>
          <Text style={styles.subtitle} testID="app-subtitle">
            Smart shift planning for nurses and caregivers.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TabButton
              label="Sign in"
              active={mode === "login"}
              onPress={() => setMode("login")}
              testID="tab-login"
            />
            <TabButton
              label="Create account"
              active={mode === "register"}
              onPress={() => setMode("register")}
              testID="tab-register"
            />
          </View>

          {mode === "register" && (
            <Field
              label="Display name"
              icon="person-outline"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Alex Nurse"
              autoCapitalize="words"
              testID="input-display-name"
            />
          )}

          <Field
            label="Email"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="input-email"
          />

          <Field
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            testID="input-password"
            rightAdornment={
              <TouchableOpacity
                testID="toggle-password"
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            }
          />

          {error && (
            <View style={styles.errorBox} testID="login-error">
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color={colors.danger}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            testID="login-submit-button"
            onPress={submit}
            disabled={isSubmitting}
            style={({ pressed }) => [
              styles.submit,
              pressed && { opacity: 0.85 },
              isSubmitting && { opacity: 0.7 },
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#0B0619" />
            ) : (
              <Text style={styles.submitText}>
                {mode === "login" ? "Sign in" : "Create account"}
              </Text>
            )}
          </Pressable>

          <Text style={styles.helperText}>
            {mode === "login"
              ? "Sign in with the account you were provided."
              : "Password must be at least 6 characters."}
          </Text>
        </View>

        <View style={styles.footer}>
          <CreatorSignature testID="login-footer-signature" />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      activeOpacity={0.8}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Field({
  label,
  icon,
  rightAdornment,
  testID,
  ...inputProps
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  rightAdornment?: React.ReactNode;
  testID?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <Ionicons
          name={icon}
          size={18}
          color={colors.textMuted}
          style={{ marginRight: 8 }}
        />
        <TextInput
          testID={testID}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          {...inputProps}
        />
        {rightAdornment ? (
          <View style={{ marginLeft: 8 }}>{rightAdornment}</View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  glow: {
    position: "absolute",
    top: -140,
    left: -80,
    right: -80,
    height: 340,
    backgroundColor: colors.neon,
    opacity: 0.18,
    borderRadius: 400,
    ...Platform.select({
      web: { filter: "blur(90px)" as any },
    }),
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  header: {
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 0.4,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    maxWidth: 290,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.elevated,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: 0,
  },
  submit: {
    backgroundColor: colors.neon,
    borderRadius: radius.md,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    shadowColor: colors.neon,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  submitText: {
    color: "#0B0619",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
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
  },
  errorText: {
    color: colors.danger,
    fontSize: 12.5,
    flex: 1,
  },
  footer: {
    alignItems: "center",
    marginTop: "auto",
    paddingTop: spacing.lg,
  },
});
