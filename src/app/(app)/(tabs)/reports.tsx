import { router, useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { UserProfileAvatar } from "@/components/user-profile-avatar";
import { getReportStatusPresentation } from "@/lib/report-status";
import { formatApiDateTime } from "@/lib/date-time";
import {
  API_ENDPOINTS,
  authorizationHeader,
  readJsonResponse,
} from "@/lib/api";
import {
  getCachedReportImages,
  getCachedReports,
  getCachedReportsVersion,
  getReportDataVersion,
  setCachedReportImages,
  setCachedReports,
  type CachedReport as Report,
} from "@/lib/report-data-version";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthSession } from "@/hooks/use-auth-session";

export default function ReportsScreen() {
  const { clearSession } = useAuthSession();
  const [reports, setReports] = useState<Report[]>(() => getCachedReports() ?? []);
  const [reportImages, setReportImages] =
    useState<Record<number, string>>(() => getCachedReportImages());
  const [isLoading, setIsLoading] = useState(() => getCachedReports() === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async (
    refresh = false,
    version = getReportDataVersion(),
    showLoading = getCachedReports() === null,
    forceFetch = refresh
  ) => {
    if (refresh) {
      setIsRefreshing(true);
    } else if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      if (!token) {
        await clearSession();
        setReports([]);
        setError("missing-token");
        return;
      }

      let userReports = getCachedReports();
      if (
        forceFetch ||
        userReports === null ||
        getCachedReportsVersion() !== version
      ) {
        const response = await fetch(API_ENDPOINTS.reports, {
          headers: authorizationHeader(token),
        });
        if (response.status === 401 || response.status === 403) {
          await clearSession();
          return;
        }
        const data = await readJsonResponse<unknown>(response);
        if (!Array.isArray(data)) {
          throw new Error("Unexpected reports response");
        }

        userReports = data as Report[];
        setCachedReports(userReports, version);
      }
      if (!userReports) return;
      setReports(userReports);
      setReportImages(getCachedReportImages());
      setIsLoading(false);

      const imageEntries = await Promise.all(
        userReports.map(async (report) => {
          const cachedImage = getCachedReportImages()[report.id];
          if (cachedImage) return [report.id, cachedImage] as const;

          try {
            const imageResponse = await fetch(
              `${API_ENDPOINTS.reports}/${report.id}/image`,
              { headers: authorizationHeader(token) }
            );
            if (imageResponse.status === 401 || imageResponse.status === 403) {
              await clearSession();
              return null;
            }
            const contentType = imageResponse.headers.get("content-type") ?? "";
            if (
              !imageResponse.ok ||
              !contentType.toLowerCase().startsWith("image/")
            ) {
              return null;
            }

            const extension = contentType.toLowerCase().includes("png")
              ? ".png"
              : contentType.toLowerCase().includes("webp")
                ? ".webp"
                : contentType.toLowerCase().includes("gif")
                  ? ".gif"
                  : ".jpg";
            const imageFile = new File(
              Paths.cache,
              `roadguard-report-${report.id}-${Date.now()}${extension}`
            );
            imageFile.write(new Uint8Array(await imageResponse.arrayBuffer()));
            return [report.id, imageFile.uri] as const;
          } catch {
            return null;
          }
        })
      );
      setCachedReportImages(
        Object.fromEntries(
          imageEntries.filter(
            (entry): entry is readonly [number, string] => entry !== null
          )
        )
      );
      setReportImages(getCachedReportImages());
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Reports request failed";
      console.warn("REPORTS request failed:", message);
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [clearSession]);

  useFocusEffect(
    useCallback(() => {
      const version = getReportDataVersion();
      const cachedReports = getCachedReports();
      if (cachedReports) {
        setReports(cachedReports);
        setReportImages(getCachedReportImages());
        setIsLoading(false);
        setError(null);
      }
      if (
        cachedReports &&
        getCachedReportsVersion() === version &&
        cachedReports.every((report) => getCachedReportImages()[report.id])
      ) {
        return;
      }

      void loadReports(false, version, cachedReports === null);
    }, [loadReports])
  );

  const renderReport = (report: Report) => {
    const statusPresentation = getReportStatusPresentation(report.status);
    return (
      <Pressable
        key={report.id}
        accessibilityRole="button"
        accessibilityLabel={`Open report ${report.id}`}
        onPress={() =>
          router.push({
            pathname: "/(app)/report-details",
            params: { reportId: String(report.id) },
          })
        }
        style={({ pressed }) => [
          styles.reportCard,
          pressed && styles.reportCardPressed,
        ]}
      >
        {reportImages[report.id] ? (
          <Image
            accessibilityLabel={`Submitted image for report ${report.id}`}
            source={{ uri: reportImages[report.id] }}
            style={styles.reportImage}
          />
        ) : (
          <View style={styles.reportImageFallback}>
            <SymbolView
              name={{ ios: "road.lanes", android: "add_road", web: "add_road" }}
              size={30}
              tintColor="#1B5E3B"
            />
          </View>
        )}

        <View style={styles.reportBody}>
          <View style={styles.reportHeading}>
            <View style={styles.potholeIcon}>
              <SymbolView
                name={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
                size={17}
                tintColor="#1B5E3B"
              />
            </View>
            <View style={styles.reportTitleGroup}>
              <Text style={styles.reportTitle}>
                {report.pothole_count} pothole
                {report.pothole_count === 1 ? "" : "s"} detected
              </Text>
              <Text style={styles.reportDate}>
                {formatApiDateTime(report.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <SymbolView
              name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }}
              size={17}
              tintColor="#66736A"
            />
            <Text numberOfLines={2} style={styles.detailValue}>
              {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
            </Text>
          </View>

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
            {(report.admin_note?.trim() || report.status === "rejected") ? (
              <View style={styles.adminNote}>
                <Text style={styles.adminNoteTitle}>
                  {report.status === "rejected"
                    ? "Reason from RoadGuard"
                    : "Admin note"}
                </Text>
                <Text style={styles.adminNoteText}>
                  {report.admin_note?.trim() || "A reason was not provided."}
                </Text>
              </View>
            ) : null}

            <View style={styles.reportFooter}>
            <Text style={styles.viewDetailsText}>View Details</Text>
            <SymbolView
              name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
              size={17}
              tintColor="#1B5E3B"
            />
          </View>
        </View>
      </Pressable>
    );
  };

  const totalPotholes = reports.reduce(
    (total, report) => total + report.pothole_count,
    0
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() =>
              void loadReports(true, getReportDataVersion(), true)
            }
            tintColor="#1B5E3B"
            colors={["#1B5E3B"]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeader}>
          <View style={styles.screenHeaderTop}>
            <View style={styles.headerIcon}>
              <SymbolView
                name={{ ios: "doc.text.fill", android: "description", web: "description" }}
                size={22}
                tintColor="#1B5E3B"
              />
            </View>
            <UserProfileAvatar />
          </View>
          <Text style={styles.title}>My Reports</Text>
          <Text style={styles.subtitle}>
            Track the road issues you've reported.
          </Text>
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.summaryHeading}>Your Activity</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total reports</Text>
              {isLoading ? (
                <ActivityIndicator
                  accessibilityLabel="Loading report count"
                  color="#1B5E3B"
                  style={styles.summaryLoader}
                />
              ) : (
                <Text style={styles.summaryValue}>
                  {error ? "—" : reports.length}
                </Text>
              )}
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Potholes detected</Text>
              {isLoading ? (
                <ActivityIndicator
                  accessibilityLabel="Loading pothole count"
                  color="#1B5E3B"
                  style={styles.summaryLoader}
                />
              ) : (
                <Text style={styles.summaryValue}>
                  {error ? "—" : totalPotholes}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.listHeading}>
          <Text style={styles.listTitle}>Reported Issues</Text>
          {!isLoading && !error ? (
            <Text style={styles.reportCountLabel}>
              {reports.length} {reports.length === 1 ? "report" : "reports"}
            </Text>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color="#1B5E3B" size="large" />
            <Text style={styles.stateText}>Loading your reports...</Text>
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
        ) : error ? (
          <View style={styles.stateContainer}>
            <View style={styles.stateIcon}>
              <SymbolView
                name={{ ios: "wifi.exclamationmark", android: "cloud_off", web: "cloud_off" }}
                size={26}
                tintColor="#A14435"
              />
            </View>
            <Text style={styles.stateTitle}>Unable to load reports</Text>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void loadReports(false, getReportDataVersion(), true, true)
              }
              style={styles.actionButton}
            >
            <Text style={styles.actionButtonText}>Try Again</Text>
            </Pressable>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.stateContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.stateTitle}>No reports yet</Text>
            <Text style={styles.stateText}>
              Report a pothole and it will appear here.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/(tabs)/camera")}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>Scan a Road</Text>
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
    backgroundColor: "#F5F7F5",
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
  },
  screenHeader: {
    marginBottom: 22,
  },
  screenHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  headerIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#E8F2EB",
  },
  title: {
    color: "#1A2A20",
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 6,
    color: "#66736A",
    fontSize: 14,
    lineHeight: 20,
  },
  summarySection: {
    marginBottom: 27,
  },
  summaryHeading: {
    marginBottom: 12,
    color: "#26382D",
    fontSize: 17,
    fontWeight: "700",
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    minHeight: 104,
    justifyContent: "space-between",
    padding: 15,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 1,
  },
  summaryLabel: {
    color: "#66736A",
    fontSize: 13,
    lineHeight: 18,
  },
  summaryValue: {
    marginTop: 8,
    color: "#1B5E3B",
    fontSize: 29,
    fontWeight: "700",
  },
  summaryLoader: {
    alignSelf: "flex-start",
    marginTop: 9,
  },
  listHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  listTitle: {
    color: "#26382D",
    fontSize: 19,
    fontWeight: "700",
  },
  reportCountLabel: {
    color: "#66736A",
    fontSize: 13,
  },
  reportList: {
    gap: 14,
  },
  reportCard: {
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    elevation: 1,
  },
  reportCardPressed: {
    opacity: 0.9,
  },
  reportImage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#E8EFEB",
  },
  reportImageFallback: {
    width: "100%",
    aspectRatio: 16 / 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF2ED",
  },
  reportBody: {
    padding: 15,
  },
  reportHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  potholeIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#EAF2ED",
  },
  reportTitleGroup: {
    flex: 1,
  },
  reportTitle: {
    color: "#1A2A20",
    fontSize: 16,
    fontWeight: "700",
  },
  reportDate: {
    marginTop: 4,
    color: "#77827A",
    fontSize: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 15,
  },
  detailValue: {
    flex: 1,
    color: "#536158",
    fontSize: 13,
    lineHeight: 19,
  },
  statusBadge: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 14,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  adminNote: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#E1EAE3",
    borderRadius: 10,
    backgroundColor: "#F7FAF7",
  },
  adminNoteTitle: {
    color: "#1B5E3B",
    fontSize: 11,
    fontWeight: "700",
  },
  adminNoteText: {
    marginTop: 4,
    color: "#536158",
    fontSize: 12,
    lineHeight: 18,
  },
  reportFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E9EEEA",
  },
  viewDetailsText: {
    color: "#1B5E3B",
    fontSize: 14,
    fontWeight: "700",
  },
  stateContainer: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 34,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
  },
  stateIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: "#FAEEEC",
  },
  emptyIcon: {
    marginBottom: 10,
    fontSize: 32,
  },
  stateTitle: {
    color: "#1A2A20",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  stateText: {
    marginTop: 8,
    color: "#66736A",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  actionButton: {
    minHeight: 50,
    minWidth: 145,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});