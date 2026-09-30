import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  const [userName, setUserName] = useState("there");

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadUserName = async () => {
        try {
          const storedUser = await SecureStore.getItemAsync("roadguard_user");
          if (!storedUser) {
            if (isActive) setUserName("there");
            return;
          }

          const user = JSON.parse(storedUser) as { name?: string };
          if (isActive && user.name?.trim()) {
            setUserName(user.name.trim());
          }
        } catch {
          if (isActive) setUserName("there");
        }
      };

      void loadUserName();
      return () => {
        isActive = false;
      };
    }, [])
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.brandGroup}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>RG</Text>
              </View>
              <View>
                <Text style={styles.brandName}>RoadGuard</Text>
                <Text style={styles.brandCaption}>ROAD CONDITION MONITORING</Text>
              </View>
            </View>
            <View accessibilityLabel="Settings" accessible style={styles.settingsButton}>
              <SymbolView
                name={{ ios: "gearshape", android: "settings", web: "settings" }}
                size={21}
                tintColor="#6B7280"
              />
            </View>
          </View>

          <View style={styles.greeting}>
            <Text style={styles.greetingLabel}>Good morning,</Text>
            <Text style={styles.greetingName}>{userName}</Text>
          </View>

          <View style={styles.heroCard}>
            <Text style={styles.heroHeading}>
              Better roads begin with better visibility.
            </Text>
            <Text style={styles.heroDescription}>
              Scan a road to identify potholes and capture their location.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/camera")}
              style={({ pressed }) => [styles.scanButton, pressed && styles.scanButtonPressed]}
            >
              <Text style={styles.scanButtonText}>Scan Road</Text>
              <SymbolView
                name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
                size={20}
                tintColor="#FFFFFF"
              />
            </Pressable>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Road monitoring</Text>
            <Text style={styles.sectionCaption}>TOOLS</Text>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <View style={[styles.infoIcon, styles.aiIcon]}>
                <SymbolView
                  name={{ ios: "viewfinder", android: "image_search", web: "image_search" }}
                  size={21}
                  tintColor="#1B5E3B"
                />
              </View>
              <Text style={styles.infoTitle}>Pothole detection</Text>
              <Text style={styles.infoDescription}>
                Identify road-surface issues from an image.
              </Text>
            </View>

            <View style={styles.infoCard}>
              <View style={[styles.infoIcon, styles.locationIcon]}>
                <SymbolView
                  name={{ ios: "location.fill", android: "location_on", web: "location_on" }}
                  size={21}
                  tintColor="#8A6223"
                />
              </View>
              <Text style={styles.infoTitle}>Location capture</Text>
              <Text style={styles.infoDescription}>
                Keep every report connected to where it happened.
              </Text>
            </View>
          </View>

          <View style={styles.reportCard}>
            <View style={[styles.infoIcon, styles.reportIcon]}>
              <SymbolView
                name={{ ios: "doc.text", android: "description", web: "description" }}
                size={21}
                tintColor="#53616B"
              />
            </View>
            <View style={styles.reportCopy}>
              <Text style={styles.infoTitle}>Your reports</Text>
              <Text style={styles.infoDescription}>
                Track the road issues you have reported.
              </Text>
            </View>
          </View>

          <View style={styles.footerNote}>
            <View style={styles.statusDot} />
            <Text style={styles.footerText}>Ready when you are</Text>
          </View>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 30,
  },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  brandMark: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },
  brandMarkText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  brandName: {
    color: "#1A1A1A",
    fontSize: 17,
    fontWeight: "700",
  },
  brandCaption: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 9,
    fontWeight: "700",
  },
  settingsButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
  },
  greeting: {
    marginTop: 27,
    marginBottom: 19,
  },
  greetingLabel: {
    color: "#6B7280",
    fontSize: 16,
    lineHeight: 22,
  },
  greetingName: {
    marginTop: 2,
    color: "#1A1A1A",
    fontSize: 25,
    fontWeight: "700",
    lineHeight: 32,
  },
  heroCard: {
    padding: 20,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  heroHeading: {
    color: "#1A1A1A",
    fontSize: 23,
    fontWeight: "700",
    lineHeight: 29,
  },
  heroDescription: {
    marginTop: 9,
    color: "#6B7280",
    fontSize: 14,
    lineHeight: 21,
  },
  scanButton: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 19,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },
  scanButtonPressed: {
    opacity: 0.88,
  },
  scanButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 27,
    marginBottom: 13,
  },
  sectionTitle: {
    color: "#1A1A1A",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionCaption: {
    color: "#9CA3AF",
    fontSize: 10,
    fontWeight: "700",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 11,
  },
  infoCard: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  infoIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  aiIcon: {
    backgroundColor: "#E8F1EB",
  },
  locationIcon: {
    backgroundColor: "#F5EFE3",
  },
  reportIcon: {
    backgroundColor: "#EDF0F2",
  },
  infoTitle: {
    marginTop: 13,
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "700",
  },
  infoDescription: {
    marginTop: 6,
    color: "#6B7280",
    fontSize: 12,
    lineHeight: 18,
  },
  reportCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginTop: 11,
    padding: 15,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  reportCopy: {
    flex: 1,
  },
  footerNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#1B5E3B",
  },
  footerText: {
    color: "#6B7280",
    fontSize: 13,
  },
});