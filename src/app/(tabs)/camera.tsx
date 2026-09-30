import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ActivityIndicator,
  Alert,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Text,
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

export default function CameraScreen() {
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

  const analysisInProgress = useRef(false);
  const reportSubmissionStarted = useRef(false);

  const returnToCamera = () => {
    setResult(null);
    setReportSaveStatus(null);
    setSelectedPhoto(null);
    setIsLocationPromptDismissed(false);
    setImageSize(null);
    router.replace("/(tabs)/camera");
  };

  const saveReport = async (
    analysis: AnalysisResult,
    reportLocation: Coordinates | null,
    imageUri: string
  ) => {
    if (reportSubmissionStarted.current) return;
    reportSubmissionStarted.current = true;

    try {
      const token = await SecureStore.getItemAsync("roadguard_access_token");
      console.log(
        "REPORT JWT exists:",
        Boolean(token),
        "length:",
        token?.length ?? 0
      );
      if (!token || !reportLocation) {
        throw new Error("Authentication token or scan location unavailable");
      }

      const reportFormData = new FormData();
      reportFormData.append(
        "image_filename",
        analysis.filename || imageUri.split("/").pop() || "road-scan"
      );
      reportFormData.append("latitude", String(reportLocation.latitude));
      reportFormData.append("longitude", String(reportLocation.longitude));
      reportFormData.append("pothole_count", String(analysis.potholes_detected));

      const authorization = `Bearer ${token}`;
      console.log(
        "REPORT Authorization header present:",
        Boolean(authorization)
      );
      const reportResponse = await fetch(
        "http://10.41.228.118:8000/reports",
        {
          method: "POST",
          headers: { Authorization: authorization },
          body: reportFormData,
        }
      );

      if (!reportResponse.ok) {
        console.warn("REPORT API status:", reportResponse.status);
        if (reportResponse.status === 401) {
          try {
            const errorBody: unknown = await reportResponse.json();
            if (
              typeof errorBody === "object" &&
              errorBody !== null &&
              "detail" in errorBody &&
              typeof errorBody.detail === "string"
            ) {
              console.warn("REPORT API 401 detail:", errorBody.detail);
            }
          } catch {
            console.warn("REPORT API 401 detail unavailable");
          }
        }
        throw new Error("Report request failed");
      }

      setReportSaveStatus("saved");
    } catch (reportError) {
      console.log("❌ Report save error:", reportError);
      setReportSaveStatus("failed");
    }
  };

  const [imageSize, setImageSize] =
    useState<{ width: number; height: number } | null>(null);

  const [containerSize, setContainerSize] =
    useState({ width: 0, height: 0 });

  const loadImageSize = (uri: string) => {
    Image.getSize(
      uri,
      (width, height) => {
        setImageSize({ width, height });
      },
      (error) => {
        console.log("❌ Image size error:", error);
        setImageSize(null);
      }
    );
  };

  const getCurrentLocation = async (purpose: "camera" | "gallery") => {
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
    }
  };

  const preparePhoto = (
    uri: string,
    source: SelectedPhoto["source"],
    photoLocation: Coordinates | null
  ) => {
    setSelectedPhoto({ uri, source, location: photoLocation });
    setResult(null);
    setReportSaveStatus(null);
    setIsLocationPromptDismissed(false);
    setImageSize(null);
    loadImageSize(uri);
  };

  const chooseGalleryCurrentLocation = async () => {
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
                <Text style={styles.resultTitle}>
                  {result.potholes_detected > 1
                    ? "🚧 Potholes Detected"
                    : "🚧 Pothole Detected"}
                </Text>

                <Text style={styles.resultCount}>
                  {result.potholes_detected} pothole
                  {result.potholes_detected > 1
                    ? "s"
                    : ""}{" "}
                  detected
                </Text>

                <Text style={styles.infoText}>
                  {result.potholes_detected > 1
                    ? "Multiple potholes were detected in this image."
                    : "A pothole was detected in this image."}
                </Text>

                {location && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>
                      📍 Detection Location
                    </Text>
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
                <Text style={styles.resultTitle}>
                  ✅ No Detection
                </Text>

                <Text style={styles.infoText}>
                  No pothole detected. This image was not reported.
                </Text>

                {location && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>
                      📍 Detection Location
                    </Text>
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
              {/* SCAN WITH CAMERA */}

              <TouchableOpacity
                style={styles.scanAgainButton}
                onPress={() => {
                  setResult(null);
                  setReportSaveStatus(null);
                  setSelectedPhoto(null);
                  setImageSize(null);
                }}
              >
                <Text style={styles.scanAgainText}>
                  📷 Scan with Camera
                </Text>
              </TouchableOpacity>

              {/* CHOOSE FROM GALLERY */}

              <TouchableOpacity
                style={styles.galleryResultButton}
                onPress={() => {
                  setResult(null);
                  setSelectedPhoto(null);
                  setImageSize(null);

                  setTimeout(() => {
                    pickImage();
                  }, 100);
                }}
              >
                <Text style={styles.galleryResultText}>
                  🖼️ Choose from Gallery
                </Text>
              </TouchableOpacity>
            </View>

          </View>
        </ScrollView>

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

        <View style={styles.previewControls}>

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

                const response =
                  await fetch(
                    "http://10.41.228.118:8000/analyze",
                    {
                      method: "POST",
                      body: formData,
                    }
                  );

                console.log(
                  "📥 Response status:",
                  response.status
                );

                const data =
                  await response.json();

                console.log(
                  "🤖 AI RESULT:",
                  data
                );

                if (!response.ok) {
                  throw new Error(
                    "Server returned an error"
                  );
                }

                setResult(data);
                if (data.potholes_detected > 0) {
                  requestAnimationFrame(() => {
                    if (photoForAnalysis.location) {
                      Alert.alert(
                        "Report this pothole?",
                        "A pothole was detected in this image. Do you want to submit it as a road-condition report?",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Report",
                            onPress: () =>
                              void saveReport(
                                data,
                                photoForAnalysis.location,
                                photoForAnalysis.uri
                              ),
                          },
                        ]
                      );
                    } else {
                      Alert.alert(
                        "Location Required",
                        "AI analysis is complete, but a pothole report cannot be submitted without a location."
                      );
                    }
                  });
                }

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
              {isUploading
                ? "⏳ Analyzing..."
                : "🤖 Analyze Road"}
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

      <View style={styles.cameraOverlay}>

        <Text style={styles.cameraTitle}>
          RoadGuard
        </Text>

        <Text style={styles.cameraSubtitle}>
          Scan the road for potholes
        </Text>

      </View>

      {/* CAMERA CONTROLS */}

      <View style={styles.controls}>

        {/* GALLERY BUTTON */}

        <TouchableOpacity
          style={styles.galleryButton}
          onPress={pickImage}
        >
          <Text style={styles.galleryText}>
            🖼️ Gallery
          </Text>
        </TouchableOpacity>

        {/* CAMERA CAPTURE BUTTON */}

        <TouchableOpacity
          style={styles.captureButton}
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
        </TouchableOpacity>

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
    top: 60,
    width: "100%",
    alignItems: "center",
  },

  cameraTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
  },

  cameraSubtitle: {
    color: "white",
    fontSize: 15,
    marginTop: 5,
  },

  controls: {
    position: "absolute",
    bottom: 40,
    width: "100%",
    alignItems: "center",
  },

  // =====================================
  // GALLERY BUTTON
  // =====================================

  galleryButton: {
    position: "absolute",
    left: 30,
    bottom: 15,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "white",
  },

  galleryText: {
    color: "black",
    fontSize: 15,
    fontWeight: "bold",
  },

  // =====================================
  // CAMERA BUTTON
  // =====================================

  captureButton: {
    width: 75,
    height: 75,
    borderRadius: 40,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
  },

  innerButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "black",
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
    backgroundColor: "black",
  },

  preview: {
    flex: 1,
    width: "100%",
    resizeMode: "contain",
  },

  previewControls: {
    position: "absolute",
    bottom: 35,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },

  retakeButton: {
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 12,
    backgroundColor: "white",
  },

  retakeText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "black",
  },

  analyzeButton: {
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 12,
    backgroundColor: "#111",
  },

  disabledButton: {
    opacity: 0.6,
  },

  analyzeText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "white",
  },

  // =====================================
  // RESULT SCREEN
  // =====================================

  resultContainer: {
    flex: 1,
    backgroundColor: "#f5f5f5",
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
    height: "55%",
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
    backgroundColor: "#f5f5f5",
  },

  resultScrollContent: {
    padding: 20,
    paddingBottom: 40,
    alignItems: "center",
  },

  resultCard: {
    width: "100%",
    alignItems: "center",
  },

  resultTitle: {
    fontSize: 25,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },

  resultCount: {
    fontSize: 17,
    color: "#555",
    marginBottom: 20,
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
    fontSize: 16,
    textAlign: "center",
    color: "#555",
    marginBottom: 25,
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
    backgroundColor: "white",
    borderRadius: 14,
    padding: 16,
    marginTop: 5,
    marginBottom: 20,
  },

  locationTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#111",
  },

  locationText: {
    fontSize: 14,
    color: "#555",
    marginTop: 6,
  },

  resultButtons: {
    width: "100%",
    alignItems: "center",
    marginTop: 5,
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