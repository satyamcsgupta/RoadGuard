import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { SymbolView } from "expo-symbols";
import { useAuthSession } from "@/hooks/use-auth-session";
import { profilePictureKey } from "@/lib/profile-picture";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  API_ENDPOINTS,
  authorizationHeader,
  readJsonResponse,
} from "@/lib/api";
import {
  getCachedActivity,
  getCachedActivityVersion,
  getReportDataVersion,
  setCachedActivity,
} from "@/lib/report-data-version";

type ReportSummary = {
  pothole_count: number;
};

type ActivityState = "loading" | "loaded" | "error";

export default function ProfileScreen() {
  const { user, isLoading, clearSession } = useAuthSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [isPictureActionsVisible, setIsPictureActionsVisible] = useState(false);
  const [isSavingPicture, setIsSavingPicture] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [reportCount, setReportCount] = useState(
    () => getCachedActivity()?.reportCount ?? 0
  );
  const [potholeCount, setPotholeCount] = useState(
    () => getCachedActivity()?.potholeCount ?? 0
  );
  const [activityState, setActivityState] =
    useState<ActivityState>(() =>
      getCachedActivity() ? "loaded" : "loading"
    );
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadProfilePicture = async () => {
      if (!user) {
        if (isActive) setProfileImageUri(null);
        return;
      }
      try {
        const savedUri = await SecureStore.getItemAsync(profilePictureKey(user.id));
        if (!isActive) return;
        if (savedUri && new File(savedUri).exists) {
          setProfileImageUri(savedUri);
        } else {
          setProfileImageUri(null);
          if (savedUri) {
            await SecureStore.deleteItemAsync(profilePictureKey(user.id));
          }
        }
      } catch (error) {
        if (!isActive) return;
        setPictureError(
          error instanceof Error
            ? error.message
            : "Unable to load your profile picture."
        );
      }
    };

    void loadProfilePicture();
    return () => {
      isActive = false;
    };
  }, [user]);

  const loadActivity = useCallback(async (
    version = getReportDataVersion(),
    showLoading = getCachedActivity() === null
  ) => {
    if (showLoading) setActivityState("loading");
    setActivityError(null);
    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      if (!token) {
        await clearSession();
        setReportCount(0);
        setPotholeCount(0);
        setActivityError("Sign in again to view your activity.");
        setActivityState("error");
        return;
      }

      const response = await fetch(API_ENDPOINTS.reports, {
        headers: authorizationHeader(token),
      });
      if (response.status === 401 || response.status === 403) {
        await clearSession();
        return;
      }
      const data = await readJsonResponse<unknown>(response);
      if (
        !Array.isArray(data) ||
        !data.every(
          (report): report is ReportSummary =>
            typeof report === "object" &&
            report !== null &&
            "pothole_count" in report &&
            typeof report.pothole_count === "number"
        )
      ) {
        throw new Error("Unexpected reports response");
      }

      const activity = {
        reportCount: data.length,
        potholeCount: data.reduce(
          (total, report) => total + report.pothole_count,
          0
        ),
      };
      setReportCount(activity.reportCount);
      setPotholeCount(activity.potholeCount);
      setCachedActivity(activity, version);
      setActivityState("loaded");
    } catch (error) {
      setActivityError(
        error instanceof Error ? error.message : "Unable to load activity."
      );
      setActivityState("error");
    }
  }, [clearSession]);

  useFocusEffect(
    useCallback(() => {
      const version = getReportDataVersion();
      const cachedActivity = getCachedActivity();
      if (cachedActivity) {
        setReportCount(cachedActivity.reportCount);
        setPotholeCount(cachedActivity.potholeCount);
        setActivityState("loaded");
      }
      if (!user || (cachedActivity && getCachedActivityVersion() === version)) return;

      void loadActivity(version, cachedActivity === null);
    }, [loadActivity, user])
  );

  const chooseProfilePicture = async (source: "gallery" | "camera") => {
    setIsPictureActionsVisible(false);
    setPictureError(null);
    try {
      if (source === "gallery") {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "Photo access needed",
            "Allow RoadGuard to access your photos to choose a profile picture."
          );
          return;
        }
      } else {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "Camera access needed",
            "Allow RoadGuard to use the camera to take a profile picture."
          );
          return;
        }
      }

      const result =
        source === "gallery"
          ? await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.85,
            })
          : await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.85,
            });

      if (!result.canceled && result.assets[0]) {
        setPendingImageUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert(
        "Unable to select image",
        error instanceof Error ? error.message : "Please try again."
      );
    }
  };

  const saveProfilePicture = async () => {
    if (!user || !pendingImageUri || isSavingPicture) return;
    setIsSavingPicture(true);
    setPictureError(null);
    let newPicture: File | null = null;

    try {
      const sourceFile = new File(pendingImageUri);
      const extensionMatch = pendingImageUri.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
      const extension = extensionMatch?.[1]?.toLowerCase() ?? "jpg";
      newPicture = new File(
        Paths.document,
        `roadguard-profile-${user.id}-${Date.now()}.${extension}`
      );
      await sourceFile.copy(newPicture);
      await SecureStore.setItemAsync(
        profilePictureKey(user.id),
        newPicture.uri
      );
      setProfileImageUri(newPicture.uri);
      setPendingImageUri(null);
    } catch (error) {
      setPictureError(
        error instanceof Error
          ? error.message
          : "Unable to save your profile picture. Please try again."
      );
      Alert.alert("Profile picture not saved", "Please try again.");
      if (newPicture?.exists) newPicture.delete();
    } finally {
      setIsSavingPicture(false);
    }
  };

  const removeProfilePicture = async () => {
    if (!user || isSavingPicture) return;
    setIsPictureActionsVisible(false);
    setIsSavingPicture(true);
    setPictureError(null);
    try {
      await SecureStore.deleteItemAsync(profilePictureKey(user.id));
      const oldPictureUri = profileImageUri;
      setProfileImageUri(null);
      if (oldPictureUri) {
        const oldPicture = new File(oldPictureUri);
        if (oldPicture.exists) oldPicture.delete();
      }
    } catch (error) {
      setPictureError(
        error instanceof Error
          ? error.message
          : "Unable to remove your profile picture. Please try again."
      );
    } finally {
      setIsSavingPicture(false);
    }
  };

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await clearSession();
    } catch {
      setLogoutError("Signed out, but saved credentials could not be fully cleared.");
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
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Profile</Text>

        <View style={styles.profileHeader}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              {profileImageUri ? (
                <Image
                  accessibilityLabel="Profile picture"
                  source={{ uri: profileImageUri }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={styles.avatarInitials}>
                  {user.name
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join("") || "RG"}
                </Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile picture"
              disabled={isSavingPicture}
              onPress={() => setIsPictureActionsVisible(true)}
              style={({ pressed }) => [
                styles.avatarEditButton,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }}
                size={16}
                tintColor="#FFFFFF"
              />
            </Pressable>
          </View>
          {pictureError ? (
            <Text accessibilityRole="alert" style={styles.pictureError}>
              {pictureError}
            </Text>
          ) : null}
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>

        <View style={styles.accountSection}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.accountField}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text selectable style={styles.fieldValue}>
              {user.name}
            </Text>
          </View>
          <View style={styles.accountDivider} />
          <View style={styles.accountField}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text selectable style={styles.fieldValue}>
              {user.email}
            </Text>
          </View>
        </View>

        <View style={styles.activitySection}>
          <View style={styles.activityHeader}>
            <View>
              <Text style={styles.sectionTitle}>RoadGuard Activity</Text>
              <Text style={styles.activitySubtitle}>Your reports at a glance</Text>
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
              {activityState === "loading" ? (
                <ActivityIndicator
                  accessibilityLabel="Loading reports submitted"
                  color="#1B5E3B"
                  style={styles.activityLoader}
                />
              ) : (
                <Text style={styles.activityValue}>
                  {activityState === "error" ? "—" : reportCount}
                </Text>
              )}
            </View>
            <View style={styles.activityCard}>
              <Text style={styles.activityLabel}>Potholes detected</Text>
              {activityState === "loading" ? (
                <ActivityIndicator
                  accessibilityLabel="Loading potholes detected"
                  color="#1B5E3B"
                  style={styles.activityLoader}
                />
              ) : (
                <Text style={styles.activityValue}>
                  {activityState === "error" ? "—" : potholeCount}
                </Text>
              )}
            </View>
          </View>
          {activityState === "error" ? (
            <View style={styles.activityErrorRow}>
              <Text style={styles.activityErrorText}>
                Activity unavailable. {activityError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void loadActivity(getReportDataVersion(), true)
                }
                style={styles.activityRetryButton}
              >
                <Text style={styles.activityRetryText}>Try Again</Text>
              </Pressable>
            </View>
          ) : null}
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
              Alert.alert(
                "Log out?",
                "Are you sure you want to log out of RoadGuard?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Log out",
                    style: "destructive",
                    onPress: () => void logout(),
                  },
                ]
              )
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
              <Text style={styles.logoutText}>Log out</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={isPictureActionsVisible}
        onRequestClose={() => setIsPictureActionsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.actionSheet}>
            <Text style={styles.modalTitle}>Profile picture</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void chooseProfilePicture("gallery")}
              style={styles.actionRow}
            >
              <Text style={styles.actionText}>Choose from Gallery</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void chooseProfilePicture("camera")}
              style={styles.actionRow}
            >
              <Text style={styles.actionText}>Take a Photo</Text>
            </Pressable>
            {profileImageUri ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void removeProfilePicture()}
                style={styles.actionRow}
              >
                <Text style={styles.removeActionText}>Remove Picture</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsPictureActionsVisible(false)}
              style={styles.cancelAction}
            >
              <Text style={styles.cancelActionText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(pendingImageUri)}
        onRequestClose={() => {
          if (!isSavingPicture) setPendingImageUri(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.previewSheet}>
            <Text style={styles.modalTitle}>Preview Profile Picture</Text>
            {pendingImageUri ? (
              <Image
                accessibilityLabel="Preview of selected profile picture"
                source={{ uri: pendingImageUri }}
                style={styles.previewImage}
              />
            ) : null}
            {pictureError ? (
              <Text accessibilityRole="alert" style={styles.pictureError}>
                {pictureError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSavingPicture}
              onPress={() => void saveProfilePicture()}
              style={[styles.savePictureButton, isSavingPicture && styles.disabled]}
            >
              {isSavingPicture ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.savePictureText}>Save Picture</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSavingPicture}
              onPress={() => {
                if (isSavingPicture) return;
                setPendingImageUri(null);
                setIsPictureActionsVisible(true);
              }}
              style={styles.cancelAction}
            >
              <Text style={styles.cancelActionText}>Choose Another</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSavingPicture}
              onPress={() => setPendingImageUri(null)}
              style={styles.cancelAction}
            >
              <Text style={styles.cancelActionText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    paddingTop: 16,
    paddingBottom: 36,
  },
  title: {
    color: "#1A2A20",
    fontSize: 28,
    fontWeight: "700",
  },
  profileHeader: {
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 22,
  },
  avatarWrap: {
    position: "relative",
    marginBottom: 2,
  },
  avatar: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    borderRadius: 52,
    backgroundColor: "#DDEBE1",
    elevation: 2,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitials: {
    color: "#1B5E3B",
    fontSize: 30,
    fontWeight: "700",
  },
  avatarEditButton: {
    position: "absolute",
    right: -2,
    bottom: 2,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#F5F7F5",
    borderRadius: 18,
    backgroundColor: "#1B5E3B",
  },
  name: {
    marginTop: 14,
    color: "#1A2A20",
    fontSize: 21,
    fontWeight: "700",
  },
  email: {
    marginTop: 4,
    color: "#66736A",
    fontSize: 14,
  },
  pictureError: {
    marginTop: 10,
    color: "#A14435",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  accountSection: {
    padding: 17,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 1,
  },
  sectionTitle: {
    color: "#26382D",
    fontSize: 17,
    fontWeight: "700",
  },
  accountField: {
    marginTop: 14,
  },
  accountDivider: {
    height: 1,
    marginTop: 13,
    backgroundColor: "#E9EEEA",
  },
  fieldLabel: {
    color: "#77827A",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  fieldValue: {
    marginTop: 6,
    color: "#26382D",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  activitySection: {
    marginTop: 23,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  activitySubtitle: {
    marginTop: 4,
    color: "#77827A",
    fontSize: 13,
  },
  activityRow: {
    flexDirection: "row",
    gap: 12,
  },
  activityCard: {
    flex: 1,
    minHeight: 99,
    justifyContent: "space-between",
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    elevation: 1,
  },
  activityLabel: {
    color: "#66736A",
    fontSize: 12,
    lineHeight: 17,
  },
  activityValue: {
    marginTop: 7,
    color: "#1B5E3B",
    fontSize: 27,
    fontWeight: "700",
  },
  activityLoader: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  activityErrorRow: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FAEEEC",
  },
  activityErrorText: {
    color: "#8B3D33",
    fontSize: 13,
    lineHeight: 19,
  },
  activityRetryButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingVertical: 5,
    paddingRight: 8,
  },
  activityRetryText: {
    color: "#1B5E3B",
    fontSize: 13,
    fontWeight: "700",
  },
  logoutSection: {
    marginTop: "auto",
    paddingTop: 26,
  },
  logoutButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#A14435",
    borderRadius: 12,
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
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: "rgba(10, 25, 18, 0.55)",
  },
  actionSheet: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    padding: 18,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  previewSheet: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  modalTitle: {
    alignSelf: "center",
    marginBottom: 12,
    color: "#1A2A20",
    fontSize: 18,
    fontWeight: "700",
  },
  actionRow: {
    minHeight: 50,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: "#EEF1EF",
  },
  actionText: {
    color: "#26382D",
    fontSize: 15,
    fontWeight: "600",
  },
  removeActionText: {
    color: "#A14435",
    fontSize: 15,
    fontWeight: "600",
  },
  cancelAction: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: "#F2F5F3",
  },
  cancelActionText: {
    color: "#58645C",
    fontSize: 14,
    fontWeight: "600",
  },
  previewImage: {
    width: "100%",
    maxWidth: 280,
    aspectRatio: 1,
    marginBottom: 15,
    borderRadius: 18,
    backgroundColor: "#EAF2ED",
  },
  savePictureButton: {
    width: "100%",
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },
  savePictureText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.65,
  },
});