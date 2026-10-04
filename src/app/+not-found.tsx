import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuthSession } from "@/hooks/use-auth-session";

export default function NotFoundScreen() {
  const { user, isLoading } = useAuthSession();

  useEffect(() => {
    if (!isLoading) {
      router.replace(user ? "/(app)/(tabs)" : "/welcome");
    }
  }, [isLoading, user]);

  return (
    <View style={styles.container}>
      <ActivityIndicator accessibilityLabel="Returning to RoadGuard" color="#176B52" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F6F5",
  },
});
