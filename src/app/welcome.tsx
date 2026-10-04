import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthSession } from "@/hooks/use-auth-session";

export default function WelcomeScreen() {
  const { isLoading } = useAuthSession();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <ActivityIndicator accessibilityLabel="Checking sign-in" color="#176B52" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>RG</Text>
        </View>
        <Text style={styles.brand}>RoadGuard</Text>
        <Text style={styles.heading}>Welcome to RoadGuard</Text>
        <Text style={styles.description}>
          Identify potholes, capture their location, and keep your road reports together.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/login")}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>Log In</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/register")}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Create Account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#F4F6F5",
  },
  content: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "stretch",
    gap: 15,
  },
  brandMark: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#E4F0E9",
  },
  brandMarkText: {
    color: "#176B52",
    fontSize: 20,
    fontWeight: "800",
  },
  brand: {
    color: "#176B52",
    fontSize: 17,
    fontWeight: "700",
  },
  heading: {
    marginTop: 5,
    color: "#17221E",
    fontSize: 29,
    fontWeight: "700",
  },
  description: {
    marginBottom: 12,
    color: "#66736A",
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#176B52",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#B8C9BF",
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    color: "#176B52",
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.82,
  },
});
