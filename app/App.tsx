import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";

function StatusBarForTheme() {
  const { colors } = useTheme();
  // "light"/"dark" here name the STATUS BAR CONTENT color (light text for a dark
  // background), which is the inverse of the app's own light/dark theme naming.
  return <StatusBar style={colors.isDark ? "light" : "dark"} />;
}

export default function App() {
  return (
    // Required by react-native-gesture-handler (History's swipe-to-delete) — every
    // gesture-handler-based component needs to live under this, not just the ones using
    // gestures directly, per the library's own setup docs.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
          <StatusBarForTheme />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
