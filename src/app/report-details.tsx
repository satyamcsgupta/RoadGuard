import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const REPORTS_URL = "http://10.41.228.118:8000/reports";

type Report = {
  id: number;
  image_filename: string;
  latitude: number;
  longitude: number;
  pothole_count: number;
  status: string;
  created_at: string;
};

type LoadError = "missing-token" | "request-failed" | "not-found";

export default function ReportDetailsScreen() {
  const { reportId } = useLocalSearchParams<{ reportId?: string | string[] }>();
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [mapError, setMapError] = useState(false);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    const requestedId = Array.isArray(reportId) ? reportId[0] : reportId;
    if (!requestedId || !/^\d+$/.test(requestedId)) {
      setReport(null);
      setLoadError("not-found");
      setIsLoading(false);
      return;
    }

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      if (!token) {
        setReport(null);
        setLoadError("missing-token");
        return;
      }

      const response = await fetch(REPORTS_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error("Report details request failed");
      }

      const reports: unknown = await response.json();
      if (!Array.isArray(reports)) {
        throw new Error("Unexpected reports response");
      }

      const selectedReport = (reports as Report[]).find(
        (item) => String(item.id) === requestedId
      );
      if (!selectedReport) {
        setReport(null);
        setLoadError("not-found");
        return;
      }
      setReport(selectedReport);
    } catch {
      setReport(null);
      setLoadError("request-failed");
    } finally {
      setIsLoading(false);
    }
  }, [reportId]);

  useFocusEffect(
    useCallback(() => {
      void loadReport();
    }, [loadReport])
  );

  const openMap = async () => {
    if (!report) return;
    setMapError(false);
    const coordinates = `${report.latitude},${report.longitude}`;
    const mapUrl =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${coordinates}`
        : `geo:${coordinates}?q=${coordinates}`;

    try {
      await Linking.openURL(mapUrl);
    } catch {
      setMapError(true);
    }
  };

  const deleteReport = async () => {
    if (!report || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      if (!token) {
        setDeleteError("Your session has expired. Sign in to delete this report.");
        return;
      }

      const response = await fetch(`${REPORTS_URL}/${report.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        setDeleteError("Your session has expired. Sign in to delete this report.");
        return;
      }
      if (response.status === 403) {
        setDeleteError("You are not authorized to delete this report.");
        return;
      }
      if (response.status === 404) {
        setDeleteError("This report could not be found. It may already be deleted.");
        return;
      }
      if (!response.ok) {
        setDeleteError("Unable to delete this report. Please try again.");
        return;
      }

      router.replace("/(tabs)/reports");
    } catch {
      setDeleteError("Unable to delete this report. Check your connection and try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const formattedDate = report ? new Date(report.created_at) : null;
  const dateLabel = formattedDate && !Number.isNaN(formattedDate.getTime())
    ? formattedDate.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Date unavailable";

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(tabs)/reports");
            }
          }}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <Text style={styles.screenTitle}>Report details</Text>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color="#1B5E3B" />
            <Text style={styles.stateText}>Loading report...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateTitle}>
              {loadError === "missing-token"
                ? "Sign in to view this report."
                : loadError === "not-found"
                  ? "Report not found."
                  : "Unable to load report details."}
            </Text>
            {loadError === "missing-token" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/login")}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Go to Login</Text>
              </Pressable>
            ) : loadError === "request-failed" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadReport()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : report ? (
          <View style={styles.details}>
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderTitle}>Image unavailable</Text>
              <Text style={styles.imagePlaceholderText}>
                This report stores an image filename, not a hosted image.
              </Text>
            </View>

            <View style={styles.card}>
              <View style={styles.titleRow}>
                <View style={styles.marker} />
                <Text style={styles.reportTitle}>
                  {report.pothole_count === 1
                    ? "Pothole detected"
                    : "Potholes detected"}
                </Text>
              </View>
              <Text style={styles.potholeCount}>
                {report.pothole_count} pothole
                {report.pothole_count === 1 ? "" : "s"}
              </Text>

              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>Location</Text>
              <Text style={styles.coordinate}>
                Latitude: {report.latitude.toFixed(6)}
              </Text>
              <Text style={styles.coordinate}>
                Longitude: {report.longitude.toFixed(6)}
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() => void openMap()}
                style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
              >
                <Text style={styles.mapButtonText}>View on Map</Text>
              </Pressable>
              {mapError ? (
                <Text style={styles.mapError}>Unable to open the map app.</Text>
              ) : null}

              <View style={styles.divider} />
              <View style={styles.metaRow}>
                <View style={styles.metaBlock}>
                  <Text style={styles.sectionLabel}>Status</Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusText}>{report.status}</Text>
                  </View>
                </View>
                <View style={styles.metaBlock}>
                  <Text style={styles.sectionLabel}>Reported</Text>
                  <Text style={styles.dateText}>{dateLabel}</Text>
                </View>
              </View>
              <Text style={styles.reportId}>Report ID: {report.id}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isDeleting }}
              disabled={isDeleting}
              onPress={() =>
                Alert.alert(
                  "Delete Report?",
                  "Are you sure you want to delete this report?\nThis action cannot be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => void deleteReport(),
                    },
                  ]
                )
              }
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && !isDeleting && styles.pressed,
                isDeleting && styles.deleteButtonDisabled,
              ]}
            >
              <View style={styles.deleteButtonContent}>
                {isDeleting ? <ActivityIndicator color="#A14435" /> : null}
                <Text style={styles.deleteButtonText}>
                  {isDeleting ? "Deleting..." : "Delete Report"}
                </Text>
              </View>
            </Pressable>
            {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
          </View>
        ) : null}
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
    paddingTop: 12,
    paddingBottom: 32,
  },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  backButtonText: {
    color: "#1B5E3B",
    fontSize: 15,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
  screenTitle: {
    marginTop: 18,
    marginBottom: 18,
    color: "#1A1A1A",
    fontSize: 25,
    fontWeight: "700",
  },
  details: {
    gap: 14,
  },
  imagePlaceholder: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 15,
    backgroundColor: "#ECEDEA",
  },
  imagePlaceholderTitle: {
    color: "#4B5563",
    fontSize: 16,
    fontWeight: "700",
  },
  imagePlaceholderText: {
    marginTop: 6,
    color: "#6B7280",
    fontSize: 13,
    textAlign: "center",
  },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  marker: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#1B5E3B",
  },
  reportTitle: {
    flex: 1,
    color: "#1A1A1A",
    fontSize: 18,
    fontWeight: "700",
  },
  potholeCount: {
    marginTop: 9,
    color: "#37423B",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    marginVertical: 17,
    backgroundColor: "#E8E9EB",
  },
  sectionLabel: {
    marginBottom: 7,
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "600",
  },
  coordinate: {
    marginTop: 5,
    color: "#1A1A1A",
    fontSize: 15,
  },
  mapButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 15,
    borderRadius: 10,
    backgroundColor: "#1B5E3B",
  },
  mapButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  mapError: {
    marginTop: 8,
    color: "#A14435",
    fontSize: 13,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },
  metaBlock: {
    flex: 1,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#F5EFE3",
  },
  statusText: {
    color: "#765A2D",
    fontSize: 13,
    fontWeight: "600",
  },
  dateText: {
    color: "#1A1A1A",
    fontSize: 14,
    lineHeight: 20,
  },
  reportId: {
    marginTop: 18,
    color: "#9CA3AF",
    fontSize: 12,
  },
  deleteButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#A14435",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  deleteButtonDisabled: {
    opacity: 0.65,
  },
  deleteButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deleteButtonText: {
    color: "#A14435",
    fontSize: 15,
    fontWeight: "700",
  },
  deleteError: {
    color: "#A14435",
    fontSize: 13,
    textAlign: "center",
  },
  stateContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
  },
  stateTitle: {
    color: "#1A1A1A",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  stateText: {
    marginTop: 10,
    color: "#6B7280",
    fontSize: 14,
  },
  primaryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#1B5E3B",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});