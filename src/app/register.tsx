import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_ENDPOINTS, readJsonResponse } from "@/lib/api";

type RegisterResponse = {
  message: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: "user";
  };
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestInProgress = useRef(false);

  const createAccount = async () => {
    if (requestInProgress.current) return;
    setErrorMessage("");

    if (!name.trim()) {
      setErrorMessage("Enter your full name.");
      return;
    }
    if (!email.trim()) {
      setErrorMessage("Enter your email address.");
      return;
    }
    if (!emailPattern.test(email.trim())) {
      setErrorMessage("Enter a valid email address.");
      return;
    }
    if (!password) {
      setErrorMessage("Enter a password.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (!confirmPassword) {
      setErrorMessage("Confirm your password.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    requestInProgress.current = true;
    setIsSubmitting(true);
    try {
      const response = await fetch(API_ENDPOINTS.register, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const result = await readJsonResponse<RegisterResponse>(response);
      if (!result.user || result.user.role !== "user") {
        throw new Error("The server returned an invalid registration response.");
      }
      router.replace({ pathname: "/login", params: { registered: "true" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("HTTP 409:")) {
        setErrorMessage("An account with this email already exists.");
      } else if (message.startsWith("HTTP 422:")) {
        setErrorMessage("Please check your details. Passwords must be at least 8 characters.");
      } else if (/^HTTP 5\d\d:/.test(message)) {
        setErrorMessage("The server could not create your account. Please try again.");
      } else if (error instanceof TypeError) {
        setErrorMessage("Unable to connect to RoadGuard. Check your connection and try again.");
      } else {
        setErrorMessage(message || "Unable to create your account. Please try again.");
      }
    } finally {
      requestInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.form}>
            <Text style={styles.brand}>RoadGuard</Text>
            <Text style={styles.heading}>Create Account</Text>
            <Text style={styles.subtitle}>Join RoadGuard to report road issues.</Text>

            <TextInput
              accessibilityLabel="Full Name"
              autoComplete="name"
              autoCapitalize="words"
              editable={!isSubmitting}
              onChangeText={setName}
              placeholder="Full Name"
              placeholderTextColor="#71717A"
              returnKeyType="next"
              style={styles.input}
              value={name}
            />
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              editable={!isSubmitting}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#71717A"
              returnKeyType="next"
              style={styles.input}
              value={email}
            />
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="new-password"
              editable={!isSubmitting}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#71717A"
              returnKeyType="next"
              secureTextEntry
              style={styles.input}
              value={password}
            />
            <TextInput
              accessibilityLabel="Confirm Password"
              autoCapitalize="none"
              autoComplete="new-password"
              editable={!isSubmitting}
              onChangeText={setConfirmPassword}
              onSubmitEditing={() => void createAccount()}
              placeholder="Confirm Password"
              placeholderTextColor="#71717A"
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
            />

            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting }}
              disabled={isSubmitting}
              onPress={() => void createAccount()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !isSubmitting && styles.pressed,
                isSubmitting && styles.disabled,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <Pressable
                accessibilityRole="link"
                disabled={isSubmitting}
                onPress={() => router.replace("/login")}
                hitSlop={8}
              >
                <Text style={styles.link}>Log In</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F6F5",
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  form: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 13,
  },
  brand: {
    color: "#176B52",
    fontSize: 18,
    fontWeight: "700",
  },
  heading: {
    color: "#17221E",
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    marginBottom: 7,
    color: "#66736A",
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#C9D2CE",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    color: "#17221E",
    fontSize: 16,
  },
  error: {
    color: "#B42318",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#176B52",
    marginTop: 4,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.65,
  },
  pressed: {
    opacity: 0.82,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    marginTop: 7,
  },
  footerText: {
    color: "#66736A",
    fontSize: 14,
  },
  link: {
    color: "#176B52",
    fontSize: 14,
    fontWeight: "700",
  },
});
