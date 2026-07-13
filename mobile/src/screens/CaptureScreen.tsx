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
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../config';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import axios from 'axios';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// A4 guide: 85% of screen width, height = width × √2
const GUIDE_W = SCREEN_W * 0.85;
const GUIDE_H = GUIDE_W * 1.414;
const CORNER_SIZE = 20;
const CORNER_THICKNESS = 3;

export default function CaptureScreen({ route, navigation }: Props) {
  const { sessionId } = route.params;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // ── VisionCamera v5: photo output hook (replaces photo={true} prop) ─────────
  const photoOutput = usePhotoOutput({
    qualityPrioritization: 'quality',
  });

  const [capturing, setCapturing] = useState(false);

  // ── Phase 7 Session Tracking States ────────────────────────────────────────
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [sessionNameText, setSessionNameText] = useState('');
  const [compiling, setCompiling] = useState(false);

  // ── Permission request on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync booklet count from server when screen gains focus ─────────────────
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const fetchCount = async () => {
        try {
          const response = await axios.get<{ confirmed_count: number }>(
            `${API_BASE_URL}/submissions/sessions/${sessionId}/submissions/count`
          );
          if (isActive) {
            setConfirmedCount(response.data.confirmed_count);
          }
        } catch (err) {
          console.warn('Failed to query session submissions count:', err);
        }
      };
      fetchCount();
      return () => {
        isActive = false;
      };
    }, [sessionId])
  );

  const handleFinishSession = () => {
    if (confirmedCount === 0) {
      // Teacher backed out without scanning any booklets. Do not create an empty session.
      Alert.alert(
        'Empty Session',
        'No student booklets were confirmed in this session. Return to Dashboard?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, Exit', onPress: () => navigation.popToTop() },
        ]
      );
      return;
    }

    // Pre-fill default name: "Exam Batch - YYYY-MM-DD HH:MM"
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0] ?? '';
    const timeStr = now.toTimeString().split(' ')[0]?.substring(0, 5) ?? '';
    setSessionNameText(`Scan Session ${dateStr} ${timeStr}`);
    setFinishModalVisible(true);
  };

  const handleConfirmFinish = async () => {
    if (!sessionNameText.trim()) return;

    try {
      setCompiling(true);
      setFinishModalVisible(false);

      // 1. Trigger POST compile on server
      const localFilePath = `${FileSystem.documentDirectory}session_${sessionId}.xlsx`;
      const downloadResult = await FileSystem.downloadAsync(
        `${API_BASE_URL}/submissions/sessions/${sessionId}/compile`,
        localFilePath
      );

      if (downloadResult.status !== 200) {
        throw new Error('Server compile returned status ' + downloadResult.status);
      }

      // 2. Read existing sessions.json library
      const sessionsFileUri = `${FileSystem.documentDirectory}sessions.json`;
      let sessionLibrary = [];
      const info = await FileSystem.getInfoAsync(sessionsFileUri);
      if (info.exists) {
        const content = await FileSystem.readAsStringAsync(sessionsFileUri);
        sessionLibrary = JSON.parse(content);
      }

      // 3. Append new session metadata
      const newSessionMetadata = {
        sessionId,
        name: sessionNameText.trim(),
        createdAt: new Date().toISOString(),
        rowCount: confirmedCount,
        localFilePath: localFilePath,
      };
      sessionLibrary.push(newSessionMetadata);

      // 4. Save back metadata library
      await FileSystem.writeAsStringAsync(sessionsFileUri, JSON.stringify(sessionLibrary));

      // 5. Navigate back to Dashboard home
      navigation.popToTop();
    } catch (err) {
      console.error('Session export compilation failed:', err);
      Alert.alert(
        'Compilation Failed',
        'Failed to compile or download session Excel spreadsheet. Please make sure your server is running.'
      );
    } finally {
      setCompiling(false);
    }
  };

  // ── Capture handler (v5 API) ───────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (capturing) return;
    try {
      setCapturing(true);

      // Trigger tactile haptic confirmation immediately on press
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      // v5: capturePhoto() is on photoOutput, not on the camera ref
      // Set enableShutterSound: false to disable default camera shutter noise
      const photo = await photoOutput.capturePhoto(
        { flashMode: 'off', enableShutterSound: false },
        {}, // required second arg in VisionCamera v5
      );

      // Width and height of the captured photo in pixels
      const photoWidth = photo.width;
      const photoHeight = photo.height;

      // v5: Photo is in-memory — no .path property.
      // Must call saveToTemporaryFileAsync() to write to disk first.
      // Returns a filesystem path WITHOUT file:// prefix.
      const filePath = await photo.saveToTemporaryFileAsync();
      photo.dispose(); // free native memory; temp file stays on disk

      // Determine the actual orientation loaded by ImageManipulator.
      // If the photo is landscape (width > height), it will be auto-transposed to portrait on load.
      const actualWidth = photoWidth > photoHeight ? photoHeight : photoWidth;
      const actualHeight = photoWidth > photoHeight ? photoWidth : photoHeight;

      // ── Field of View (FOV) Offset Mapping ──────────────────────────────────
      // The camera preview renders full-screen with style StyleSheet.absoluteFill,
      // which defaults to resizeMode="cover". This means the preview centers and
      // crops the raw sensor image along the axis that is too long relative to the
      // screen's aspect ratio.
      //
      // Because capturePhoto() returns the uncropped, full-sensor field of view,
      // mapping screen-percentages directly to the photo yields incorrect crop coordinates.
      // We must calculate the scale and offset factor to map visual bounds to sensor coordinates.
      const previewWidth = SCREEN_W;
      const previewHeight = SCREEN_H;

      // Log preview vs photo metadata to verify aspect ratio mismatch
      console.log(`[SIPAR FOV Debug] Screen Preview size: ${previewWidth}x${previewHeight} (Aspect: ${(previewWidth/previewHeight).toFixed(3)})`);
      console.log(`[SIPAR FOV Debug] Camera Preview resizeMode: cover (default)`);
      console.log(`[SIPAR FOV Debug] Sensor Photo raw size: ${photoWidth}x${photoHeight}`);
      console.log(`[SIPAR FOV Debug] Transposed Photo size: ${actualWidth}x${actualHeight} (Aspect: ${(actualWidth/actualHeight).toFixed(3)})`);

      // Fit photo aspect ratio to preview aspect ratio using "cover" scale factor
      const scale = Math.max(previewWidth / actualWidth, previewHeight / actualHeight);
      const renderedWidth = actualWidth * scale;
      const renderedHeight = actualHeight * scale;

      // Offset of the screen layout container relative to the centered rendered photo bounds
      const offsetX = (renderedWidth - previewWidth) / 2;
      const offsetY = (renderedHeight - previewHeight) / 2;

      console.log(`[SIPAR FOV Debug] Scale factor: ${scale.toFixed(4)}, Offsets: X=${offsetX.toFixed(1)}, Y=${offsetY.toFixed(1)}`);

      // Screen guide top-left coordinates in layout pixels
      const guide_screen_x = (previewWidth - GUIDE_W) / 2;
      const guide_screen_y = (previewHeight - GUIDE_H) / 2;

      // Translate screen coordinates to original transposed photo pixels
      const photo_x = (guide_screen_x + offsetX) / scale;
      const photo_y = (guide_screen_y + offsetY) / scale;
      const photo_w = GUIDE_W / scale;
      const photo_h = GUIDE_H / scale;

      // Apply a minimal 5% padding margin (just enough to prevent clipping if slightly misaligned)
      const margin_x = photo_w * 0.05;
      const margin_y = photo_h * 0.05;

      // Calculate pixel integer coordinates and clamp them strictly to ensure
      // they never exceed actual bounds (preventing renderAsync crashes)
      const originX = Math.max(0, Math.min(actualWidth - 1, Math.floor(photo_x - margin_x)));
      const originY = Math.max(0, Math.min(actualHeight - 1, Math.floor(photo_y - margin_y)));
      const width = Math.max(1, Math.min(actualWidth - originX, Math.floor(photo_w + 2 * margin_x)));
      const height = Math.max(1, Math.min(actualHeight - originY, Math.floor(photo_h + 2 * margin_y)));

      console.log(`[SIPAR FOV Debug] Calculated Crop Bounds: originX=${originX}, originY=${originY}, width=${width}, height=${height}`);

      // Crop the image to guide box + margin bounds
      const cropResult = await ImageManipulator.manipulateAsync(
        filePath,
        [
          {
            crop: {
              originX,
              originY,
              width,
              height,
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Navigate to Review with the pre-cropped local file URI and active session ID
      navigation.navigate('Review', { imageUri: cropResult.uri, sessionId });
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, photoOutput, navigation, sessionId]);

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

      {/* Top Session Navigation Header */}
      <View style={styles.topHeader}>
        <Pressable
          style={({ pressed }) => [
            styles.headerBackBtn,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => {
            if (confirmedCount > 0) {
              Alert.alert(
                'Exit Scan Session',
                'You have scanned booklets in this active batch. Exit and discard them?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Exit & Discard', style: 'destructive', onPress: () => navigation.popToTop() }
                ]
              );
            } else {
              navigation.popToTop();
            }
          }}
          accessibilityLabel="Back to Dashboard library"
        >
          <Text style={styles.headerBackText}>↩ Dashboard</Text>
        </Pressable>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Active scan</Text>
          <Text style={styles.headerSub}>
            {confirmedCount === 0 ? '0 booklets' : `${confirmedCount} booklet${confirmedCount === 1 ? '' : 's'} saved`}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.headerFinishBtn,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleFinishSession}
          accessibilityLabel="Finish active scanning batch"
        >
          <Text style={styles.headerFinishText}>Finish</Text>
        </Pressable>
      </View>

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
          disabled={capturing || compiling}
          accessibilityLabel="Take photo"
        >
          {capturing ? (
            <ActivityIndicator color="#1a1a2e" size="small" />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
      </View>

      {/* Naming Popup Modal */}
      <Modal
        visible={finishModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFinishModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Name Scan Batch</Text>
            <Text style={styles.modalDesc}>
              Assign a name to this scanned batch before compiling the consolidated Excel marks sheet.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={sessionNameText}
              onChangeText={setSessionNameText}
              placeholder="e.g. Maths Test Section A"
              placeholderTextColor="#64748b"
              maxLength={40}
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setFinishModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={handleConfirmFinish}
              >
                <Text style={styles.modalSaveText}>Compile & Finish</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Compilation Spinner Overlay */}
      {compiling && (
        <View style={styles.compilingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.compilingText}>Compiling Excel spreadsheet…</Text>
        </View>
      )}
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

  // ── Phase 7 Session UI Styles ──────────────────────────────────────────────
  topHeader: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  headerBackBtn: {
    backgroundColor: 'rgba(30, 30, 58, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  headerBackText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#818cf8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  headerFinishBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  headerFinishText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },

  /* Modals */
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#1e1e38',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
  },
  modalDesc: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  modalInput: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalCancelText: {
    color: '#cbd5e1',
    fontWeight: '600',
  },
  modalSaveBtn: {
    backgroundColor: '#6366f1',
  },
  modalSaveText: {
    color: '#fff',
    fontWeight: '700',
  },

  /* Compiling spinner overlay */
  compilingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 26, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  compilingText: {
    color: '#a5b4fc',
    fontSize: 16,
    fontWeight: '600',
  },
});
