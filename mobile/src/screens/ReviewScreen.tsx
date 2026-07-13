/**
 * ReviewScreen — Phase 3
 *
 * Displays the captured image and provides actions:
 *   • Retake — navigates back to CaptureScreen, discarding the current image.
 *   • Process & Upload — uploads to POST /submissions, then automatically
 *     calls POST /submissions/{id}/preprocess to align and clean the cover page.
 *   • Extract Details — triggers POST /submissions/{id}/extract to call the Claude
 *     Vision API, extract student metadata/marks, and displays them.
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
type FlowState =
  | 'idle'
  | 'uploading'
  | 'preprocessing'
  | 'preprocessed'
  | 'extracting'
  | 'extracted'
  | 'error';

type PreprocessingStatus = 'pending' | 'success' | 'fallback';

interface MarksEntry {
  question_no: number;
  part: string;
  marks: number;
}

interface QuestionTotal {
  question_no: number;
  total: number;
}

interface FieldConfidence {
  name: 'high' | 'medium' | 'low';
  roll_no: 'high' | 'medium' | 'low';
}

interface ExtractionResult {
  name: string;
  roll_no: string;
  branch: string;
  subject: string;
  date: string;
  marks_entries: MarksEntry[];
  question_totals: QuestionTotal[];
  total_marks_declared: number | null;
  field_confidence: FieldConfidence;
}

interface SubmissionRecord {
  submission_id: string;
  original_filename: string;
  saved_path: string;
  content_type: string;
  upload_timestamp: string;
  status: string;
  preprocessing_status: PreprocessingStatus;
  preprocessing_debug_reason?: string;
  extraction_status: 'pending' | 'success' | 'failed';
  extraction_result?: ExtractionResult;
  extraction_error?: string;
}

export default function ReviewScreen({ route, navigation }: Props) {
  const { imageUri, roi } = route.params;

  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Status of the booklet cropping/alignment pipeline
  const [prepStatus, setPrepStatus] = useState<PreprocessingStatus>('pending');
  const [prepDebugReason, setPrepDebugReason] = useState<string | null>(null);

  // Status of the Claude OCR extraction step
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);

  // Holds either the local captured image URI or the remote preprocessed URL
  const [displayUri, setDisplayUri] = useState<string>(imageUri);

  // ── Upload & Preprocess Handler (Phase 2) ─────────────────────────────────
  const handleUploadAndPreprocess = useCallback(async () => {
    setFlowState('uploading');
    setErrorMessage(null);
    setPrepStatus('pending');
    setPrepDebugReason(null);
    setExtractionResult(null);
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

      // Append normalized visual guide ROI coordinates
      if (roi) {
        formData.append('roi_x', String(roi.x));
        formData.append('roi_y', String(roi.y));
        formData.append('roi_w', String(roi.w));
        formData.append('roi_h', String(roi.h));
      }

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
      if (prepResponse.data.preprocessing_debug_reason) {
        setPrepDebugReason(prepResponse.data.preprocessing_debug_reason);
      }

      // Force-refresh display image using cache-busting timestamp
      setDisplayUri(`${API_BASE_URL}/submissions/${subId}/preprocessed?t=${Date.now()}`);
      setFlowState('preprocessed');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Preprocessing failed on the server.';
      setErrorMessage(detail);
      setFlowState('error');
    }
  }, [imageUri, roi]);

  // ── Claude Vision Extraction Handler (Phase 3) ─────────────────────────────
  const handleExtractDetails = useCallback(async () => {
    if (!submissionId) return;

    setFlowState('extracting');
    setErrorMessage(null);

    try {
      const extractResponse = await axios.post<SubmissionRecord>(
        `${API_BASE_URL}/submissions/${submissionId}/extract`,
        {},
        { timeout: 45_000 } // Vision calls take longer (typically 4-10s)
      );

      if (extractResponse.data.extraction_status === 'success' && extractResponse.data.extraction_result) {
        setExtractionResult(extractResponse.data.extraction_result);
        setFlowState('extracted');
      } else {
        const errorMsg = extractResponse.data.extraction_error ?? 'Claude failed to extract details.';
        setErrorMessage(errorMsg);
        setFlowState('error');
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Extraction request failed. Check server status.';
      setErrorMessage(detail);
      setFlowState('error');
    }
  }, [submissionId]);

  const handleRetake = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ── Helper: Format Marks Entries ──────────────────────────────────────────
  const getFormattedMarksBreakdown = () => {
    if (!extractionResult || !extractionResult.marks_entries) return 'None';
    return extractionResult.marks_entries
      .map((entry) => `${entry.question_no}${entry.part}-${entry.marks}`)
      .join(', ');
  };

  // ── Render Helpers ─────────────────────────────────────────────────────────
  const isUploadingOrPrep = flowState === 'uploading' || flowState === 'preprocessing';
  const isWorking = isUploadingOrPrep || flowState === 'extracting';

  return (
    <View style={styles.root}>
      {/* ── Image preview (Hidden once details are successfully extracted) ─── */}
      {flowState !== 'extracted' && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: displayUri }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel="Captured booklet preview"
          />

          {/* Preprocessing Spinner Overlay */}
          {flowState === 'preprocessing' && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={styles.processingOverlayText}>
                Aligning and cleaning page…
              </Text>
            </View>
          )}

          {/* Claude Vision Extraction Spinner Overlay */}
          {flowState === 'extracting' && (
            <View style={[styles.processingOverlay, styles.extractionOverlay]}>
              <ActivityIndicator size="large" color="#ec4899" />
              <Text style={[styles.processingOverlayText, styles.extractionOverlayText]}>
                Claude is reading handwriting…
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Bottom action panel & Extracted results scroll container ──────── */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* State: Extracted Results View (Read-Only Display) */}
        {flowState === 'extracted' && extractionResult && (
          <View style={styles.extractedContainer}>
            <View style={styles.extractedHeaderRow}>
              <Text style={styles.successIcon}>✨</Text>
              <Text style={styles.extractedHeaderTitle}>Extracted Details</Text>
            </View>

            {/* Metadata Fields */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Student Info</Text>

              {/* Name Field (with confidence warning indicator) */}
              <View
                style={[
                  styles.fieldRow,
                  extractionResult.field_confidence.name === 'low' && styles.fieldWarningBorder,
                ]}
              >
                <Text style={styles.fieldLabel}>Name:</Text>
                <View style={styles.fieldValueContainer}>
                  <Text style={styles.fieldValue}>{extractionResult.name || 'Not detected'}</Text>
                  {extractionResult.field_confidence.name === 'low' && (
                    <Text style={styles.warningTag}>⚠️ Low Confidence</Text>
                  )}
                </View>
              </View>

              {/* Roll No Field (with confidence warning indicator) */}
              <View
                style={[
                  styles.fieldRow,
                  extractionResult.field_confidence.roll_no === 'low' && styles.fieldWarningBorder,
                ]}
              >
                <Text style={styles.fieldLabel}>Roll No:</Text>
                <View style={styles.fieldValueContainer}>
                  <Text style={styles.fieldValue}>{extractionResult.roll_no || 'Not detected'}</Text>
                  {extractionResult.field_confidence.roll_no === 'low' && (
                    <Text style={styles.warningTag}>⚠️ Low Confidence</Text>
                  )}
                </View>
              </View>

              {/* Branch */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Branch:</Text>
                <Text style={styles.fieldValue}>{extractionResult.branch || 'Not detected'}</Text>
              </View>

              {/* Subject */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Subject:</Text>
                <Text style={styles.fieldValue}>{extractionResult.subject || 'Not detected'}</Text>
              </View>

              {/* Date */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Date:</Text>
                <Text style={styles.fieldValue}>{extractionResult.date || 'Not detected'}</Text>
              </View>
            </View>

            {/* Marks Breakdown */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Sub-Question Marks</Text>
              <Text style={styles.marksBreakdownText}>{getFormattedMarksBreakdown()}</Text>
            </View>

            {/* Question Totals (transcribed totals vs declared) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Examiner Totals</Text>
              {extractionResult.question_totals.length === 0 ? (
                <Text style={styles.emptyText}>No question totals detected.</Text>
              ) : (
                extractionResult.question_totals.map((tot) => (
                  <View key={tot.question_no} style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Question {tot.question_no}:</Text>
                    <Text style={styles.totalValue}>{tot.total} Marks</Text>
                  </View>
                ))
              )}

              <View style={[styles.totalRow, styles.grandTotalRow]}>
                <Text style={styles.grandTotalLabel}>Declared Grand Total:</Text>
                <Text style={styles.grandTotalValue}>
                  {extractionResult.total_marks_declared !== null
                    ? `${extractionResult.total_marks_declared} Marks`
                    : 'Not detected'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* State: Preprocessing Banners (Shown before extraction) */}
        {flowState === 'preprocessed' && (
          <>
            {prepStatus === 'fallback' && (
              <View style={styles.fallbackNotice}>
                <View style={styles.alertHeader}>
                  <Text style={styles.alertIcon}>⚠️</Text>
                  <Text style={styles.fallbackTitle}>Auto-Crop Unsuccessful</Text>
                </View>
                <Text style={styles.fallbackBody}>
                  Booklet edges couldn't be detected (Reason: {prepDebugReason || 'no_contour'}).
                  We are using the original photo.
                </Text>
              </View>
            )}

            {prepStatus === 'success' && (
              <View style={styles.successBanner}>
                <Text style={styles.successIcon}>✨</Text>
                <View style={styles.successTextContainer}>
                  <Text style={styles.successTitle}>Successfully Preprocessed!</Text>
                  <Text style={styles.successSub}>
                    Perspective warp, rotation, and contrast enhanced.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* State: Error Banner */}
        {flowState === 'error' && errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>❌</Text>
            <View style={styles.errorTextContainer}>
              <Text style={styles.errorTitle}>Process Failed</Text>
              <Text style={styles.errorDetail}>{errorMessage}</Text>
            </View>
          </View>
        )}

        {/* Buttons Control Row */}
        <View style={styles.buttonRow}>
          {/* Retake / Cancel (Discard current submission) */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.retakeButton,
              (pressed || isWorking) && styles.buttonPressed,
            ]}
            onPress={handleRetake}
            disabled={isWorking}
          >
            <Text style={styles.retakeButtonText}>
              {flowState === 'extracted' ? 'Done / Scan Next' : '↩ Retake'}
            </Text>
          </Pressable>

          {/* Action trigger: Upload & Crop OR Extract details OR Retry */}
          {flowState === 'idle' || flowState === 'error' || isUploadingOrPrep ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.uploadButton,
                isWorking && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleUploadAndPreprocess}
              disabled={isWorking}
            >
              {isUploadingOrPrep ? (
                <View style={styles.row}>
                  <ActivityIndicator color="#fff" size="small" style={styles.spinner} />
                  <Text style={styles.uploadButtonText}>Processing…</Text>
                </View>
              ) : (
                <Text style={styles.uploadButtonText}>
                  {flowState === 'error' ? '↺ Retry Crop' : 'Process & Upload'}
                </Text>
              )}
            </Pressable>
          ) : (
            // Shown after image is ready on the server: triggers extraction
            flowState !== 'extracted' && (
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.extractButton,
                  flowState === 'extracting' && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleExtractDetails}
                disabled={flowState === 'extracting'}
              >
                {flowState === 'extracting' ? (
                  <View style={styles.row}>
                    <ActivityIndicator color="#fff" size="small" style={styles.spinner} />
                    <Text style={styles.uploadButtonText}>Extracting details…</Text>
                  </View>
                ) : (
                  <Text style={styles.uploadButtonText}>🔍 Extract Details</Text>
                )}
              </Pressable>
            )
          )}
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
    backgroundColor: 'rgba(15, 15, 26, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  extractionOverlay: {
    backgroundColor: 'rgba(15, 15, 26, 0.85)',
  },
  processingOverlayText: {
    color: '#a5b4fc',
    fontSize: 16,
    fontWeight: '600',
  },
  extractionOverlayText: {
    color: '#f472b6',
  },

  // ── Action panel ───────────────────────────────────────────────────────────
  panel: {
    flex: 1,
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

  // ── Extracted Results Layout (Phase 3) ─────────────────────────────────────
  extractedContainer: {
    gap: 16,
  },
  extractedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  extractedHeaderTitle: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#111122',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#818cf8',
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 6,
    marginBottom: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderRadius: 8,
    paddingHorizontal: 6,
  },
  fieldWarningBorder: {
    borderWidth: 1,
    borderColor: '#ea580c',
    backgroundColor: 'rgba(234, 88, 12, 0.08)',
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  fieldValueContainer: {
    alignItems: 'flex-end',
    gap: 2,
  },
  fieldValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  warningTag: {
    color: '#fb923c',
    fontSize: 11,
    fontWeight: '600',
  },
  marksBreakdownText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    lineHeight: 22,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  totalValue: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  grandTotalRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  grandTotalLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  grandTotalValue: {
    color: '#ec4899',
    fontSize: 15,
    fontWeight: '700',
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

  extractButton: {
    backgroundColor: '#ec4899',
  },
});
