import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import {
  API_ENDPOINTS,
  authorizationHeader,
  readJsonResponse,
} from "@/lib/api";
import { invalidateReportData } from "@/lib/report-data-version";
import { UserProfileAvatar } from "@/components/user-profile-avatar";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ActivityIndicator,
  Alert,
  Button,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type Detection = {
  class_id: number;
  class_name: string;
  confidence: number;
  bounding_box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

type SelectedPhoto = {
  uri: string;
  source: "camera" | "gallery";
  location: Coordinates | null;
};

type AnalysisResult = {
  success: boolean;
  filename: string;
  potholes_detected: number;
  detections: Detection[];
  location?: {
    latitude: number;
    longitude: number;
  };
};

const parseExifCoordinate = (value: unknown): number | null => {
  const parsePart = (part: unknown): number | null => {
    if (typeof part === "number") return part;
    if (typeof part === "string") {
      const [numerator, denominator] = part.split("/").map(Number);
      if (!Number.isFinite(numerator)) return null;
      return denominator ? numerator / denominator : numerator;
    }
    if (typeof part === "object" && part !== null && "numerator" in part && "denominator" in part) {
      const rational = part as { numerator: number; denominator: number };
      return rational.denominator ? rational.numerator / rational.denominator : null;
    }
    return null;
  };

  const parts = Array.isArray(value)
    ? value
    : typeof value === "string" && value.includes(",")
      ? value.split(",").map((part) => part.trim())
      : [value];
  const numbers = parts.map(parsePart);
  if (numbers.some((part) => part === null)) return null;

  const [degrees = 0, minutes = 0, seconds = 0] = numbers as number[];
  return Math.abs(degrees) + minutes / 60 + seconds / 3600;
};

const getPhotoCoordinates = (exif: ImagePicker.ImagePickerAsset["exif"]): Coordinates | null => {
  if (!exif) return null;

  const latitude = parseExifCoordinate(exif.GPSLatitude);
  const longitude = parseExifCoordinate(exif.GPSLongitude);
  if (latitude === null || longitude === null) return null;

  const signedLatitude = /S/i.test(String(exif.GPSLatitudeRef ?? ""))
    ? -latitude
    : latitude;
  const signedLongitude = /W/i.test(String(exif.GPSLongitudeRef ?? ""))
    ? -longitude
    : longitude;

  if (Math.abs(signedLatitude) > 90 || Math.abs(signedLongitude) > 180) return null;
  return { latitude: signedLatitude, longitude: signedLongitude };
};

type ReportDraft = {
  analysis: AnalysisResult;
  location: Coordinates;
  imageUri: string;
};

export default function CameraScreen() {
  const { clearSession } = useAuthSession();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] =
    useCameraPermissions();

  const [camera, setCamera] =
    useState<CameraView | null>(null);

  const [selectedPhoto, setSelectedPhoto] =
    useState<SelectedPhoto | null>(null);
  const photoUri = selectedPhoto?.uri ?? null;
  const location = selectedPhoto?.location ?? null;
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);
  const [isLocationPromptDismissed, setIsLocationPromptDismissed] = useState(false);

  const [isUploading, setIsUploading] =
    useState(false);

  const [result, setResult] =
    useState<AnalysisResult | null>(null);

  const [reportSaveStatus, setReportSaveStatus] =
    useState<"saved" | "failed" | null>(null);
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [isSavingReport, setIsSavingReport] = useState(false);

  const analysisInProgress = useRef(false);
  const reportSubmissionStarted = useRef(false);
  const galleryFlowStartedAt = useRef<number | null>(null);
  const resultTransitionStartedAt = useRef<number | null>(null);

  const returnToCamera = () => {
    galleryFlowStartedAt.current = null;
    resultTransitionStartedAt.current = null;
    setResult(null);
    setReportSaveStatus(null);
    setSelectedPhoto(null);
    setIsLocationPromptDismissed(false);
    setImageSize(null);
    router.replace("/(app)/(tabs)/camera");
  };

  const saveReport = async (
    analysis: AnalysisResult,
    reportLocation: Coordinates | null,
    imageUri: string,
    description: string
  ) => {
    if (reportSubmissionStarted.current || !reportLocation) return;
    reportSubmissionStarted.current = true;
    setIsSavingReport(true);

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      console.log(
        "REPORT JWT exists:",
        Boolean(token),
        "length:",
        token?.length ?? 0
      );
      if (!token) {
        await clearSession();
        throw new Error("Authentication token unavailable");
      }

      const reportFormData = new FormData();
      const reportImage = new File(imageUri);
      reportFormData.append(
        "image_filename",
        reportImage.name || analysis.filename || imageUri.split("/").pop() || "road-scan"
      );
      reportFormData.append("file", reportImage);
      reportFormData.append("latitude", String(reportLocation.latitude));
      reportFormData.append("longitude", String(reportLocation.longitude));
      reportFormData.append("pothole_count", String(analysis.potholes_detected));
      reportFormData.append("description", description.trim());

      const authorization = `Bearer ${token}`;
      console.log(
        "REPORT Authorization header present:",
        Boolean(authorization)
      );
      const reportResponse = await fetch(
        API_ENDPOINTS.reports,
        {
          method: "POST",
          headers: authorizationHeader(token),
          body: reportFormData,
        }
      );
      if (reportResponse.status === 401 || reportResponse.status === 403) {
        await clearSession();
        return;
      }
      await readJsonResponse<unknown>(reportResponse);

      invalidateReportData();
      setReportSaveStatus("saved");
      setReportDraft(null);
    } catch (reportError) {
      console.log("❌ Report save error:", reportError);
      setReportSaveStatus("failed");
      reportSubmissionStarted.current = false;
    } finally {
      setIsSavingReport(false);
    }
  };

  const [imageSize, setImageSize] =
    useState<{ width: number; height: number } | null>(null);

  const [containerSize, setContainerSize] =
    useState({ width: 0, height: 0 });

  const loadImageSize = (uri: string, onComplete?: () => void) => {
    Image.getSize(
      uri,
      (width, height) => {
        setImageSize({ width, height });
        onComplete?.();
      },
      (error) => {
        console.log("❌ Image size error:", error);
        setImageSize(null);
        onComplete?.();
      }
    );
  };

  const getCurrentLocation = async (purpose: "camera" | "gallery") => {
    const locationStartedAt = Date.now();
    if (purpose === "gallery") {
      console.log("[PERF] Location request started", new Date(locationStartedAt).toISOString());
    }
    console.time("GPS");

    try {
      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Location Required",
          purpose === "camera"
            ? "RoadGuard needs location access to associate this photo with where it was taken. No later location will be used."
            : "You chose to use your current location for this gallery photo. Location permission is required."
        );
        return null;
      }

      const currentLocation =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

      const nextLocation = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      };

      console.log(
        "GPS acquisition time:",
        currentLocation.timestamp
      );
      return nextLocation;
    } catch (error) {
      console.log("❌ Location error:", error);
      Alert.alert(
        "Location Error",
        "Unable to get your location. Please make sure location services are enabled."
      );
      return null;
    } finally {
      console.timeEnd("GPS");
      if (purpose === "gallery") {
        console.log(
          `[PERF] Location request finished: ${Date.now() - locationStartedAt} ms`
        );
      }
    }
  };

  const preparePhoto = (
    uri: string,
    source: SelectedPhoto["source"],
    photoLocation: Coordinates | null
  ) => {
    const imagePreparationStartedAt = Date.now();
    const measurePreparation = source === "gallery";
    if (measurePreparation) {
      console.log(
        "[PERF] Image preparation started",
        new Date(imagePreparationStartedAt).toISOString()
      );
      galleryFlowStartedAt.current = null;
      resultTransitionStartedAt.current = null;
    }
    setSelectedPhoto({ uri, source, location: photoLocation });
    setResult(null);
    setReportSaveStatus(null);
    setIsLocationPromptDismissed(false);
    setImageSize(null);
    loadImageSize(uri, () => {
      if (measurePreparation) {
        console.log(
          `[PERF] Image preparation finished: ${Date.now() - imagePreparationStartedAt} ms`
        );
      }
    });
  };

  const chooseGalleryCurrentLocation = async () => {
    const flowStartedAt = Date.now();
    galleryFlowStartedAt.current = flowStartedAt;
    console.log(
      "[PERF] User tapped Choose Current Location",
      new Date(flowStartedAt).toISOString()
    );
    setIsSelectingLocation(true);
    try {
      const currentLocation = await getCurrentLocation("gallery");
      if (!currentLocation) return;

      setSelectedPhoto((photo) =>
        photo ? { ...photo, location: currentLocation } : photo
      );
    } finally {
      setIsSelectingLocation(false);
    }
  };

  useEffect(() => {
    if (!result || resultTransitionStartedAt.current === null) return;

    console.log(
      `[PERF] Analysis result displayed: ${Date.now() - resultTransitionStartedAt.current} ms after transition started`
    );
    console.log(
      "[PERF] Result/navigation to analysis result completed",
      new Date().toISOString()
    );
    if (galleryFlowStartedAt.current !== null) {
      console.log(
        `[PERF] Total flow: ${Date.now() - galleryFlowStartedAt.current} ms`
      );
    }
    resultTransitionStartedAt.current = null;
    galleryFlowStartedAt.current = null;
  }, [result]);

  // =====================================
  // PICK IMAGE FROM GALLERY
  // =====================================

  const pickImage = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Permission Required",
          "RoadGuard needs access to your photos."
        );

        return;
      }

      const selected =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
          exif: true,
        });

      if (!selected.canceled) {
        const uri = selected.assets[0].uri;

        console.log(
          "🖼️ Image selected:",
          uri
        );

        preparePhoto(uri, "gallery", getPhotoCoordinates(selected.assets[0].exif));
      }
    } catch (error) {
      console.log(
        "❌ Gallery error:",
        error
      );

      Alert.alert(
        "Gallery Error",
        String(error)
      );
    }
  };

  // =====================================
  // CAMERA PERMISSION LOADING
  // =====================================

  if (!permission) {
    return <View />;
  }

  // =====================================
  // CAMERA PERMISSION REQUEST
  // =====================================

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>

        <Text style={styles.permissionText}>
          RoadGuard needs access to your camera.
        </Text>

        <Button
          title="Allow Camera"
          onPress={requestPermission}
        />

      </View>
    );
  }

  if (
    selectedPhoto?.source === "gallery" &&
    !selectedPhoto.location &&
    !isLocationPromptDismissed
  ) {
    return (
      <View
        style={[
          styles.locationSelectionContainer,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <View style={[styles.avatarPosition, { top: insets.top + 12 }]}>
          <UserProfileAvatar overCamera />
        </View>
        <Image
          source={{ uri: selectedPhoto.uri }}
          style={styles.locationSelectionImage}
        />
        <Text style={styles.locationChoiceTitle}>Where was this photo taken?</Text>
        <Text style={styles.locationChoiceDescription}>
          Add your current location, or continue without attaching a location.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isSelectingLocation}
          style={styles.locationActionButton}
          onPress={() => void chooseGalleryCurrentLocation()}
        >
          {isSelectingLocation ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.locationActionText}>Use Current Location</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.chooseAnotherButton}
          onPress={() => setIsLocationPromptDismissed(true)}
        >
          <Text style={styles.chooseAnotherText}>Analyze without location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.chooseAnotherButton}
          onPress={() => {
            setSelectedPhoto(null);
            setImageSize(null);
            void pickImage();
          }}
        >
          <Text style={styles.chooseAnotherText}>Choose another photo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // =====================================
  // RESULT SCREEN
  // =====================================

  if (result && photoUri) {
    return (
      <View style={styles.resultContainer}>
        <View style={[styles.avatarPosition, { top: insets.top + 8 }]}>
          <UserProfileAvatar overCamera />
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
          activeOpacity={0.85}
          onPress={returnToCamera}
          style={[styles.resultBackButton, { top: insets.top + 8 }]}
        >
          <Text style={styles.resultBackButtonText}>← Back</Text>
        </TouchableOpacity>

        <View
          style={styles.resultImageContainer}
          onLayout={(event) => {
            const { width, height } =
              event.nativeEvent.layout;

            setContainerSize({ width, height });
          }}
        >
          <Image
            source={{ uri: photoUri }}
            style={styles.resultImage}
          />

          {result.potholes_detected > 0 &&
            imageSize &&
            containerSize.width > 0 &&
            containerSize.height > 0 &&
            result.detections.map((detection, index) => {
              const {
                x1,
                y1,
                x2,
                y2,
              } = detection.bounding_box;

              const scale = Math.min(
                containerSize.width / imageSize.width,
                containerSize.height / imageSize.height
              );

              const displayedWidth =
                imageSize.width * scale;

              const displayedHeight =
                imageSize.height * scale;

              const offsetX =
                (containerSize.width - displayedWidth) / 2;

              const offsetY =
                (containerSize.height - displayedHeight) / 2;

              const left = offsetX + x1 * scale;
              const top = offsetY + y1 * scale;
              const width = (x2 - x1) * scale;
              const height = (y2 - y1) * scale;

              return (
                <View
                  key={`${index}-${detection.class_id}`}
                  style={[
                    styles.boundingBox,
                    {
                      left,
                      top,
                      width,
                      height,
                    },
                  ]}
                >
                  <View style={styles.boundingBoxLabel}>
                    <Text style={styles.boundingBoxText}>
                      Pothole
                    </Text>
                  </View>
                </View>
              );
            })}
        </View>

        <ScrollView
          style={styles.resultScrollView}
          contentContainerStyle={styles.resultScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultCard}>

            {result.potholes_detected > 0 ? (
              <>
                <View style={styles.resultSummaryCard}>
                  <View style={styles.resultStatusIcon}>
                    <Text style={styles.resultStatusIconText}>!</Text>
                  </View>
                  <Text style={styles.resultTitle}>
                    🚧 {result.potholes_detected}{" "}
                    {result.potholes_detected === 1 ? "Pothole" : "Potholes"} Detected
                  </Text>
                  <Text style={styles.infoText}>
                    Review the marked areas and submit a report to help improve road safety.
                  </Text>
                </View>

                {location && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>📍 Location captured</Text>
                    <Text style={styles.locationText}>
                      Latitude: {location.latitude.toFixed(6)}
                    </Text>
                    <Text style={styles.locationText}>
                      Longitude: {location.longitude.toFixed(6)}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={[styles.resultSummaryCard, styles.noDetectionCard]}>
                  <Text style={styles.noDetectionIcon}>✓</Text>
                  <Text style={styles.resultTitle}>No Pothole Detected</Text>
                  <Text style={styles.infoText}>
                    No pothole was detected in this image.
                  </Text>
                </View>

                {location && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>📍 Location captured</Text>
                    <Text style={styles.locationText}>
                      Latitude: {location.latitude.toFixed(6)}
                    </Text>
                    <Text style={styles.locationText}>
                      Longitude: {location.longitude.toFixed(6)}
                    </Text>
                  </View>
                )}
              </>
            )}

            {reportSaveStatus && (
              <Text
                style={[
                  styles.reportSaveMessage,
                  reportSaveStatus === "saved"
                    ? styles.reportSaveSuccess
                    : styles.reportSaveFailure,
                ]}
              >
                {reportSaveStatus === "saved"
                  ? "Report saved successfully."
                  : "Detection completed, but the report could not be saved."}
              </Text>
            )}

            <View style={styles.resultButtons}>
              {result.potholes_detected > 0 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.reportIssueButton}
                  onPress={() => {
                    const reportLocation = selectedPhoto?.location ?? result.location;
                    if (!reportLocation) {
                      Alert.alert(
                        "Location Required",
                        "A report cannot be submitted without a location."
                      );
                      return;
                    }
                    setReportDescription("");
                    setReportDraft({
                      analysis: result,
                      location: reportLocation,
                      imageUri: photoUri,
                    });
                  }}
                >
                  <Text style={styles.reportIssueButtonText}>Report Issue</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.scanAnotherButton}
                onPress={() => {
                  setResult(null);
                  setReportSaveStatus(null);
                  setSelectedPhoto(null);
                  setImageSize(null);
                }}
              >
                <Text style={styles.scanAnotherButtonText}>Scan Another</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.chooseImageButton}
                onPress={() => {
                  setResult(null);
                  setSelectedPhoto(null);
                  setImageSize(null);
                  setTimeout(() => pickImage(), 100);
                }}
              >
                <Text style={styles.chooseImageButtonText}>Choose from Gallery</Text>
              </TouchableOpacity>
            </View>

          </View>
        </ScrollView>

        <Modal
          animationType="slide"
          onRequestClose={() => {
            if (!isSavingReport) setReportDraft(null);
          }}
          transparent
          visible={Boolean(reportDraft)}
        >
          <View style={styles.reportModalOverlay}>
            <ScrollView
              contentContainerStyle={styles.reportModalScrollContent}
              keyboardShouldPersistTaps="handled"
              style={styles.reportModalScroll}
            >
              {reportDraft ? (
                <View style={styles.reportForm}>
                  <Image
                    accessibilityLabel="Report image preview"
                    source={{ uri: reportDraft.imageUri }}
                    style={styles.reportFormImage}
                  />
                  <Text style={styles.reportFormSummary}>
                    {reportDraft.analysis.potholes_detected} pothole
                    {reportDraft.analysis.potholes_detected === 1 ? "" : "s"} detected
                  </Text>
                  <Text style={styles.reportFormLocation}>
                    Location: {reportDraft.location.latitude.toFixed(6)},{" "}
                    {reportDraft.location.longitude.toFixed(6)}
                  </Text>
                  <Text style={styles.reportFormLabel}>Description (Optional)</Text>
                  <TextInput
                    accessibilityLabel="Description (Optional)"
                    multiline
                    onChangeText={setReportDescription}
                    placeholder="Describe the road condition or any useful details..."
                    placeholderTextColor="#71717A"
                    style={styles.reportDescriptionInput}
                    textAlignVertical="top"
                    value={reportDescription}
                  />
                  {reportSaveStatus === "failed" ? (
                    <Text style={styles.reportSaveFailure}>
                      Report could not be saved. Please try again.
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={isSavingReport}
                    onPress={() =>
                      void saveReport(
                        reportDraft.analysis,
                        reportDraft.location,
                        reportDraft.imageUri,
                        reportDescription
                      )
                    }
                    style={[
                      styles.submitReportButton,
                      isSavingReport && styles.submitReportButtonDisabled,
                    ]}
                  >
                    <Text style={styles.submitReportButtonText}>
                      {isSavingReport ? "Submitting..." : "Submit Report"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={isSavingReport}
                    onPress={() => setReportDraft(null)}
                    style={styles.cancelReportButton}
                  >
                    <Text style={styles.cancelReportButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </Modal>

      </View>
    );
  }

  // =====================================
  // PHOTO PREVIEW
  // =====================================

  if (photoUri) {
    return (
      <View style={styles.previewContainer}>

        <Image
          source={{ uri: photoUri }}
          style={styles.preview}
        />

        <View style={[styles.avatarPosition, { top: insets.top + 12 }]}>
          <UserProfileAvatar overCamera />
        </View>
        <View
          style={[
            styles.previewHeader,
            { top: insets.top + 12, right: 72 },
          ]}
        >
          <Text style={styles.previewHeaderTitle}>Review your photo</Text>
          <Text style={styles.previewHeaderSubtitle}>
            Analyze this image to check for potholes.
          </Text>
        </View>

        {isUploading ? (
          <View pointerEvents="none" style={styles.analyzingOverlay}>
            <ActivityIndicator color="#FFFFFF" size="large" />
            <Text style={styles.analyzingTitle}>Analyzing road...</Text>
            <Text style={styles.analyzingSubtitle}>Detecting potholes</Text>
          </View>
        ) : null}

        <View
          style={[
            styles.previewControls,
            { bottom: Math.max(insets.bottom, 8) + 10 },
          ]}
        >

          {/* RETAKE / CHOOSE ANOTHER */}

          <TouchableOpacity
            style={styles.retakeButton}
            onPress={() => {
              setSelectedPhoto(null);
              setImageSize(null);
            }}
            disabled={isUploading}
          >
            <Text style={styles.retakeText}>
              ↩ Retake
            </Text>
          </TouchableOpacity>

          {/* ANALYZE */}

          <TouchableOpacity
            style={[
              styles.analyzeButton,
              isUploading &&
                styles.disabledButton,
            ]}
            disabled={isUploading}
            onPress={async () => {
                const photoForAnalysis = selectedPhoto;
                if (!photoForAnalysis) return;
                if (analysisInProgress.current) return;
                analysisInProgress.current = true;

              try {

                console.log(
                  "🔥 ANALYZE BUTTON PRESSED"
                );

                setIsUploading(true);
                setReportSaveStatus(null);
                reportSubmissionStarted.current = false;

                console.time("AI_UPLOAD");

                console.log(
                  "📁 Creating File object..."
                );

                const file =
                  new File(photoForAnalysis.uri);

                console.log(
                  "📄 File URI:",
                  file.uri
                );

                console.log(
                  "📄 File type:",
                  file.type
                );

                console.log(
                  "📄 File size:",
                  file.size
                );

                console.log(
                  "📤 Sending image to FastAPI..."
                );

                const formData = new FormData();

                formData.append("file", file);

                if (photoForAnalysis.location) {
                  formData.append(
                    "latitude",
                    String(photoForAnalysis.location.latitude)
                  );
                  formData.append(
                    "longitude",
                    String(photoForAnalysis.location.longitude)
                  );
                }

                const token = await SecureStore.getItemAsync(
                  "roadguard_access_token"
                );
                if (!token) {
                  await clearSession();
                  throw new Error("Please sign in again to analyze images.");
                }

                const analyzeStartedAt = Date.now();
                console.log(
                  "[PERF] Analyze request started",
                  new Date(analyzeStartedAt).toISOString()
                );
                const response =
                  await globalThis.fetch(
                    API_ENDPOINTS.analyze,
                    {
                      method: "POST",
                      headers: authorizationHeader(token),
                      body: formData,
                    }
                  );

                console.log(
                  "📥 Response status:",
                  response.status
                );

                const data =
                  await readJsonResponse<AnalysisResult>(response);
                console.log(
                  `[PERF] Analyze request finished: ${Date.now() - analyzeStartedAt} ms`
                );

                console.log(
                  "🤖 AI RESULT:",
                  data
                );

                resultTransitionStartedAt.current = Date.now();
                console.log(
                  "[PERF] Result/navigation to analysis result started",
                  new Date(resultTransitionStartedAt.current).toISOString()
                );
                setResult(data);

              } catch (error) {

                console.log(
                  "❌ Upload error:",
                  error
                );

                Alert.alert(
                  "Analysis Error",
                  String(error)
                );

              } finally {

                console.timeEnd("AI_UPLOAD");
                analysisInProgress.current = false;
                setIsUploading(false);

              }

            }}
          >
            <Text style={styles.analyzeText}>
              Analyze Road
            </Text>
          </TouchableOpacity>

        </View>

      </View>
    );
  }

  // =====================================
  // CAMERA SCREEN
  // =====================================

  return (
    <View style={styles.container}>

      <CameraView
        style={styles.camera}
        facing="back"
        ref={(ref) => setCamera(ref)}
      />

      {/* TOP TEXT */}

      <View
        style={[
          styles.cameraOverlay,
          { top: insets.top + 8, right: 72 },
        ]}
      >
        <Text style={styles.cameraTitle}>
          Scan Road
        </Text>
        <Text style={styles.cameraSubtitle}>
          Capture a road image to detect potholes.
        </Text>
      </View>

      <View style={[styles.avatarPosition, { top: insets.top + 8 }]}>
        <UserProfileAvatar overCamera />
      </View>

      {/* CAMERA CONTROLS */}

      <View
        style={[
          styles.controls,
          { bottom: Math.max(insets.bottom, 8) + 8 },
        ]}
      >
        <TouchableOpacity
          style={styles.galleryButton}
          onPress={pickImage}
        >
          <Text style={styles.galleryIcon}>🖼️</Text>
          <Text style={styles.galleryText}>
            Gallery
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.captureButton}
          accessibilityRole="button"
          accessibilityLabel="Capture photo"
          onPress={async () => {

            if (!camera) {

              console.log(
                "❌ Camera reference unavailable"
              );

              return;
            }

            try {

              console.log(
                "📸 Taking picture..."
              );

              const photo =
                await camera.takePictureAsync();

              if (photo?.uri) {

                console.log(
                  "✅ Photo captured:",
                  photo.uri
                );

                const capturedLocation = await getCurrentLocation("camera");
                if (capturedLocation) {
                  preparePhoto(photo.uri, "camera", capturedLocation);
                }
              }

            } catch (error) {

              console.log(
                "❌ Camera error:",
                error
              );

            }

          }}
        >
          <View style={styles.innerButton} />
          <Text style={styles.captureHint}>Capture</Text>
        </TouchableOpacity>
        <View style={styles.controlSpacer} />
      </View>

    </View>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({

  locationChoiceTitle: {
    color: "#1A1A1A",
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center",
  },

  locationChoiceDescription: {
    marginTop: 8,
    color: "#6B7280",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  locationActionButton: {
    width: "100%",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },

  locationActionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },

  locationSelectionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 22,
    backgroundColor: "#F6F5F2",
  },

  locationSelectionImage: {
    width: "100%",
    height: 260,
    marginBottom: 26,
    borderRadius: 15,
    backgroundColor: "#E8E9EB",
    resizeMode: "contain",
  },

  chooseAnotherButton: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 14,
  },

  chooseAnotherText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "600",
  },

  container: {
    flex: 1,
    backgroundColor: "black",
  },

  camera: {
    flex: 1,
  },

  cameraOverlay: {
    position: "absolute",
    left: 16,
    right: 72,
    alignItems: "flex-start",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(12, 35, 25, 0.58)",
  },

  cameraTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },

  avatarPosition: {
    position: "absolute",
    right: 16,
    zIndex: 5,
  },

  cameraSubtitle: {
    color: "#E3EEE7",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },

  controls: {
    position: "absolute",
    left: 12,
    right: 12,
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(12, 25, 19, 0.62)",
  },

  // =====================================
  // GALLERY BUTTON
  // =====================================

  galleryButton: {
    flex: 1,
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },

  galleryText: {
    marginTop: 3,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  galleryIcon: {
    color: "#FFFFFF",
    fontSize: 23,
    lineHeight: 25,
  },

  // =====================================
  // CAMERA BUTTON
  // =====================================

  captureButton: {
    flex: 1,
    minHeight: 84,
    alignItems: "center",
    justifyContent: "center",
  },

  innerButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "#FFFFFF",
  },

  captureHint: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
  },

  controlSpacer: {
    flex: 1,
  },

  // =====================================
  // PERMISSION
  // =====================================

  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },

  permissionText: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
  },

  // =====================================
  // PREVIEW
  // =====================================

  previewContainer: {
    flex: 1,
    backgroundColor: "#101713",
  },

  preview: {
    flex: 1,
    width: "100%",
    resizeMode: "contain",
  },

  previewHeader: {
    position: "absolute",
    top: 18,
    left: 18,
    right: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(12, 35, 25, 0.82)",
  },

  previewHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },

  previewHeaderSubtitle: {
    marginTop: 4,
    color: "#E3EEE7",
    fontSize: 13,
  },

  analyzingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 25, 18, 0.72)",
  },

  analyzingTitle: {
    marginTop: 16,
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },

  analyzingSubtitle: {
    marginTop: 6,
    color: "#E3EEE7",
    fontSize: 14,
  },

  previewControls: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(12, 35, 25, 0.88)",
  },

  retakeButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },

  retakeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
  },

  analyzeButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },

  disabledButton: {
    opacity: 0.6,
  },

  analyzeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // =====================================
  // RESULT SCREEN
  // =====================================

  resultContainer: {
    flex: 1,
    backgroundColor: "#F5F7F5",
  },

  resultBackButton: {
    position: "absolute",
    left: 16,
    zIndex: 2,
    elevation: 6,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 15,
    borderRadius: 21,
    backgroundColor: "rgba(17, 17, 17, 0.78)",
  },

  resultBackButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },

  resultImageContainer: {
    width: "100%",
    height: "49%",
    position: "relative",
    backgroundColor: "black",
  },

  resultImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
    backgroundColor: "black",
  },

  boundingBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#ff3b30",
    borderRadius: 6,
    backgroundColor: "rgba(255, 59, 48, 0.08)",
  },

  boundingBoxLabel: {
    position: "absolute",
    top: -24,
    left: 0,
    backgroundColor: "rgba(17, 17, 17, 0.8)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  boundingBoxText: {
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
  },

  resultScrollView: {
    flex: 1,
    backgroundColor: "#F5F7F5",
  },

  resultScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: "stretch",
  },

  resultCard: {
    width: "100%",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E9E4",
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },

  resultSummaryCard: {
    width: "100%",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#F2F8F4",
  },

  resultStatusIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderRadius: 19,
    backgroundColor: "#FCE8E6",
  },

  resultStatusIconText: {
    color: "#A14435",
    fontSize: 20,
    fontWeight: "800",
  },

  noDetectionCard: {
    backgroundColor: "#EAF5EE",
  },

  noDetectionIcon: {
    marginBottom: 7,
    color: "#1B5E3B",
    fontSize: 32,
    fontWeight: "700",
  },

  reportIssueButton: {
    width: "100%",
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: "#1B5E3B",
  },

  reportIssueButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  scanAnotherButton: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1B5E3B",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },

  scanAnotherButtonText: {
    color: "#1B5E3B",
    fontSize: 14,
    fontWeight: "700",
  },

  chooseImageButton: {
    width: "100%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#F0F3F1",
  },

  chooseImageButtonText: {
    color: "#46534B",
    fontSize: 14,
    fontWeight: "600",
  },

  reportForm: {
    width: "100%",
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },

  reportModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },

  reportModalScroll: {
    flexGrow: 0,
    maxHeight: "90%",
    width: "100%",
    alignSelf: "center",
    maxWidth: 480,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },

  reportModalScrollContent: {
    flexGrow: 1,
  },

  reportFormImage: {
    width: "100%",
    height: 160,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: "#E8E9EB",
    resizeMode: "cover",
  },

  reportFormSummary: {
    color: "#1A1A1A",
    fontSize: 16,
    fontWeight: "700",
  },

  reportFormLocation: {
    marginTop: 6,
    marginBottom: 14,
    color: "#555",
    fontSize: 14,
  },

  reportFormLabel: {
    marginBottom: 7,
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "600",
  },

  reportDescriptionInput: {
    minHeight: 100,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    color: "#1A1A1A",
    fontSize: 14,
  },

  submitReportButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: "#1B5E3B",
  },

  submitReportButtonDisabled: {
    opacity: 0.65,
  },

  submitReportButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  cancelReportButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  cancelReportButtonText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "600",
  },

  resultTitle: {
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 7,
  },

  resultCount: {
    fontSize: 15,
    color: "#46534B",
    marginBottom: 10,
  },

  infoBox: {
    width: "80%",
    padding: 18,
    borderRadius: 15,
    backgroundColor: "white",
    alignItems: "center",
    marginBottom: 20,
  },

  infoLabel: {
    fontSize: 15,
    color: "#777",
  },

  confidence: {
    fontSize: 32,
    fontWeight: "bold",
    marginTop: 5,
  },

  infoText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    color: "#5A655E",
    marginBottom: 10,
  },

  reportSaveMessage: {
    width: "100%",
    marginBottom: 16,
    fontSize: 14,
    textAlign: "center",
  },

  reportSaveSuccess: {
    color: "#246B45",
  },

  reportSaveFailure: {
    color: "#A14435",
  },

  locationCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    marginBottom: 14,
  },

  locationTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
  },

  locationText: {
    fontSize: 13,
    color: "#5A655E",
    marginTop: 6,
  },

  resultButtons: {
    width: "100%",
    alignItems: "center",
    marginTop: 14,
  },

  scanAgainButton: {
    backgroundColor: "#111",
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    width: "100%",
    marginBottom: 12,
    alignItems: "center",
  },

  scanAgainText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },

  galleryResultButton: {
    marginTop: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#111",
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },

  galleryResultText: {
    color: "#111",
    fontSize: 16,
    fontWeight: "bold",
  },

});