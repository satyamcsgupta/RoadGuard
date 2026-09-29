import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
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

const LOGIN_URL = "http://10.41.228.118:8000/login";

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
      let response: Response;
      try {
        response = await fetch(LOGIN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        console.log("LOGIN RESPONSE STATUS:", response.status);
      } catch (error) {
        console.error("LOGIN ERROR:", error);
        setErrorMessage("Unable to connect to RoadGuard server.");
        return;
      }

      if (response.status === 401) {
        setErrorMessage("Invalid email or password");
        return;
      }
      if (!response.ok) {
        setErrorMessage("Unable to log in right now. Please try again.");
        return;
      }

      console.log("PARSING LOGIN RESPONSE");
      const data = (await response.json()) as LoginResponse;
      console.log("LOGIN RESPONSE DATA:", data);
      if (!data.access_token || !data.user) {
        setErrorMessage("Unable to log in right now. Please try again.");
        return;
      }

      console.log("STORING TOKEN");
      await SecureStore.setItemAsync("roadguard_access_token", data.access_token);
      console.log("TOKEN STORED SUCCESSFULLY");
      console.log("STORING USER");
      await SecureStore.setItemAsync(
        "roadguard_user",
        JSON.stringify({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
        })
      );
      console.log("USER STORED SUCCESSFULLY");
      console.log("NAVIGATING TO HOME");
      router.replace("/");
    } catch (error) {
      console.error("LOGIN ERROR:", error);
      setErrorMessage("Something went wrong. Please try again.");
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
      <View style={styles.form}>
        <Text style={styles.brand}>RoadGuard</Text>
        <Text style={styles.heading}>Log in</Text>

        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="#71717A"
          style={styles.input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={() => void handleLogin()}
          placeholder="Password"
          placeholderTextColor="#71717A"
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isLoading }}
          disabled={isLoading}
          onPress={() => void handleLogin()}
          style={({ pressed }) => [
            styles.button,
            pressed && !isLoading && styles.buttonPressed,
            isLoading && styles.buttonDisabled,
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#F4F6F5",
  },
  form: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 14,
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
    marginBottom: 8,
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
  },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#176B52",
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});