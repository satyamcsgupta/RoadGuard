  import { StyleSheet, Text, View, Pressable } from "react-native";
  import { router } from "expo-router";

  export default function HomeScreen() {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>🚧 RoadGuard</Text>

        <Text style={styles.title}>
          AI-Powered Road Monitoring
        </Text>

        <Text style={styles.subtitle}>
          Detect potholes and report road conditions easily.
        </Text>

      <Pressable
    style={styles.button}
    onPress={() => router.push("/camera")}
  >
    <Text style={styles.buttonText}>📷 Scan Road</Text>
  </Pressable>

        <Text style={styles.info}>
          AI detection • GPS location • Road reports
        </Text>
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 25,
      backgroundColor: "#ffffff",
    },

    logo: {
      fontSize: 30,
      fontWeight: "bold",
      marginBottom: 20,
    },

    title: {
      fontSize: 24,
      fontWeight: "bold",
      textAlign: "center",
      marginBottom: 12,
    },

    subtitle: {
      fontSize: 16,
      textAlign: "center",
      color: "#666",
      marginBottom: 35,
    },

    button: {
      paddingVertical: 16,
      paddingHorizontal: 40,
      borderRadius: 12,
      backgroundColor: "#111",
    },

    buttonText: {
      color: "#fff",
      fontSize: 18,
      fontWeight: "bold",
    },

    info: {
      marginTop: 30,
      color: "#888",
      textAlign: "center",
    },
  });