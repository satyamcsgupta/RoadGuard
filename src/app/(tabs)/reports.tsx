import { router, useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
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

type ReportsError = "missing-token" | "request-failed";

export default function ReportsScreen() {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ReportsError | null>(null);

  const loadReports = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      console.log(
        "REPORTS JWT exists:",
        Boolean(token),
        "length:",
        token?.length ?? 0
      );
      if (!token) {
        setReports([]);
        setError("missing-token");
        return;
      }

      const authorization = `Bearer ${token}`;
      console.log(
        "REPORTS Authorization header present:",
        Boolean(authorization)
      );
      const response = await fetch(REPORTS_URL, {
        headers: { Authorization: authorization },
      });
      if (!response.ok) {
        console.warn("REPORTS API status:", response.status);
        if (response.status === 401) {
          try {
            const errorBody: unknown = await response.json();
            if (
              typeof errorBody === "object" &&
              errorBody !== null &&
              "detail" in errorBody &&
              typeof errorBody.detail === "string"
            ) {
              console.warn("REPORTS API 401 detail:", errorBody.detail);
            }
          } catch {
            console.warn("REPORTS API 401 detail unavailable");
          }
        }
        throw new Error("Reports request failed");
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Unexpected reports response");
      }
      setReports(data as Report[]);
    } catch {
      setError("request-failed");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadReports();
    }, [loadReports])
  );

  const renderReport = (report: Report) => {
    const createdAt = new Date(report.created_at);
    const formattedDate = Number.isNaN(createdAt.getTime())
      ? "Date unavailable"
      : createdAt.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });

    return (
      <Pressable
        key={report.id}
        accessibilityRole="button"
        accessibilityLabel={`Open report ${report.id}`}
        onPress={() =>
          router.push({
            pathname: "/report-details",
            params: { reportId: String(report.id) },
          })
        }
        style={({ pressed }) => [styles.reportCard, pressed && styles.reportCardPressed]}
      >
        <View style={styles.reportHeading}>
          <View style={styles.reportMarker} />
          <Text style={styles.reportTitle}>
            {report.pothole_count > 0
              ? "Pothole detected"
              : "No potholes detected"}
          </Text>
        </View>

        <Text style={styles.potholeCount}>
          {report.pothole_count} pothole
          {report.pothole_count === 1 ? "" : "s"}
        </Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Location</Text>
          <Text style={styles.detailValue}>
            {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
          </Text>
        </View>
        <View style={styles.reportFooter}>
          <Text style={styles.reportDate}>{formattedDate}</Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{report.status}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadReports(true)}
            tintColor="#1B5E3B"
            colors={["#1B5E3B"]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeader}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.subtitle}>Road scans saved to your account</Text>
        </View>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color="#1B5E3B" size="small" />
            <Text style={styles.stateText}>Loading reports...</Text>
          </View>
        ) : error === "missing-token" ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateTitle}>Sign in to view your reports</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/login")}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>Go to Login</Text>
            </Pressable>
          </View>
        ) : error === "request-failed" ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateTitle}>Unable to load reports.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadReports()}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateTitle}>No reports yet.</Text>
            <Text style={styles.stateText}>
              Scan a road to create your first report.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/camera")}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>Start a Scan</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.reportList}>{reports.map(renderReport)}</View>
        )}
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
    paddingBottom: 34,
  },
  screenHeader: {
    marginBottom: 23,
  },
  title: {
    color: "#1A1A1A",
    fontSize: 27,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 5,
    color: "#6B7280",
    fontSize: 14,
  },
  reportList: {
    gap: 12,
  },
  reportCard: {
    padding: 17,
    borderWidth: 1,
    borderColor: "#E8E9EB",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  reportCardPressed: {
    opacity: 0.82,
  },
  reportHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  reportMarker: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#1B5E3B",
  },
  reportTitle: {
    flex: 1,
    color: "#1A1A1A",
    fontSize: 16,
    fontWeight: "700",
  },
  potholeCount: {
    marginTop: 11,
    color: "#303833",
    fontSize: 15,
    fontWeight: "600",
  },
  detailRow: {
    marginTop: 15,
  },
  detailLabel: {
    marginBottom: 4,
    color: "#9CA3AF",
    fontSize: 12,
  },
  detailValue: {
    color: "#4B5563",
    fontSize: 14,
  },
  reportFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 17,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E8E9EB",
  },
  reportDate: {
    flex: 1,
    color: "#6B7280",
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "#F5EFE3",
  },
  statusText: {
    color: "#765A2D",
    fontSize: 12,
    fontWeight: "600",
  },
  stateContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 54,
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
    textAlign: "center",
  },
  actionButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 19,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: "#1B5E3B",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});