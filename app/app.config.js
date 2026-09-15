// Converted from app.json to app.config.js so this file can read process.env —
// specifically ANDROID_GOOGLE_MAPS_API_KEY, needed by react-native-maps on Android (the
// job-location map picker; iOS uses Apple Maps by default, no key needed there), and
// EAS_PROJECT_ID, which links builds to a specific EAS project (see app/.env.example for
// both). `expo start`/`expo export` auto-load app/.env before evaluating this file, but
// `eas build`'s own internal project-linking step does not (confirmed the hard way: it
// kept re-prompting "Which account should own this project?" as if EAS_PROJECT_ID were
// never set, even with it correctly present in app/.env) — so this file loads it itself,
// explicitly, rather than depending on whichever tool happens to invoke it.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const LOCATION_USAGE_DESCRIPTION =
  "Clocker uses your location to detect when you arrive at or leave a job site you've set up for location awareness, so it can prompt you to clock in/out or — if you've turned that on — do it automatically, even when the app isn't open.";

module.exports = {
  expo: {
    name: "Clocker",
    slug: "clocker",
    scheme: "clocker",
    version: "2.0.5",
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
      // EAS can't auto-write this into a dynamic app.config.js either (same class of
      // problem as extra.eas.projectId above) — but unlike that value, this one is part
      // of the app's actual identity, not per-deployment config, so it's hardcoded here
      // like slug/scheme above rather than read from the environment. Reverse-DNS,
      // matching the deployed domain. Effectively permanent once first published to the
      // Play Store — fine to change freely before then, so revisit deliberately if this
      // isn't the identifier you want for a real release.
      package: "com.haymondtechnologies.clocker",
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
    // app.json (see docs/deployment.md's EAS setup section) — set EAS_PROJECT_ID in
    // app/.env instead, once, from what `eas build`/`eas build:configure` prints the very
    // first time it finds or creates the project. Every build after that resolves the
    // project from this field alone, no further prompts.
    extra: {
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  },
};
