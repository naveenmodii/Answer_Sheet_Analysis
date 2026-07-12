/**
 * ReviewScreen — Phase 1
 *
 * Displays the captured image and provides two actions:
 *   • Retake — navigates back to CaptureScreen, discarding the current image.
 *   • Upload — sends the image as multipart/form-data to POST /submissions.
 *
 * Upload states: idle → loading → success (shows submission_id) | error (retryable).
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
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export default function ReviewScreen({ route, navigation }: Props) {
  const { imageUri } = route.params;

  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    setUploadState('uploading');
    setErrorMessage(null);

    try {
      // Derive the filename and MIME type from the URI.
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

      const response = await axios.post<{ submission_id: string; status: string }>(
        `${API_BASE_URL}/submissions`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30_000,
        },
      );

      setSubmissionId(response.data.submission_id);
      setUploadState('success');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Unknown error. Check your network connection.';
      setErrorMessage(detail);
      setUploadState('error');
    }
  }, [imageUri]);

  const handleRetake = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* ── Image preview ─────────────────────────────────────────────────── */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="contain"
          accessibilityLabel="Captured answer booklet cover"
        />
      </View>

      {/* ── Bottom action panel ────────────────────────────────────────────── */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Success banner */}
        {uploadState === 'success' && submissionId && (
          <View style={styles.successBanner}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>Upload successful!</Text>
            <Text style={styles.successId} numberOfLines={2} selectable>
              ID: {submissionId}
            </Text>
          </View>
        )}

        {/* Error banner */}
        {uploadState === 'error' && errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Upload failed</Text>
            <Text style={styles.errorDetail}>{errorMessage}</Text>
          </View>
        )}

        {/* Buttons */}
        <View style={styles.buttonRow}>
          {/* Retake */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.retakeButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleRetake}
            disabled={uploadState === 'uploading'}
            accessibilityLabel="Retake photo — discard current image"
          >
            <Text style={styles.retakeButtonText}>↩ Retake</Text>
          </Pressable>

          {/* Upload / Retry */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.uploadButton,
              uploadState === 'uploading' && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleUpload}
            disabled={uploadState === 'uploading'}
            accessibilityLabel={
              uploadState === 'error' ? 'Retry upload' : 'Upload image to server'
            }
          >
            {uploadState === 'uploading' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.uploadButtonText}>
                {uploadState === 'error'
                  ? '↺ Retry Upload'
                  : uploadState === 'success'
                  ? '↑ Upload Again'
                  : '↑ Upload'}
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
  },
  image: {
    width: '100%',
    height: '100%',
  },

  // ── Action panel ───────────────────────────────────────────────────────────
  panel: {
    maxHeight: 280,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  panelContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 16,
  },

  // ── Success banner ─────────────────────────────────────────────────────────
  successBanner: {
    backgroundColor: '#052e16',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  successIcon: { fontSize: 28 },
  successTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4ade80',
  },
  successId: {
    fontSize: 12,
    color: '#86efac',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    textAlign: 'center',
    marginTop: 4,
  },

  // ── Error banner ───────────────────────────────────────────────────────────
  errorBanner: {
    backgroundColor: '#2d0a0a',
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  errorIcon: { fontSize: 28 },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f87171',
  },
  errorDetail: {
    fontSize: 13,
    color: '#fca5a5',
    textAlign: 'center',
    marginTop: 4,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    opacity: 0.6,
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
