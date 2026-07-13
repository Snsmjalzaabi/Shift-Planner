import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CreatorSignature } from "@/src/components/CreatorSignature";
import { FoxoryLogo } from "@/src/components/FoxoryLogo";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/theme/colors";

type BillingConfig = Awaited<ReturnType<typeof api.billingConfig>>;

export default function UpgradeScreen() {
  const router = useRouter();
  const { token, user, refresh } = useAuth();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<{
    kind: "idle" | "pending" | "success" | "canceled" | "error";
    message?: string;
  }>({ kind: "idle" });

  const isPlus = user?.plan === "plus";

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.billingConfig();
        setConfig(cfg);
      } catch (e: any) {
        setStatus({ kind: "error", message: e?.message || "Failed to load billing config." });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const doUpgrade = useCallback(async () => {
    if (!token) return;
    setCheckingOut(true);
    setStatus({ kind: "pending", message: "Opening Ziina checkout…" });
    try {
      const successUrl =
        Platform.OS === "web"
          ? `${window.location.origin}/(app)/upgrade?billing=success`
          : "foxory://billing/success";
      const cancelUrl =
        Platform.OS === "web"
          ? `${window.location.origin}/(app)/upgrade?billing=cancel`
          : "foxory://billing/cancel";

      const session = await api.checkout(token, {
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      const opened = await WebBrowser.openAuthSessionAsync(
        session.redirect_url,
        successUrl,
      );

      // On mobile openAuthSessionAsync blocks until dismiss/return.
      // On web it opens a popup and resolves to {type:'dismiss'}.
      const dismissed =
        opened.type === "cancel" || opened.type === "dismiss";
      if (dismissed) {
        setStatus({ kind: "pending", message: "Verifying with Ziina…" });
      }

      setVerifying(true);
      const check = await api.verifyCheckout(token, session.payment_intent_id);
      if (check.activated) {
        await refresh();
        setStatus({
          kind: "success",
          message: `You're on Foxory Plus until ${
            check.plus_expires_at
              ? new Date(check.plus_expires_at).toLocaleDateString()
              : "next year"
          }.`,
        });
      } else {
        setStatus({
          kind: check.status === "canceled" ? "canceled" : "pending",
          message:
            check.status === "canceled"
              ? "Checkout canceled. You can try again anytime."
              : `Payment status: ${check.status}. Refresh in a moment.`,
        });
      }
    } catch (e: any) {
      setStatus({ kind: "error", message: e?.message || "Upgrade failed." });
    } finally {
      setCheckingOut(false);
      setVerifying(false);
    }
  }, [token, refresh]);

  const plan = config?.plans?.[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <LinearGradient
        colors={["#150927", "#0B0620", "#090514"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} pointerEvents="none" />

      <View style={styles.headerBar}>
        <TouchableOpacity
          testID="upgrade-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Upgrade</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <FoxoryLogo size="xl" withHalo />
          <Text style={styles.eyebrow}>Foxory Plus</Text>
          <Text style={styles.heroTitle}>
            {isPlus ? "You’re on Plus" : "Unlock the full planner"}
          </Text>
          <Text style={styles.heroSub}>
            {isPlus
              ? "All Plus features are unlocked. Thank you for supporting the app."
              : "Multi-month planning, XLSX exports, and real email delivery — one price, one year."}
          </Text>

          <View style={styles.priceRow}>
            <Text style={styles.priceMain}>
              {plan?.price_display || "AED 10.99/year"}
            </Text>
            <View style={styles.priceBadge}>
              <Ionicons name="sparkles" size={11} color={colors.neonHover} />
              <Text style={styles.priceBadgeText}>
                {plan?.badge_display || "Plus $2.99/year"}
              </Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator color={colors.neon} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What you get</Text>
            {(plan?.features || []).map((f) => (
              <View key={f} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={colors.neonHover}
                  />
                </View>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            <View style={styles.metaRow}>
              <Ionicons
                name="card-outline"
                size={14}
                color={colors.textMuted}
              />
              <Text style={styles.metaText}>
                Powered by <Text style={styles.metaBold}>Ziina</Text> · secure
                hosted checkout
              </Text>
            </View>
            {config?.test_mode && (
              <View style={styles.metaRow}>
                <Ionicons
                  name="flask-outline"
                  size={14}
                  color={colors.textAccent}
                />
                <Text style={[styles.metaText, { color: colors.textAccent }]}>
                  Test mode — use Ziina test cards, no money is charged.
                </Text>
              </View>
            )}
          </View>
        )}

        {status.kind !== "idle" && (
          <View
            testID={`upgrade-status-${status.kind}`}
            style={[
              styles.statusBox,
              status.kind === "success" && styles.statusSuccess,
              status.kind === "error" && styles.statusError,
              (status.kind === "pending" || status.kind === "canceled") &&
                styles.statusPending,
            ]}
          >
            {status.kind === "success" && (
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={colors.success}
              />
            )}
            {status.kind === "error" && (
              <Ionicons
                name="alert-circle"
                size={18}
                color={colors.danger}
              />
            )}
            {(status.kind === "pending" || status.kind === "canceled") &&
              (verifying ? (
                <ActivityIndicator color={colors.textAccent} size="small" />
              ) : (
                <Ionicons
                  name="hourglass-outline"
                  size={18}
                  color={colors.textAccent}
                />
              ))}
            <Text style={styles.statusText}>{status.message}</Text>
          </View>
        )}

        {!isPlus && (
          <Pressable
            testID="upgrade-cta"
            onPress={doUpgrade}
            disabled={checkingOut || !config?.configured}
            style={({ pressed }) => [
              styles.cta,
              pressed && { opacity: 0.85 },
              (checkingOut || !config?.configured) && { opacity: 0.7 },
            ]}
          >
            {checkingOut ? (
              <ActivityIndicator color="#0B0619" />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color="#0B0619" />
                <Text style={styles.ctaText}>
                  Upgrade to Plus — {plan?.price_display || "AED 10.99/year"}
                </Text>
              </>
            )}
          </Pressable>
        )}

        {isPlus && (
          <View style={styles.plusCard} testID="already-plus">
            <Ionicons name="ribbon" size={18} color={colors.neonHover} />
            <Text style={styles.plusText}>
              All features unlocked. Enjoy the calendar.
            </Text>
          </View>
        )}

        {!config?.configured && !loading && (
          <Text style={styles.warnText}>
            Ziina is not configured on the backend. Set{" "}
            <Text style={{ fontFamily: "monospace" }}>ZIINA_API_KEY</Text> to
            enable checkout.
          </Text>
        )}

        <Text style={styles.legal}>
          Cancel anytime before renewal. Ziina Payment Services · Test mode is{" "}
          {config?.test_mode ? "ON" : "OFF"}.
        </Text>

        <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
          <CreatorSignature />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  glow: {
    position: "absolute",
    top: -140,
    left: -80,
    right: -80,
    height: 320,
    backgroundColor: colors.neon,
    opacity: 0.15,
    borderRadius: 400,
    ...Platform.select({ web: { filter: "blur(90px)" as any } }),
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  eyebrow: {
    color: colors.textAccent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: spacing.md,
  },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    maxWidth: 320,
    lineHeight: 20,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  priceMain: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.4)",
    backgroundColor: "rgba(168, 85, 247, 0.12)",
  },
  priceBadgeText: {
    color: colors.neonHover,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  featureIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.35)",
  },
  featureText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13.5,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 11.5,
    flex: 1,
  },
  metaBold: { color: colors.textAccent, fontWeight: "700" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.neon,
    borderRadius: radius.md,
    height: 54,
    marginTop: spacing.sm,
    shadowColor: colors.neon,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaText: {
    color: "#0B0619",
    fontWeight: "800",
    fontSize: 15.5,
    letterSpacing: 0.3,
  },
  plusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.4)",
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  plusText: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: "700",
    flex: 1,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statusText: {
    color: colors.textPrimary,
    fontSize: 12.5,
    flex: 1,
  },
  statusSuccess: {
    borderColor: "rgba(74, 222, 128, 0.4)",
    backgroundColor: "rgba(74, 222, 128, 0.12)",
  },
  statusError: {
    borderColor: "rgba(248, 113, 113, 0.4)",
    backgroundColor: "rgba(248, 113, 113, 0.12)",
  },
  statusPending: {
    borderColor: "rgba(168, 85, 247, 0.4)",
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },
  warnText: {
    color: colors.textMuted,
    fontSize: 11.5,
    textAlign: "center",
    marginTop: 4,
  },
  legal: {
    color: colors.textMuted,
    fontSize: 10.5,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
