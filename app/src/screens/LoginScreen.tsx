import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { getCaptcha } from "../sync/api";

export function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [captcha, setCaptcha] = useState<{ id: string; question: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCaptcha = useCallback(() => {
    setCaptchaAnswer("");
    getCaptcha()
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(refreshCaptcha, [refreshCaptcha]);

  async function submit() {
    if (!captcha) return;
    setError(null);
    setLoading(true);
    try {
      const options = { captchaId: captcha.id, captchaAnswer: Number(captchaAnswer), rememberMe };
      if (mode === "signIn") {
        await signIn(email.trim(), password, options);
      } else {
        await signUp(email.trim(), password, options);
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>Clocker</Text>
      <Text style={styles.subtitle}>Track hours across every job. Works offline, syncs when you're back online.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

      {captcha && (
        <View style={styles.captchaRow}>
          <Text style={styles.captchaQuestion}>{captcha.question}</Text>
          <TextInput
            style={[styles.input, styles.captchaInput]}
            placeholder="Answer"
            keyboardType="number-pad"
            value={captchaAnswer}
            onChangeText={setCaptchaAnswer}
          />
        </View>
      )}

      <TouchableOpacity style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)}>
        <View style={[styles.checkboxBox, rememberMe && styles.checkboxBoxChecked]}>
          {rememberMe && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.rememberText}>Remember me</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={styles.button}
        onPress={submit}
        disabled={loading || !email || password.length < 8 || !captcha || !captchaAnswer}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "signIn" ? "Sign In" : "Create Account"}</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
        <Text style={styles.switchText}>
          {mode === "signIn" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  subtitle: { textAlign: "center", color: "#666", marginBottom: 32 },
  // color/backgroundColor set explicitly (not just relying on defaults) because Android's
  // autofill can tint a recognized login field's background — without an explicit text
  // color here, the typed characters can end up the same color as that OS-applied tint
  // and become invisible even though they're really there.
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16, color: "#111", backgroundColor: "#fff" },
  captchaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  captchaQuestion: { flex: 1, fontSize: 15, color: "#333" },
  captchaInput: { flex: 0, width: 90, marginBottom: 8 },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  checkboxBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: "#999", alignItems: "center", justifyContent: "center" },
  checkboxBoxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  rememberText: { fontSize: 14, color: "#333" },
  button: { backgroundColor: "#2563eb", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  switchText: { textAlign: "center", color: "#2563eb", marginTop: 16 },
  error: { color: "#dc2626", textAlign: "center", marginBottom: 8 },
});
