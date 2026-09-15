// Converted from app.json to app.config.js so this file can read process.env —
// specifically ANDROID_GOOGLE_MAPS_API_KEY, needed by react-native-maps on Android (the
// job-location map picker; iOS uses Apple Maps by default, no key needed there). Expo
// loads app/.env automatically for both `npx expo start` and EAS builds (see
// app/.env.example) — no extra config needed to get the key into process.env here.
const LOCATION_USAGE_DESCRIPTION =
  "Clocker uses your location to detect when you arrive at or leave a job site you've set up for location awareness, so it can prompt you to clock in/out or — if you've turned that on — do it automatically, even when the app isn't open.";

module.exports = {
  expo: {
    name: "Clocker",
    slug: "clocker",
    scheme: "clocker",
    version: "2.0.2",
    runtimeVersion: {
      policy: "appVersion",
    },
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: LOCATION_USAGE_DESCRIPTION,
        NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_USAGE_DESCRIPTION,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION"],
      config: {
        googleMaps: {
          apiKey: process.env.ANDROID_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    plugins: [
      "expo-mail-composer",
      "@react-native-community/datetimepicker",
      [
        "react-native-notify-kit",
        {
          android: {
            foregroundService: {
              types: ["dataSync"],
            },
          },
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: LOCATION_USAGE_DESCRIPTION,
          locationWhenInUsePermission: LOCATION_USAGE_DESCRIPTION,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      // Android-only feature for now (see app/src/lib/appLock.ts) — the plugin itself
      // auto-adds the Android USE_BIOMETRIC/USE_FINGERPRINT manifest permissions, no
      // manual entry needed in android.permissions above.
      "expo-local-authentication",
      // Community-maintained, not an Expo-org package (worth knowing if it ever needs
      // upgrading/replacing) — see app/src/lib/quickActions.ts.
      "expo-quick-actions",
    ],
    // EAS can't auto-write this into a dynamic app.config.js the way it does for a plain
    // app.json (see docs/deployment.md's EAS setup section) — added by hand, once, from
    // what `eas build`/`eas build:configure` printed when it found the existing
    // jasonhaymond-team/clocker project. Every build after this one resolves the project
    // from this field alone, no further prompts.
    extra: {
      eas: {
        projectId: "8dc29a84-7b7c-4b3d-ba07-a933ef274fdf",
      },
    },
  },
};
