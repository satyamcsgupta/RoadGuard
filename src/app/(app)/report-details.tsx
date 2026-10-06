import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import {
  API_ENDPOINTS,
  authorizationHeader,
  readJsonResponse,
} from "@/lib/api";
import { getReportStatusPresentation } from "@/lib/report-status";
import { formatApiDateTime } from "@/lib/date-time";
import { invalidateReportData } from "@/lib/report-data-version";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Report = {
  id: number;
  image_filename: string;
  latitude: number;
  longitude: number;
  pothole_count: number;
  description?: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

type LoadError = "missing-token" | "request-failed" | "not-found";

export default function ReportDetailsScreen() {
  const { clearSession } = useAuthSession();
  const { reportId } = useLocalSearchParams<{ reportId?: string | string[] }>();
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(true);
  const [mapError, setMapError] = useState(false);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setLoadErrorMessage(null);
    setImageUri(null);
    setImageUnavailable(true);

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
        await clearSession();
        setReport(null);
        setLoadError("missing-token");
        return;
      }

      const response = await fetch(API_ENDPOINTS.reports, {
        headers: authorizationHeader(token),
      });
      if (response.status === 401 || response.status === 403) {
        await clearSession();
        setReport(null);
        setLoadError("missing-token");
        return;
      }

      const reports = await readJsonResponse<unknown>(response);
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
      try {
        const imageResponse = await fetch(
          `${API_ENDPOINTS.reports}/${selectedReport.id}/image`,
          { headers: authorizationHeader(token) }
        );
        if (imageResponse.status === 401 || imageResponse.status === 403) {
          await clearSession();
          return;
        }
        if (!imageResponse.ok) {
          throw new Error(`Image request failed with HTTP ${imageResponse.status}`);
        }

        const contentType = imageResponse.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          throw new Error("Image endpoint returned a non-image response");
        }

        const extension =
          contentType.toLowerCase().includes("png")
            ? ".png"
            : contentType.toLowerCase().includes("webp")
              ? ".webp"
              : contentType.toLowerCase().includes("gif")
                ? ".gif"
                : ".jpg";
        const cachedImage = new File(
          Paths.cache,
          `roadguard-report-${selectedReport.id}-${Date.now()}${extension}`
        );
        cachedImage.write(new Uint8Array(await imageResponse.arrayBuffer()));
        setImageUri(cachedImage.uri);
        setImageUnavailable(false);
      } catch {
        setImageUri(null);
        setImageUnavailable(true);
      }
    } catch (requestError) {
      setReport(null);
      setLoadError("request-failed");
      setLoadErrorMessage(
        requestError instanceof Error ? requestError.message : "Report details request failed"
      );
    } finally {
      setIsLoading(false);
    }
  }, [clearSession, reportId]);

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
        await clearSession();
        setDeleteError("Your session has expired. Sign in to delete this report.");
        return;
      }

      const response = await fetch(`${API_ENDPOINTS.reports}/${report.id}`, {
        method: "DELETE",
        headers: authorizationHeader(token),
      });

      if (response.status === 401) {
        await clearSession();
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
      await readJsonResponse<unknown>(response);

      invalidateReportData();
      router.replace("/(app)/(tabs)/reports");
    } catch (requestError) {
      setDeleteError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to delete this report. Check your connection and try again."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const dateLabel = report
    ? formatApiDateTime(report.created_at)
    : "Date unavailable";
  const statusPresentation = getReportStatusPresentation(report?.status);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(app)/(tabs)/reports");
              }
            }}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.backButtonText}>←</Text>
          </Pressable>
          <Text style={styles.screenTitle}>Report Details</Text>
        </View>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color="#1B5E3B" />
            <Text style={styles.stateText}>Loading report details...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateTitle}>
              {loadError === "missing-token"
                ? "Sign in to view this report."
                : loadError === "not-found"
                  ? "Report not found."
                  : `Unable to load report details. ${loadErrorMessage ?? ""}`}
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
            {imageUnavailable || !imageUri ? (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderTitle}>Image unavailable</Text>
                <Text style={styles.imagePlaceholderText}>
                  This report does not have an available image.
                </Text>
              </View>
            ) : (
              <Image
                accessibilityLabel="Submitted pothole report"
                onError={() => {
                  setImageUri(null);
                  setImageUnavailable(true);
                }}
                resizeMode="contain"
                source={{ uri: imageUri }}
                style={styles.reportImage}
              />
            )}

            <View style={styles.summaryCard}>
              <Text style={styles.reportTitle}>
                🚧 {report.pothole_count}{" "}
                {report.pothole_count === 1 ? "Pothole" : "Potholes"} Detected
              </Text>
              <Text style={styles.summaryCaption}>
                Road issue identified in this submitted image
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Location</Text>
              <View style={styles.coordinateRow}>
                <Text style={styles.coordinateLabel}>Latitude</Text>
                <Text selectable style={styles.coordinate}>
                  {report.latitude.toFixed(6)}
                </Text>
              </View>
              <View style={styles.coordinateRow}>
                <Text style={styles.coordinateLabel}>Longitude</Text>
                <Text selectable style={styles.coordinate}>
                  {report.longitude.toFixed(6)}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Description</Text>
              <Text style={styles.descriptionText}>
                {report.description?.trim() || "No description provided."}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Status</Text>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: statusPresentation.backgroundColor,
                    borderColor: statusPresentation.borderColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: statusPresentation.textColor },
                  ]}
                >
                  {statusPresentation.label}
                </Text>
              </View>
              {statusPresentation.description ? (
                <Text style={styles.statusDescription}>
                  {statusPresentation.description}
                </Text>
              ) : null}
            </View>

            {(report.admin_note?.trim() || report.status === "rejected") ? (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>
                  {report.status === "rejected"
                    ? "Reason from RoadGuard"
                    : "Admin note"}
                </Text>
                <Text style={styles.descriptionText}>
                  {report.admin_note?.trim() || "A reason was not provided."}
                </Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <View style={styles.metaRow}>
                <View style={styles.metaBlock}>
                  <Text style={styles.sectionLabel}>Reported</Text>
                  <Text style={styles.dateText}>{dateLabel}</Text>
                </View>
              </View>
              <Text style={styles.reportId}>Report ID: {report.id}</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => void openMap()}
              style={({ pressed }) => [
                styles.mapButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.mapButtonText}>View on Map</Text>
              <Text style={styles.mapButtonArrow}>↗</Text>
            </Pressable>
            {mapError ? (
              <Text style={styles.mapError}>Unable to open the map app.</Text>
            ) : null}

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
    backgroundColor: "#F5F7F5",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 38,
  },
  header: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 17,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
  },
  backButtonText: {
    color: "#1B5E3B",
    fontSize: 22,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
  screenTitle: {
    flex: 1,
    color: "#1A2A20",
    fontSize: 23,
    fontWeight: "700",
  },
  details: {
    gap: 13,
  },
  imagePlaceholder: {
    width: "100%",
    aspectRatio: 4 / 3,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 18,
    backgroundColor: "#EAF2ED",
  },
  reportImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 18,
    backgroundColor: "#EAF2ED",
  },
  imagePlaceholderTitle: {
    color: "#46534B",
    fontSize: 16,
    fontWeight: "700",
  },
  imagePlaceholderText: {
    marginTop: 6,
    color: "#66736A",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  summaryCard: {
    padding: 17,
    borderWidth: 1,
    borderColor: "#DCE9DF",
    borderRadius: 17,
    backgroundColor: "#EAF4ED",
  },
  summaryCaption: {
    marginTop: 6,
    color: "#607267",
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    padding: 17,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    elevation: 1,
  },
  reportTitle: {
    color: "#1B5E3B",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 27,
  },
  sectionLabel: {
    marginBottom: 11,
    color: "#26382D",
    fontSize: 16,
    fontWeight: "700",
  },
  coordinateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "#EEF1EF",
  },
  coordinateLabel: {
    color: "#77827A",
    fontSize: 13,
  },
  coordinate: {
    color: "#3F4C43",
    fontSize: 14,
    fontWeight: "600",
  },
  descriptionText: {
    color: "#46534B",
    fontSize: 15,
    lineHeight: 23,
  },
  mapButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 1,
    borderRadius: 13,
    backgroundColor: "#1B5E3B",
    elevation: 2,
  },
  mapButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  mapButtonArrow: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  mapError: {
    marginTop: -5,
    color: "#A14435",
    fontSize: 13,
    textAlign: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  metaBlock: {
    flex: 1,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 15,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
  },
  statusDescription: {
    marginTop: 10,
    color: "#66736A",
    fontSize: 14,
    lineHeight: 20,
  },
  dateText: {
    color: "#46534B",
    fontSize: 14,
    lineHeight: 20,
  },
  reportId: {
    marginTop: 14,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#EEF1EF",
    color: "#89938C",
    fontSize: 12,
  },
  deleteButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5C9C5",
    borderRadius: 13,
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
    fontSize: 14,
    fontWeight: "600",
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
    paddingHorizontal: 18,
    paddingVertical: 56,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
  },
  stateTitle: {
    color: "#1A2A20",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  stateText: {
    marginTop: 10,
    color: "#66736A",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
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