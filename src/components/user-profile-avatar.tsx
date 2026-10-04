import { router, useFocusEffect } from "expo-router";
import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { SymbolView } from "expo-symbols";
import { useAuthSession } from "@/hooks/use-auth-session";
import { profilePictureKey } from "@/lib/profile-picture";
import { useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, Text } from "react-native";

type UserProfileAvatarProps = {
  size?: number;
  overCamera?: boolean;
};

export function UserProfileAvatar({
  size = 42,
  overCamera = false,
}: UserProfileAvatarProps) {
  const { user } = useAuthSession();
  const [imageUri, setImageUri] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setImageUri(null);

      const loadPicture = async () => {
        if (!user) return;
        try {
          const uri = await SecureStore.getItemAsync(profilePictureKey(user.id));
          if (!isActive) return;
          if (uri && new File(uri).exists) {
            setImageUri(uri);
          } else if (uri) {
            await SecureStore.deleteItemAsync(profilePictureKey(user.id));
          }
        } catch (error) {
          if (!isActive) return;
          console.warn(
            "Unable to load profile avatar:",
            error instanceof Error ? error.message : "Unknown storage error"
          );
        }
      };

      void loadPicture();
      return () => {
        isActive = false;
      };
    }, [user])
  );

  const initials =
    user?.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Profile"
      onPress={() => router.push("/(app)/(tabs)/profile")}
      style={({ pressed }) => [
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: overCamera ? "rgba(255,255,255,0.9)" : "#FFFFFF",
        },
        overCamera && styles.cameraBorder,
        pressed && styles.pressed,
      ]}
    >
      {imageUri ? (
        <Image
          accessibilityLabel="Profile picture"
          onError={() => setImageUri(null)}
          source={{ uri: imageUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : initials ? (
        <Text style={[styles.initials, { fontSize: size * 0.34 }]}>
          {initials}
        </Text>
      ) : (
        <SymbolView
          name={{ ios: "person.fill", android: "person", web: "person" }}
          size={size * 0.5}
          tintColor="#1B5E3B"
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    backgroundColor: "#E4EEE8",
    elevation: 2,
  },
  cameraBorder: {
    backgroundColor: "#FFFFFF",
  },
  initials: {
    color: "#1B5E3B",
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
});
