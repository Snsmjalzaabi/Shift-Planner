import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

import { CreatorSignature } from "@/src/components/CreatorSignature";
import { FoxoryLogo } from "@/src/components/FoxoryLogo";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme/colors";

export function AccessGate() {
  const { user, verifyCcadAccess, activateTestSubscription, logout } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [code, setCode] = useState("123456");
  const [error, setError] = useState("");

  const verify = async () => {
    setError("");
    try {
      await verifyCcadAccess(email.trim(), code.trim());
    } catch (e: any) {
      setError(e?.message || "Could not verify CCAD access.");
    }
  };

  const subscribe = async () => {
    setError("");
    try {
      await activateTestSubscription();
    } catch (e: any) {
      setError(e?.message || "Could not activate subscription.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center", gap: 14 }}>
      <FoxoryLogo size="xl" withHalo />
      <Text style={{ color: colors.textPrimary, fontSize: 28, fontWeight: "800", textAlign: "center" }}>Choose Access</Text>
      <Text style={{ color: colors.textSecondary, textAlign: "center" }}>CCAD employees use the app free. Everyone else uses the $2.99/year plan.</Text>

      <TextInput value={email} onChangeText={setEmail} placeholder="CCAD work email" placeholderTextColor={colors.textMuted} style={{ color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, padding: 12, borderRadius: 12 }} />
      <TextInput value={code} onChangeText={setCode} placeholder="Verification code" placeholderTextColor={colors.textMuted} style={{ color: colors.textPrimary, borderColor: colors.border, borderWidth: 1, padding: 12, borderRadius: 12 }} />

      <TouchableOpacity onPress={verify} style={{ backgroundColor: colors.neon, padding: 14, borderRadius: 12 }}>
        <Text style={{ color: "#0B0619", textAlign: "center", fontWeight: "800" }}>Verify CCAD Access</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={subscribe} style={{ borderColor: colors.neon, borderWidth: 1, padding: 14, borderRadius: 12 }}>
        <Text style={{ color: colors.textPrimary, textAlign: "center", fontWeight: "800" }}>Activate Test Subscription — $2.99/year</Text>
      </TouchableOpacity>

      {error ? <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text> : null}

      <TouchableOpacity onPress={logout}>
        <Text style={{ color: colors.textMuted, textAlign: "center" }}>Sign out</Text>
      </TouchableOpacity>

      <CreatorSignature />
    </View>
  );
}
