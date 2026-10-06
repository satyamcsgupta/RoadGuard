import { router, useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { UserProfileAvatar } from "@/components/user-profile-avatar";
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
import { useAuthSession } from "@/hooks/use-auth-session";
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

type ReportsState = "loading" | "loaded" | "error";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const { user, clearSession } = useAuthSession();
  const [reports, setReports] = useState<Report[]>(() => getCachedReports() ?? []);
  const [reportImages, setReportImages] =
    useState<Record<number, string>>(() => getCachedReportImages());
  const [reportsState, setReportsState] = useState<ReportsState>(
    () => (getCachedReports() ? "loaded" : "loading")
  );
  const [reportsError, setReportsError] = useState<string | null>(null);

  const loadReports = useCallback(async (
    isActive: () => boolean = () => true,
    version = getReportDataVersion(),
    showLoading = getCachedReports() === null,
    forceFetch = false
  ) => {
    if (showLoading) setReportsState("loading");
    setReportsError(null);

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      if (!token) {
        if (isActive()) {
          await clearSession();
          setReports([]);
          setReportImages({});
          setReportsState("loaded");
        }
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
      if (!isActive()) return;
      setReports(userReports);
      setReportImages(getCachedReportImages());
      setReportsState("loaded");

      const recentReports = userReports.slice(0, 3);
      const cachedImages = await Promise.all(
        recentReports.map(async (report) => {
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
            if (!imageResponse.ok) return null;
            const contentType = imageResponse.headers.get("content-type") ?? "";
            if (!contentType.toLowerCase().startsWith("image/")) return null;

            const extension = contentType.toLowerCase().includes("png")
              ? ".png"
              : contentType.toLowerCase().includes("webp")
                ? ".webp"
                : contentType.toLowerCase().includes("gif")
                  ? ".gif"
                  : ".jpg";
            const imageFile = new File(
              Paths.cache,
              `roadguard-home-report-${report.id}-${Date.now()}${extension}`
            );
            imageFile.write(new Uint8Array(await imageResponse.arrayBuffer()));
            return [report.id, imageFile.uri] as const;
          } catch {
            return null;
          }
        })
      );

      if (isActive()) {
        const images = Object.fromEntries(
          cachedImages.filter(
            (entry): entry is readonly [number, string] => entry !== null
          )
        );
        setCachedReportImages(images);
        setReportImages(getCachedReportImages());
      }
    } catch (error) {
      if (!isActive()) return;
      setReportsState("error");
      setReportsError(
        error instanceof Error ? error.message : "Unable to load your reports."
      );
    }
  }, [clearSession]);

  useFocusEffect(
    useCallback(() => {
      const version = getReportDataVersion();
      const cachedReports = getCachedReports();
      if (cachedReports) {
        setReports(cachedReports);
        setReportImages(getCachedReportImages());
        setReportsState("loaded");
        setReportsError(null);
      }
      if (
        cachedReports &&
        getCachedReportsVersion() === version &&
        cachedReports.slice(0, 3).every((report) => getCachedReportImages()[report.id])
      ) {
        return;
      }

      let isActive = true;
      void loadReports(() => isActive, version, cachedReports === null);
      return () => {
        isActive = false;
      };
    }, [loadReports])
  );

  const totalPotholes = reports.reduce(
    (total, report) => total + report.pothole_count,
    0
  );
  const greetingName = user?.name.trim() || "there";

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={reportsState === "loading"}
            onRefresh={() =>
              void loadReports(() => true, getReportDataVersion(), true, true)
            }
            tintColor="#1B5E3B"
            colors={["#1B5E3B"]}
          />
        }
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
            <UserProfileAvatar />
          </View>

          <View style={styles.greeting}>
            <Text style={styles.greetingLabel}>{getGreeting()},</Text>
            <Text style={styles.greetingName}>{greetingName}</Text>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <SymbolView
                name={{ ios: "viewfinder", android: "image_search", web: "image_search" }}
                size={23}
                tintColor="#1B5E3B"
              />
            </View>
            <Text style={styles.heroHeading}>Make your next scan count.</Text>
            <Text style={styles.heroDescription}>
              Identify potholes, capture their location, and keep your road reports together.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/(tabs)/camera")}
              style={({ pressed }) => [
                styles.scanButton,
                pressed && styles.scanButtonPressed,
              ]}
            >
              <Text style={styles.scanButtonText}>Start Scan</Text>
              <SymbolView
                name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
                size={20}
                tintColor="#FFFFFF"
              />
            </Pressable>
          </View>

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Your Activity</Text>
              <Text style={styles.sectionSubtitle}>Your reports at a glance</Text>
            </View>
            <SymbolView
              name={{ ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" }}
              size={21}
              tintColor="#1B5E3B"
            />
          </View>

          <View style={styles.activityRow}>
            <View style={styles.activityCard}>
              <Text style={styles.activityLabel}>Reports submitted</Text>
              {reportsState === "loading" ? (
                <ActivityIndicator
                  accessibilityLabel="Loading report count"
                  color="#1B5E3B"
                  style={styles.activityLoader}
                />
              ) : (
                <Text style={styles.activityValue}>
                  {reportsState === "error" ? "—" : reports.length}
                </Text>
              )}
            </View>
            <View style={styles.activityCard}>
              <Text style={styles.activityLabel}>Potholes detected</Text>
              {reportsState === "loading" ? (
                <ActivityIndicator
                  accessibilityLabel="Loading pothole count"
                  color="#1B5E3B"
                  style={styles.activityLoader}
                />
              ) : (
                <Text style={styles.activityValue}>
                  {reportsState === "error" ? "—" : totalPotholes}
                </Text>
              )}
            </View>
          </View>

          {reportsState === "error" ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>
                Activity could not be loaded. {reportsError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void loadReports(() => true, getReportDataVersion(), true, true)
                }
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.recentHeader}>
            <View>
              <Text style={styles.sectionTitle}>Recent Reports</Text>
              <Text style={styles.sectionSubtitle}>Your latest road scans</Text>
            </View>
            {reports.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/(app)/(tabs)/reports")}
                hitSlop={8}
              >
                <Text style={styles.seeAllText}>See all</Text>
              </Pressable>
            ) : null}
          </View>

          {reportsState === "loading" ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color="#1B5E3B" />
              <Text style={styles.stateText}>Loading recent reports...</Text>
            </View>
          ) : reportsState === "loaded" && reports.length === 0 ? (
            <View style={styles.stateCard}>
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.stateText}>
                Your submitted road reports will appear here.
              </Text>
            </View>
          ) : reportsState === "loaded" ? (
            <View style={styles.recentList}>
              {reports.slice(0, 3).map((report) => (
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
                    styles.recentCard,
                    pressed && styles.recentCardPressed,
                  ]}
                >
                  {reportImages[report.id] ? (
                    <Image
                      accessibilityLabel="Report image"
                      source={{ uri: reportImages[report.id] }}
                      style={styles.recentImage}
                    />
                  ) : (
                    <View style={styles.recentImageFallback}>
                      <SymbolView
                        name={{ ios: "road.lanes", android: "add_road", web: "add_road" }}
                        size={22}
                        tintColor="#1B5E3B"
                      />
                    </View>
                  )}
                  <View style={styles.recentCopy}>
                    <Text style={styles.recentTitle}>
                      {report.pothole_count} pothole
                      {report.pothole_count === 1 ? "" : "s"} detected
                    </Text>
                    <Text numberOfLines={1} style={styles.recentLocation}>
                      {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                    </Text>
                    <Text style={styles.recentDate}>
                      {formatApiDateTime(report.created_at)}
                    </Text>
                    {(report.admin_note?.trim() || report.status === "rejected") ? (
                      <Text style={styles.recentAdminNote}>
                        {report.status === "rejected"
                          ? "Reason from RoadGuard: "
                          : "Admin note: "}
                        {report.admin_note?.trim() || "A reason was not provided."}
                      </Text>
                    ) : null}
                  </View>
                  <SymbolView
                    name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                    size={18}
                    tintColor="#9CA3AF"
                  />
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.footerNote}>
            <View style={styles.statusDot} />
            <Text style={styles.footerText}>Together, we make roads safer.</Text>
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
  },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingBottom: 12,
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
    letterSpacing: 0.5,
  },
  greeting: {
    marginTop: 23,
    marginBottom: 17,
  },
  greetingLabel: {
    color: "#6B7280",
    fontSize: 15,
    lineHeight: 21,
  },
  greetingName: {
    marginTop: 1,
    color: "#1A1A1A",
    fontSize: 25,
    fontWeight: "700",
    lineHeight: 32,
  },
  heroCard: {
    padding: 19,
    borderWidth: 1,
    borderColor: "#E4E8E4",
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    shadowColor: "#26382D",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  heroIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#E8F1EB",
  },
  heroHeading: {
    marginTop: 14,
    color: "#1A1A1A",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  heroDescription: {
    marginTop: 7,
    color: "#6B7280",
    fontSize: 14,
    lineHeight: 20,
  },
  scanButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 17,
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
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 25,
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#1A1A1A",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionSubtitle: {
    marginTop: 3,
    color: "#7A817D",
    fontSize: 12,
  },
  activityRow: {
    flexDirection: "row",
    gap: 12,
  },
  activityCard: {
    flex: 1,
    minHeight: 101,
    justifyContent: "space-between",
    padding: 15,
    borderWidth: 1,
    borderColor: "#E4E8E4",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  activityLabel: {
    color: "#6B7280",
    fontSize: 12,
    lineHeight: 17,
  },
  activityValue: {
    color: "#1B5E3B",
    fontSize: 27,
    fontWeight: "700",
  },
  activityLoader: {
    alignSelf: "flex-start",
    marginVertical: 3,
  },
  errorCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
  },
  errorText: {
    color: "#7C4531",
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  retryText: {
    color: "#1B5E3B",
    fontSize: 13,
    fontWeight: "700",
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 25,
    marginBottom: 12,
  },
  seeAllText: {
    color: "#1B5E3B",
    fontSize: 13,
    fontWeight: "700",
  },
  stateCard: {
    minHeight: 90,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4E8E4",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  emptyTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "700",
  },
  stateText: {
    color: "#6B7280",
    fontSize: 12,
    textAlign: "center",
  },
  recentList: {
    gap: 10,
  },
  recentCard: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: "#E4E8E4",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  recentCardPressed: {
    opacity: 0.82,
  },
  recentImage: {
    width: 66,
    height: 66,
    borderRadius: 10,
    backgroundColor: "#E8ECE9",
  },
  recentImageFallback: {
    width: 66,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#E8F1EB",
  },
  recentCopy: {
    flex: 1,
    minWidth: 0,
  },
  recentTitle: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "700",
  },
  recentLocation: {
    marginTop: 4,
    color: "#5F6963",
    fontSize: 12,
  },
  recentDate: {
    marginTop: 3,
    color: "#8A918D",
    fontSize: 11,
  },
  recentAdminNote: {
    marginTop: 5,
    color: "#536158",
    fontSize: 11,
    lineHeight: 16,
  },
  footerNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#1B5E3B",
  },
  footerText: {
    color: "#6B7280",
    fontSize: 12,
  },
});
