/**
 * CaptureScreen — Sets Architecture
 *
 * Shows a full-screen live camera preview via react-native-vision-camera v5.
 * Captures booklet cover images and navigates to ReviewScreen.
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
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
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

// ── Design tokens ─────────────────────────────────────────────────────────────
const ACCENT       = '#5f5af6';
const ACCENT_LIGHT = '#a5a0ff';
const MUTED        = '#4a4a5a';
const TEXT_BODY    = '#d0d0e0';

export default function CaptureScreen({ route, navigation }: Props) {
  const { setId } = route.params;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const photoOutput = usePhotoOutput({ qualityPrioritization: 'quality' });

  const [capturing, setCapturing] = useState(false);
  const [setName, setSetName] = useState('Active Set');
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Enforce selected Set presence and fetch name/count on focus
  useFocusEffect(
    useCallback(() => {
      if (!setId) {
        Alert.alert(
          'No Set Selected',
          'Please select or create a scanning set from the dashboard before scanning booklet covers.',
          [{ text: 'OK', onPress: () => navigation.popToTop() }]
        );
        return;
      }

      let isActive = true;
      const fetchSetStatus = async () => {
        try {
          setLoading(true);
          const response = await axios.get<{ name: string; confirmed_count: number }>(
            `${API_BASE_URL}/submissions/sets/${setId}/status`
          );
          if (isActive) {
            setSetName(response.data.name);
            setConfirmedCount(response.data.confirmed_count);
          }
        } catch (err) {
          console.warn('Failed to query set status details:', err);
          if (isActive) {
            Alert.alert(
              'Set Not Found',
              'The selected scanning set could not be verified on the server.',
              [{ text: 'Return to Dashboard', onPress: () => navigation.popToTop() }]
            );
          }
        } finally {
          if (isActive) setLoading(false);
        }
      };

      fetchSetStatus();
      return () => { isActive = false; };
    }, [setId, navigation])
  );

  // ── Capture handler (v5 API) ──────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (capturing) return;
    try {
      setCapturing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      const photo = await photoOutput.capturePhoto(
        { flashMode: 'off', enableShutterSound: false },
        {}
      );

      const photoWidth = photo.width;
      const photoHeight = photo.height;
      const filePath = await photo.saveToTemporaryFileAsync();
      photo.dispose();

      const actualWidth = photoWidth > photoHeight ? photoHeight : photoWidth;
      const actualHeight = photoWidth > photoHeight ? photoWidth : photoHeight;

      const previewWidth = SCREEN_W;
      const previewHeight = SCREEN_H;

      console.log(`[ASA FOV Debug] Screen: ${previewWidth}x${previewHeight}, Sensor: ${photoWidth}x${photoHeight}`);

      const scale = Math.max(previewWidth / actualWidth, previewHeight / actualHeight);
      const renderedWidth = actualWidth * scale;
      const renderedHeight = actualHeight * scale;
      const offsetX = (renderedWidth - previewWidth) / 2;
      const offsetY = (renderedHeight - previewHeight) / 2;

      const guide_screen_x = (previewWidth - GUIDE_W) / 2;
      const guide_screen_y = (previewHeight - GUIDE_H) / 2;

      const photo_x = (guide_screen_x + offsetX) / scale;
      const photo_y = (guide_screen_y + offsetY) / scale;
      const photo_w = GUIDE_W / scale;
      const photo_h = GUIDE_H / scale;

      const margin_x = photo_w * 0.05;
      const margin_y = photo_h * 0.05;

      const originX = Math.max(0, Math.min(actualWidth - 1, Math.floor(photo_x - margin_x)));
      const originY = Math.max(0, Math.min(actualHeight - 1, Math.floor(photo_y - margin_y)));
      const width = Math.max(1, Math.min(actualWidth - originX, Math.floor(photo_w + 2 * margin_x)));
      const height = Math.max(1, Math.min(actualHeight - originY, Math.floor(photo_h + 2 * margin_y)));

      const cropResult = await ImageManipulator.manipulateAsync(
        filePath,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      navigation.navigate('Review', { imageUri: cropResult.uri, setId });
    } catch (err) {
      console.error('Capture failed:', err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, photoOutput, navigation, setId]);

  // ── Permission denied ────────────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centeredContainer}>
        <Feather name="camera-off" size={48} color={MUTED} style={{ marginBottom: 20 }} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          This app needs camera access to photograph answer booklet covers.
          Please grant permission in Settings.
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

  if (!device || loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Initialising scan set…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[photoOutput]}
      />

      {/* Top Session Navigation Header */}
      <View style={styles.topHeader}>
        <Pressable
          style={({ pressed }) => [styles.headerBackBtn, pressed && styles.buttonPressed]}
          onPress={() => navigation.popToTop()}
          accessibilityLabel="Back to Dashboard sets"
        >
          <Feather name="arrow-left" size={14} color={ACCENT_LIGHT} />
          <Text style={styles.headerBackText}>Dashboard</Text>
        </Pressable>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{setName}</Text>
          <Text style={styles.headerSub}>
            {confirmedCount === 0 ? '0 rows' : `${confirmedCount} row${confirmedCount === 1 ? '' : 's'} saved`}
          </Text>
        </View>

        {/* Empty placeholder to balance the header layout */}
        <View style={{ width: 80 }} />
      </View>

      {/* Dark vignette overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.guide} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom} />
      </View>

      {/* Hint text */}
      <View style={styles.hintContainer} pointerEvents="none">
        <Text style={styles.hintText}>Align the booklet cover within the frame</Text>
      </View>

      {/* Shutter button */}
      <View style={styles.shutterContainer}>
        <Pressable
          style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterOuterPressed]}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const OVERLAY_VERT = (SCREEN_H - GUIDE_H) / 2;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  centeredContainer: {
    flex: 1,
    backgroundColor: '#0b0b0e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e8e8f0',
    textAlign: 'center',
    marginBottom: 10,
  },
  permissionBody: {
    fontSize: 14,
    color: TEXT_BODY,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  settingsButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  settingsButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  loadingText: { color: TEXT_BODY, marginTop: 16, fontSize: 14 },

  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },
  overlayTop: { height: OVERLAY_VERT, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayMiddle: { height: GUIDE_H, flexDirection: 'row' },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },

  guide: {
    width: GUIDE_W,
    height: GUIDE_H,
    borderWidth: 1.5,
    borderColor: 'rgba(200,200,255,0.6)',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#a5b4fc',
  },
  cornerTL: { top: -CORNER_THICKNESS / 2, left: -CORNER_THICKNESS / 2, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerTR: { top: -CORNER_THICKNESS / 2, right: -CORNER_THICKNESS / 2, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  cornerBL: { bottom: -CORNER_THICKNESS / 2, left: -CORNER_THICKNESS / 2, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerBR: { bottom: -CORNER_THICKNESS / 2, right: -CORNER_THICKNESS / 2, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },

  hintContainer: { position: 'absolute', top: OVERLAY_VERT - 36, left: 0, right: 0, alignItems: 'center' },
  hintText: { color: 'rgba(200,200,255,0.85)', fontSize: 13, letterSpacing: 0.3 },

  shutterContainer: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
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
  shutterOuterPressed: { transform: [{ scale: 0.94 }], backgroundColor: 'rgba(200,200,255,0.9)' },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff' },

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(11,11,14,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    width: 100,
  },
  headerBackText: { color: ACCENT_LIGHT, fontSize: 12, fontWeight: '600' },
  headerTitleWrap: { alignItems: 'center', flex: 1 },
  headerTitle: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.5, maxWidth: 160, textAlign: 'center' },
  headerSub: { color: 'rgba(200,200,255,0.6)', fontSize: 11, fontWeight: '500', marginTop: 2 },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.96 }] },
});
