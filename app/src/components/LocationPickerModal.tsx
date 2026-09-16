import Constants from "expo-constants";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentLocation } from "../lib/locationTracking";
import { useTheme, type ThemeColors } from "../theme/ThemeContext";

interface Coords {
  latitude: number;
  longitude: number;
}

// Roughly a 1km-wide view — close enough to tell one building/site from the next without
// having to pinch-zoom before you can place the pin accurately.
const DEFAULT_DELTA = 0.01;

// react-native-maps' native Android view crashes the whole app if no Google Maps API key
// was baked into the build (no JS-catchable error — confirmed on a real device; the
// library exposes onMapReady/onMapLoaded but nothing for an auth/key failure). iOS uses
// Apple Maps for free, so this only ever applies on Android. Checking the config value
// that was actually baked in at build time (see app/app.config.js) lets this render a
// normal error message instead of ever mounting the native map at all. This can't detect
// a key that's present but invalid/wrongly-restricted — only a genuinely missing one —
// since that failure only shows up once Google's servers reject the native SDK's request.
const MAPS_UNAVAILABLE =
  Platform.OS === "android" && !Constants.expoConfig?.android?.config?.googleMaps?.apiKey;

// A full-screen map for dropping a pin anywhere (not just where you're standing — see
// JobDetailModal's "Use My Current Location" button for that simpler path), plus a
// text-address search that resolves to coordinates without needing to find the spot on
// the map by hand. Just picks a point; the radius is chosen separately by JobDetailModal
// after this closes, same as it is for the current-location path, so all three end at the
// same place.
export function LocationPickerModal({
  initialCoords,
  onConfirm,
  onCancel,
}: {
  initialCoords: Coords | null;
  onConfirm: (coords: Coords) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [region, setRegion] = useState<Region | null>(
    initialCoords ? { ...initialCoords, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA } : null,
  );
  const [coords, setCoords] = useState<Coords | null>(initialCoords);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  // No initial coordinates (a job with no location yet) — center the map on wherever you
  // currently are, a reasonable starting point for most jobs, rather than an arbitrary
  // default like (0, 0). Skipped when the map itself can't render — no point locating
  // just to center a view nobody will see.
  useEffect(() => {
    if (region || MAPS_UNAVAILABLE) return;
    getCurrentLocation().then((current) => {
      const start = current ?? { latitude: 0, longitude: 0 };
      setRegion({ ...start, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
      setCoords(start);
    });
  }, [region]);

  function handlePress(e: MapPressEvent) {
    setCoords(e.nativeEvent.coordinate);
  }

  // Uses the device's own geocoder (Android: the OS's built-in Geocoder class; iOS: Apple's
  // equivalent) — independent of the Google Maps API key MAPS_UNAVAILABLE checks above, so
  // this still works as a real way to set a location even on a build with no Maps key
  // configured, just without a map to visually confirm the pin on afterward. Android's
  // Geocoder oddly requires location permission for this even though it's a plain address
  // lookup, not asking where the device itself is — requested here, same pattern as
  // getCurrentLocation(), rather than letting geocodeAsync throw an opaque error.
  async function searchAddress() {
    const query = addressQuery.trim();
    if (!query) return;
    setAddressSearching(true);
    setAddressError(null);
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      if (existing.status !== "granted") {
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          setAddressError("Address search needs location permission — grant it in your phone's Settings, or drop a pin directly instead.");
          return;
        }
      }
      const results = await Location.geocodeAsync(query);
      if (results.length === 0) {
        setAddressError("No matches for that address. Try being more specific, or drop a pin directly.");
        return;
      }
      const { latitude, longitude } = results[0];
      const found = { latitude, longitude };
      setCoords(found);
      // Imperative animateToRegion rather than a controlled `region` prop — a controlled
      // region would fight the user's own free panning/zooming on every render instead of
      // just re-centering once, here, when a search actually resolves.
      if (!MAPS_UNAVAILABLE) {
        setRegion({ ...found, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
        mapRef.current?.animateToRegion({ ...found, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA }, 400);
      }
    } catch {
      setAddressError("Couldn't search for an address right now — check your connection and try again.");
    } finally {
      setAddressSearching(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Choose Location</Text>
          <TouchableOpacity onPress={() => coords && onConfirm(coords)} disabled={!coords}>
            <Text style={[styles.confirmText, !coords && styles.confirmTextDisabled]}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for an address"
            placeholderTextColor={colors.textMuted2}
            value={addressQuery}
            onChangeText={setAddressQuery}
            onSubmitEditing={searchAddress}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchButton} onPress={searchAddress} disabled={addressSearching || !addressQuery.trim()}>
            {addressSearching ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.searchButtonText}>Search</Text>}
          </TouchableOpacity>
        </View>
        {addressError && <Text style={styles.addressError}>{addressError}</Text>}

        {MAPS_UNAVAILABLE ? (
          <View style={styles.unavailable}>
            <Text style={styles.unavailableTitle}>Map picker unavailable</Text>
            <Text style={styles.unavailableBody}>
              This build isn't configured with a Google Maps key, so the map itself can't be shown. Search for an
              address above to set an exact location anyway, use "Use My Current Location" instead, or contact
              whoever manages this deployment.
            </Text>
            {coords && (
              <Text style={styles.unavailableCoords}>
                Selected: {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
              </Text>
            )}
          </View>
        ) : region ? (
          <MapView ref={mapRef} style={styles.map} initialRegion={region} onPress={handlePress}>
            {coords && <Marker coordinate={coords} draggable onDragEnd={(e) => setCoords(e.nativeEvent.coordinate)} />}
          </MapView>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {!MAPS_UNAVAILABLE && <Text style={styles.hint}>Tap the map, or drag the pin, to set this job's location.</Text>}
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 16, fontWeight: "700", color: colors.text },
    cancelText: { color: colors.textSecondary, fontSize: 15 },
    confirmText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
    confirmTextDisabled: { color: colors.textMuted },
    searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 },
    searchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      padding: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.card,
    },
    searchButton: { backgroundColor: colors.primaryFill, borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
    searchButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
    addressError: { color: colors.danger, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
    map: { flex: 1 },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
    unavailableTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    unavailableBody: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
    unavailableCoords: { fontSize: 13, color: colors.text, fontWeight: "600", marginTop: 8 },
    hint: { textAlign: "center", color: colors.textMuted2, fontSize: 12, padding: 10 },
  });
}
