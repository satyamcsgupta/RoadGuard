import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import * as Location from "expo-location";
import { useState } from "react";

import {
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

export default function CameraScreen() {
  const [permission, requestPermission] =
    useCameraPermissions();

  const [camera, setCamera] =
    useState<CameraView | null>(null);

  const [photoUri, setPhotoUri] =
    useState<string | null>(null);

  const [isUploading, setIsUploading] =
    useState(false);

  const [result, setResult] =
    useState<AnalysisResult | null>(null);

  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

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

  const getCurrentLocation = async () => {
    console.time("GPS");

    try {
      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Location Access Needed",
          "RoadGuard needs location access to attach the pothole's location to the road report."
        );
        setLocation(null);
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

      setLocation(nextLocation);
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
      setLocation(null);
      return null;
    } finally {
      console.timeEnd("GPS");
    }
  };

  const preparePhoto = async (uri: string) => {
    setPhotoUri(uri);
    setResult(null);
    setLocation(null);
    setImageSize(null);
    loadImageSize(uri);

    void getCurrentLocation();
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
        });

      if (!selected.canceled) {
        const uri = selected.assets[0].uri;

        console.log(
          "🖼️ Image selected:",
          uri
        );

        await preparePhoto(uri);
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

  // =====================================
  // RESULT SCREEN
  // =====================================

  if (result && photoUri) {
    return (
      <View style={styles.resultContainer}>

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

                {(result.location || location) && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>
                      📍 Detection Location
                    </Text>
                    <Text style={styles.locationText}>
                      Latitude: {(
                        result.location?.latitude ?? location?.latitude ?? 0
                      ).toFixed(6)}
                    </Text>
                    <Text style={styles.locationText}>
                      Longitude: {(
                        result.location?.longitude ?? location?.longitude ?? 0
                      ).toFixed(6)}
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
                  No pothole was detected in this image.
                </Text>

                {(result.location || location) && (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationTitle}>
                      📍 Detection Location
                    </Text>
                    <Text style={styles.locationText}>
                      Latitude: {(
                        result.location?.latitude ?? location?.latitude ?? 0
                      ).toFixed(6)}
                    </Text>
                    <Text style={styles.locationText}>
                      Longitude: {(
                        result.location?.longitude ?? location?.longitude ?? 0
                      ).toFixed(6)}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.resultButtons}>
              {/* SCAN WITH CAMERA */}

              <TouchableOpacity
                style={styles.scanAgainButton}
                onPress={() => {
                  setResult(null);
                  setPhotoUri(null);
                  setLocation(null);
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
                  setPhotoUri(null);
                  setLocation(null);
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
              setPhotoUri(null);
              setLocation(null);
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

              try {

                console.log(
                  "🔥 ANALYZE BUTTON PRESSED"
                );

                setIsUploading(true);

                console.time("AI_UPLOAD");

                const currentLocation =
                  location ??
                  (await getCurrentLocation());

                console.log(
                  "📁 Creating File object..."
                );

                const file =
                  new File(photoUri);

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

                if (currentLocation) {
                  formData.append(
                    "latitude",
                    String(currentLocation.latitude)
                  );

                  formData.append(
                    "longitude",
                    String(currentLocation.longitude)
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

                await preparePhoto(photo.uri);
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