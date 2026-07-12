/**
 * ReviewScreen — Phase 2
 *
 * Displays the captured image and provides two actions:
 *   • Retake — navigates back to CaptureScreen, discarding the current image.
 *   • Upload — sends the image as multipart/form-data to POST /submissions.
 *
 * Once uploaded successfully, it AUTOMATICALLY calls the POST /submissions/{id}/preprocess
 * endpoint to trigger OpenCV perspective correction, deskew, and contrast enhancement.
 *
 * It then loads and displays the preprocessed image from the server. If preprocessing
 * fails (fallback), it displays a friendly non-blocking warning notice to the user.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import axios, { AxiosError } from 'axios';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { API_BASE_URL } from '../config';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;
type FlowState = 'idle' | 'uploading' | 'preprocessing' | 'success' | 'error';
type PreprocessingStatus = 'pending' | 'success' | 'fallback';

interface SubmissionRecord {
  submission_id: string;
  original_filename: string;
  saved_path: string;
  content_type: string;
  upload_timestamp: string;
  status: string;
  preprocessing_status: PreprocessingStatus;
}

export default function ReviewScreen({ route, navigation }: Props) {
  const { imageUri } = route.params;

  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Status of the booklet cropping/alignment pipeline
  const [prepStatus, setPrepStatus] = useState<PreprocessingStatus>('pending');

  // Holds either the local captured image URI or the remote preprocessed URL
  const [displayUri, setDisplayUri] = useState<string>(imageUri);

  // ── Upload & Preprocess Handler ───────────────────────────────────────────
  const handleUploadAndPreprocess = useCallback(async () => {
    setFlowState('uploading');
    setErrorMessage(null);
    setPrepStatus('pending');
    setDisplayUri(imageUri);

    let subId = '';

    // ── Step 1: Upload raw image ─────────────────────────────────────────────
    try {
      const uriParts = imageUri.split('.');
      const ext = (uriParts[uriParts.length - 1] ?? 'jpg').toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const filename = `capture.${ext}`;

      const formData = new FormData();
      formData.append('image', {
        uri: Platform.OS === 'android' ? imageUri : imageUri.replace('file://', ''),
        name: filename,
        type: mimeType,
      } as unknown as Blob);

      const uploadResponse = await axios.post<{ submission_id: string; status: string }>(
        `${API_BASE_URL}/submissions`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30_000,
        },
      );

      subId = uploadResponse.data.submission_id;
      setSubmissionId(subId);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Upload failed. Check your connection.';
      setErrorMessage(detail);
      setFlowState('error');
      return;
    }

    // ── Step 2: Trigger Preprocessing on the server ──────────────────────────
    setFlowState('preprocessing');
    try {
      const prepResponse = await axios.post<SubmissionRecord>(
        `${API_BASE_URL}/submissions/${subId}/preprocess`,
        {},
        { timeout: 30_000 }
      );

      const finalStatus = prepResponse.data.preprocessing_status;
      setPrepStatus(finalStatus);

      // Force-refresh display image using cache-busting timestamp
      setDisplayUri(`${API_BASE_URL}/submissions/${subId}/preprocessed?t=${Date.now()}`);
      setFlowState('success');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Preprocessing failed on the server.';
      setErrorMessage(detail);
      setFlowState('error');
    }
  }, [imageUri]);

  const handleRetake = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── Render Helpers ─────────────────────────────────────────────────────────

  const isWorking = flowState === 'uploading' || flowState === 'preprocessing';

  return (
    <View style={styles.root}>
      {/* ── Image preview ─────────────────────────────────────────────────── */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: displayUri }}
          style={styles.image}
          resizeMode="contain"
          accessibilityLabel="Captured booklet preview"
        />

        {/* Semi-transparent processing overlay */}
        {flowState === 'preprocessing' && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color="#a5b4fc" />
            <Text style={styles.processingOverlayText}>
              Aligning and cleaning page…
            </Text>
          </View>
        )}
      </View>

      {/* ── Bottom action panel ────────────────────────────────────────────── */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Fallback crop notice (Non-blocking alert) */}
        {flowState === 'success' && prepStatus === 'fallback' && (
          <View style={styles.fallbackNotice}>
            <View style={styles.alertHeader}>
              <Text style={styles.alertIcon}>⚠️</Text>
              <Text style={styles.fallbackTitle}>Auto-Crop Unsuccessful</Text>
            </View>
            <Text style={styles.fallbackBody}>
              Booklet edges couldn't be detected. We are using the original photo.
              For best results, retake the photo with the booklet fully visible on a dark background.
            </Text>
          </View>
        )}

        {/* Clean crop success banner */}
        {flowState === 'success' && prepStatus === 'success' && (
          <View style={styles.successBanner}>
            <Text style={styles.successIcon}>✨</Text>
            <View style={styles.successTextContainer}>
              <Text style={styles.successTitle}>Successfully Preprocessed!</Text>
              <Text style={styles.successSub}>
                Perspective corrected, deskewed, and contrast-optimized.
              </Text>
            </View>
          </View>
        )}

        {/* Error banner */}
        {flowState === 'error' && errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>❌</Text>
            <View style={styles.errorTextContainer}>
              <Text style={styles.errorTitle}>Process Failed</Text>
              <Text style={styles.errorDetail}>{errorMessage}</Text>
            </View>
          </View>
        )}

        {/* Buttons */}
        <View style={styles.buttonRow}>
          {/* Retake */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.retakeButton,
              (pressed || isWorking) && styles.buttonPressed,
            ]}
            onPress={handleRetake}
            disabled={isWorking}
            accessibilityLabel="Discard photo and retake"
          >
            <Text style={styles.retakeButtonText}>↩ Retake</Text>
          </Pressable>

          {/* Action button: Upload / Processing / Retry */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.uploadButton,
              isWorking && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleUploadAndPreprocess}
            disabled={isWorking}
            accessibilityLabel={
              flowState === 'error' ? 'Retry processing' : 'Process and upload booklet'
            }
          >
            {flowState === 'uploading' ? (
              <View style={styles.row}>
                <ActivityIndicator color="#fff" size="small" style={styles.spinner} />
                <Text style={styles.uploadButtonText}>Uploading…</Text>
              </View>
            ) : flowState === 'preprocessing' ? (
              <View style={styles.row}>
                <ActivityIndicator color="#fff" size="small" style={styles.spinner} />
                <Text style={styles.uploadButtonText}>Processing…</Text>
              </View>
            ) : (
              <Text style={styles.uploadButtonText}>
                {flowState === 'error'
                  ? '↺ Retry Process'
                  : flowState === 'success'
                  ? '↑ Upload Another'
                  : 'Process & Upload'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },

  // ── Image preview ──────────────────────────────────────────────────────────
  imageContainer: {
    flex: 1,
    backgroundColor: '#0f0f1a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 26, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingOverlayText: {
    color: '#a5b4fc',
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Action panel ───────────────────────────────────────────────────────────
  panel: {
    maxHeight: 280,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  panelContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 16,
  },

  // ── Banners ────────────────────────────────────────────────────────────────
  successBanner: {
    backgroundColor: '#064e3b',
    borderWidth: 1,
    borderColor: '#047857',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  successIcon: { fontSize: 24 },
  successTextContainer: { flex: 1 },
  successTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34d399',
  },
  successSub: {
    fontSize: 12,
    color: '#a7f3d0',
    marginTop: 2,
  },

  fallbackNotice: {
    backgroundColor: '#3b250a',
    borderWidth: 1,
    borderColor: '#78350f',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertIcon: { fontSize: 20 },
  fallbackTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fbbf24',
  },
  fallbackBody: {
    fontSize: 12,
    color: '#fde68a',
    lineHeight: 18,
  },

  errorBanner: {
    backgroundColor: '#451a1a',
    borderWidth: 1,
    borderColor: '#991b1b',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorIcon: { fontSize: 24 },
  errorTextContainer: { flex: 1 },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f87171',
  },
  errorDetail: {
    fontSize: 12,
    color: '#fca5a5',
    marginTop: 2,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginRight: 8,
  },

  retakeButton: {
    backgroundColor: '#1e1e3a',
    borderWidth: 1.5,
    borderColor: '#4f46e5',
  },
  retakeButtonText: {
    color: '#a5b4fc',
    fontSize: 15,
    fontWeight: '600',
  },

  uploadButton: {
    backgroundColor: '#4f46e5',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
