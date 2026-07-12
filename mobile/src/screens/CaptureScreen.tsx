/**
 * CaptureScreen — Phase 1
 *
 * Shows a full-screen live camera preview via react-native-vision-camera v5.
 *
 * VisionCamera v5 API (Nitro Modules architecture):
 *   - usePhotoOutput() → creates a CameraPhotoOutput
 *   - outputs={[photoOutput]} prop on <Camera> (replaces photo={true})
 *   - photoOutput.capturePhoto({ flashMode }) → takes the photo
 *   - camera ref does NOT have takePhoto() in v5
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// A4 guide: 60% of screen width, height = width × √2
const GUIDE_W = SCREEN_W * 0.6;
const GUIDE_H = GUIDE_W * 1.414;
const CORNER_SIZE = 20;
const CORNER_THICKNESS = 3;

export default function CaptureScreen({ navigation }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // ── VisionCamera v5: photo output hook (replaces photo={true} prop) ─────────
  const photoOutput = usePhotoOutput({
    qualityPrioritization: 'quality',
  });

  const [capturing, setCapturing] = useState(false);

  // ── Permission request on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Capture handler (v5 API) ───────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (capturing) return;
    try {
      setCapturing(true);

      // v5: capturePhoto() is on photoOutput, not on the camera ref
      const photo = await photoOutput.capturePhoto(
        { flashMode: 'off' },
        {}, // required second arg in VisionCamera v5
      );

      // v5: Photo is in-memory — no .path property.
      // Must call saveToTemporaryFileAsync() to write to disk first.
      // Returns a filesystem path WITHOUT file:// prefix.
      const filePath = await photo.saveToTemporaryFileAsync();
      photo.dispose(); // free native memory; temp file stays on disk

      // Add file:// prefix so RN Image and FormData can read it
      const imageUri = `file://${filePath}`;

      navigation.navigate('Review', { imageUri });
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, photoOutput, navigation]);

  // ── Permission denied ──────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.permissionIcon}>🚫</Text>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          SIPAR needs access to your camera to photograph the answer booklet
          cover. Please grant camera permission in Settings.
        </Text>
        <Pressable
          style={styles.settingsButton}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Open app settings to grant camera permission"
        >
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  // ── No back camera available ───────────────────────────────────────────────
  if (!device) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loadingText}>Initialising camera…</Text>
      </View>
    );
  }

  // ── Camera view ────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Full-screen camera preview — v5: pass outputs array, not photo={true} */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[photoOutput]}
      />

      {/* Dark vignette overlay with transparent cut-out guide */}
      <View style={styles.overlay} pointerEvents="none">
        {/* Top dark band */}
        <View style={styles.overlayTop} />

        {/* Middle row: left dark strip | guide window | right dark strip */}
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />

          {/* Guide rectangle — transparent centre so the preview shows through */}
          <View style={styles.guide} pointerEvents="none">
            {/* Corner accents */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          <View style={styles.overlaySide} />
        </View>

        {/* Bottom dark band */}
        <View style={styles.overlayBottom} />
      </View>

      {/* Hint text */}
      <View style={styles.hintContainer} pointerEvents="none">
        <Text style={styles.hintText}>
          Align the booklet cover within the frame
        </Text>
      </View>

      {/* Shutter button */}
      <View style={styles.shutterContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.shutterOuter,
            pressed && styles.shutterOuterPressed,
          ]}
          onPress={handleCapture}
          disabled={capturing}
          accessibilityLabel="Take photo"
        >
          {capturing ? (
            <ActivityIndicator color="#1a1a2e" size="small" />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const OVERLAY_VERT = (SCREEN_H - GUIDE_H) / 2;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Permission / loading screens ────────────────────────────────────────
  centeredContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  permissionIcon: {
    fontSize: 52,
    marginBottom: 16,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e0e0ff',
    textAlign: 'center',
    marginBottom: 12,
  },
  permissionBody: {
    fontSize: 15,
    color: '#9898bb',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  settingsButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  settingsButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingText: {
    color: '#9898bb',
    marginTop: 16,
    fontSize: 15,
  },

  // ── Overlay vignette ────────────────────────────────────────────────────
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  overlayTop: {
    height: OVERLAY_VERT,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayMiddle: {
    height: GUIDE_H,
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  // ── A4 guide rectangle ──────────────────────────────────────────────────
  guide: {
    width: GUIDE_W,
    height: GUIDE_H,
    borderWidth: 1.5,
    borderColor: 'rgba(200,200,255,0.6)',
    position: 'relative',
  },

  // Corner accents
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#a5b4fc',
  },
  cornerTL: {
    top: -CORNER_THICKNESS / 2,
    left: -CORNER_THICKNESS / 2,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerTR: {
    top: -CORNER_THICKNESS / 2,
    right: -CORNER_THICKNESS / 2,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },
  cornerBL: {
    bottom: -CORNER_THICKNESS / 2,
    left: -CORNER_THICKNESS / 2,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerBR: {
    bottom: -CORNER_THICKNESS / 2,
    right: -CORNER_THICKNESS / 2,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },

  // ── Hint text ───────────────────────────────────────────────────────────
  hintContainer: {
    position: 'absolute',
    top: OVERLAY_VERT - 36,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(200,200,255,0.85)',
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // ── Shutter button ──────────────────────────────────────────────────────
  shutterContainer: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterOuterPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: 'rgba(200,200,255,0.9)',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
  },
});
