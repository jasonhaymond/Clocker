import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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

// A full-screen map for dropping a pin anywhere (not just where you're standing — see
// JobDetailModal's "Use My Current Location" button for that simpler path). Just picks a
// point; the radius is chosen separately by JobDetailModal after this closes, same as it
// is for the current-location path, so both end at the same place.
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

  // No initial coordinates (a job with no location yet) — center the map on wherever you
  // currently are, a reasonable starting point for most jobs, rather than an arbitrary
  // default like (0, 0).
  useEffect(() => {
    if (region) return;
    getCurrentLocation().then((current) => {
      const start = current ?? { latitude: 0, longitude: 0 };
      setRegion({ ...start, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA });
      setCoords(start);
    });
  }, [region]);

  function handlePress(e: MapPressEvent) {
    setCoords(e.nativeEvent.coordinate);
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
        {region ? (
          <MapView style={styles.map} initialRegion={region} onPress={handlePress}>
            {coords && <Marker coordinate={coords} draggable onDragEnd={(e) => setCoords(e.nativeEvent.coordinate)} />}
          </MapView>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        <Text style={styles.hint}>Tap the map, or drag the pin, to set this job's location.</Text>
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
    map: { flex: 1 },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    hint: { textAlign: "center", color: colors.textMuted2, fontSize: 12, padding: 10 },
  });
}
