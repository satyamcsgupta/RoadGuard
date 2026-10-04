import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useAuthSession } from "@/hooks/use-auth-session";
import { API_ENDPOINTS, readJsonResponse } from "@/lib/api";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type LoginResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
};

export default function LoginScreen() {
  const { setAuthenticatedUser } = useAuthSession();
  const { registered } = useLocalSearchParams<{ registered?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const requestInProgress = useRef(false);

  const handleLogin = async () => {
    if (requestInProgress.current) return;
    setErrorMessage("");
    if (!email.trim()) {
      setErrorMessage("Enter your email address.");
      return;
    }
    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }

    requestInProgress.current = true;
    setIsLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (response.status === 401) {
        setErrorMessage("Invalid email or password.");
        return;
      }

      const data = await readJsonResponse<LoginResponse>(response);
      if (!data.access_token || !data.user) {
        throw new Error("The server returned an invalid login response.");
      }
      await SecureStore.setItemAsync("roadguard_access_token", data.access_token);
      await SecureStore.setItemAsync(
        "roadguard_user",
        JSON.stringify({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
        })
      );
      setAuthenticatedUser(data.user);
      router.replace("/(app)/(tabs)");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to log in right now. Please try again."
      );
    } finally {
      requestInProgress.current = false;
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={styles.content}>
        <Text style={styles.brand}>RoadGuard</Text>
        <Text style={styles.title}>Log In</Text>
        {registered === "true" && (
          <Text style={styles.success}>Account created. You can now log in.</Text>
        )}
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          style={styles.input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Password"
          autoComplete="password"
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => void handleLogin()}
          style={[styles.primary, isLoading && styles.disabled]}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryText}>Log In</Text>
          )}
        </Pressable>
        <Pressable onPress={() => router.push("/register")} style={styles.link}>
          <Text style={styles.linkText}>Don't have an account? Create Account</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#F4F6F5" },
  content: { width: "100%", maxWidth: 440, alignSelf: "center", gap: 14 },
  brand: { color: "#1B5E3B", fontSize: 18, fontWeight: "700", textAlign: "center" },
  title: { color: "#17231D", fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: "#D6DED8", backgroundColor: "#FFFFFF", paddingHorizontal: 16, color: "#17231D" },
  primary: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#1B5E3B" },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.65 },
  error: { color: "#B42318" },
  success: { color: "#176B52", textAlign: "center" },
  link: { paddingVertical: 10, alignItems: "center" },
  linkText: { color: "#1B5E3B", fontWeight: "600" },
});