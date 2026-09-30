import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProfileScreen() {
  const { user, isLoading, clearSession } = useAuthSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user]);

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await clearSession();
      router.replace("/login");
    } catch {
      setLogoutError("Unable to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (isLoading || !user) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        <View style={styles.loadingState}>
          <ActivityIndicator color="#1B5E3B" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <SymbolView
              name={{ ios: "person.fill", android: "person", web: "person" }}
              size={38}
              tintColor="#1B5E3B"
            />
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.accountSection}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Name</Text>
          <Text style={styles.fieldValue}>{user.name}</Text>

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{user.email}</Text>
        </View>

        <View style={styles.logoutSection}>
          {logoutError ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {logoutError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isLoggingOut }}
            disabled={isLoggingOut}
            onPress={() =>
              Alert.alert("Logout?", "Are you sure you want to logout?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Logout",
                  style: "destructive",
                  onPress: () => void logout(),
                },
              ])
            }
            style={({ pressed }) => [
              styles.logoutButton,
              pressed && !isLoggingOut && styles.pressed,
              isLoggingOut && styles.logoutButtonDisabled,
            ]}
          >
            {isLoggingOut ? (
              <ActivityIndicator color="#A14435" />
            ) : (
              <Text style={styles.logoutText}>Logout</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5F2",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  title: {
    color: "#1A1A1A",
    fontSize: 27,
    fontWeight: "700",
  },
  profileHeader: {
    alignItems: "center",
    paddingVertical: 28,
  },
  avatar: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 42,
    backgroundColor: "#E4EEE8",
  },
  name: {
    marginTop: 14,
    color: "#1A1A1A",
    fontSize: 21,
    fontWeight: "700",
  },
  email: {
    marginTop: 4,
    color: "#6B7280",
    fontSize: 14,
  },
  accountSection: {
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  sectionTitle: {
    color: "#1A1A1A",
    fontSize: 17,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    marginVertical: 15,
    backgroundColor: "#E8E9EB",
  },
  fieldLabel: {
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "600",
  },
  fieldValue: {
    marginTop: 5,
    color: "#1A1A1A",
    fontSize: 15,
  },
  logoutSection: {
    flex: 1,
    justifyContent: "flex-end",
    paddingTop: 28,
  },
  logoutButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#A14435",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  logoutButtonDisabled: {
    opacity: 0.65,
  },
  logoutText: {
    color: "#A14435",
    fontSize: 15,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
  errorText: {
    marginBottom: 10,
    color: "#A14435",
    fontSize: 13,
    textAlign: "center",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});