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
  TextInput,
  Alert,
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

interface QuestionValidation {
  question_no: number;
  computed_sum: number;
  declared_total: number;
  match: boolean;
}

interface GrandTotalValidation {
  computed_sum: number;
  declared_total: number;
  match: boolean;
}

interface ValidationResult {
  overall_status: 'valid' | 'mismatch' | 'incomplete';
  question_level: QuestionValidation[];
  grand_total: GrandTotalValidation;
  issues: string[];
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
  validation_status: 'pending' | 'success' | 'failed';
  validation_result?: ValidationResult;
}

export default function ReviewScreen({ route, navigation }: Props) {
  const { imageUri, sessionId } = route.params;

  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Status of the booklet cropping/alignment pipeline
  const [prepStatus, setPrepStatus] = useState<PreprocessingStatus>('pending');
  const [prepDebugReason, setPrepDebugReason] = useState<string | null>(null);

  // Status of the Claude OCR extraction step
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);

  // Status of the arithmetic validation check
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Holds either the local captured image URI or the remote preprocessed URL
  const [displayUri, setDisplayUri] = useState<string>(imageUri);

  // ── Phase 5: Local Form State Hooks ───────────────────────────────────────
  const [formName, setFormName] = useState('');
  const [formRollNo, setFormRollNo] = useState('');
  const [formBranch, setFormBranch] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formMarksEntries, setFormMarksEntries] = useState<MarksEntry[]>([]);
  const [formQuestionTotals, setFormQuestionTotals] = useState<QuestionTotal[]>([]);
  const [formGrandTotal, setFormGrandTotal] = useState('');

  // ── Upload & Preprocess Handler (Phase 2) ─────────────────────────────────
  const handleUploadAndPreprocess = useCallback(async () => {
    setFlowState('uploading');
    setErrorMessage(null);
    setPrepStatus('pending');
    setPrepDebugReason(null);
    setExtractionResult(null);
    setValidationResult(null);
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
      formData.append('session_id', sessionId); // Send Phase 7 active session association!

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
      setFlowState('preprocessing');

      // ── Step 2: Trigger Preprocess ──────────────────────────────────────────
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
  }, [imageUri, sessionId]);

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
        const extData = extractResponse.data.extraction_result;
        setExtractionResult(extData);

        // ── Phase 5: Initialize Form State from Extracted Details ────────────
        setFormName(extData.name || '');
        setFormRollNo(extData.roll_no || '');
        setFormBranch(extData.branch || '');
        setFormSubject(extData.subject || '');
        setFormDate(extData.date || '');
        setFormMarksEntries(extData.marks_entries || []);
        setFormQuestionTotals(extData.question_totals || []);
        setFormGrandTotal(extData.total_marks_declared !== null ? String(extData.total_marks_declared) : '');

        // ── Phase 4: Automatic Local Arithmetic Validation ───────────────────
        try {
          const valResponse = await axios.post<SubmissionRecord>(
            `${API_BASE_URL}/submissions/${submissionId}/validate`,
            {},
            { timeout: 15_000 }
          );
          if (valResponse.data.validation_status === 'success' && valResponse.data.validation_result) {
            setValidationResult(valResponse.data.validation_result);
          }
        } catch (valErr) {
          console.warn('Automatic validation request failed:', valErr);
        }

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
    setValidationResult(null);
    navigation.goBack();
  }, [navigation]);

  // ── Phase 5: Debounced Live Re-Validation Hook ───────────────────────────
  React.useEffect(() => {
    if (flowState !== 'extracted' || !submissionId) return;

    const delayTimer = setTimeout(async () => {
      try {
        const payload = {
          name: formName,
          roll_no: formRollNo,
          branch: formBranch,
          subject: formSubject,
          date: formDate,
          marks_entries: formMarksEntries.map((e) => ({
            question_no: parseInt(String(e.question_no)) || 1,
            part: e.part || 'a',
            marks: parseFloat(String(e.marks)) || 0.0,
          })),
          question_totals: formQuestionTotals.map((q) => ({
            question_no: parseInt(String(q.question_no)) || 1,
            total: parseFloat(String(q.total)) || 0.0,
          })),
          total_marks_declared: formGrandTotal === '' ? null : parseFloat(formGrandTotal),
          field_confidence: extractionResult?.field_confidence || { name: 'high', roll_no: 'high' },
        };

        const response = await axios.post<ValidationResult>(
          `${API_BASE_URL}/submissions/validate/preview`,
          payload
        );
        setValidationResult(response.data);
      } catch (err) {
        console.warn('Live validation preview failed:', err);
      }
    }, 450); // 450ms debounce delay

    return () => clearTimeout(delayTimer);
  }, [
    formName,
    formRollNo,
    formBranch,
    formSubject,
    formDate,
    formMarksEntries,
    formQuestionTotals,
    formGrandTotal,
    flowState,
    submissionId,
    extractionResult,
  ]);

  // ── Phase 5: Form Action Helpers ──────────────────────────────────────────
  const handleAddMarkEntry = () => {
    setFormMarksEntries((prev) => [...prev, { question_no: 1, part: 'a', marks: 0.0 }]);
  };

  const handleDeleteMarkEntry = (idx: number) => {
    setFormMarksEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateMarkEntry = (idx: number, key: 'question_no' | 'part' | 'marks', value: string) => {
    setFormMarksEntries((prev) =>
      prev.map((item, i) => {
        if (i === idx) {
          if (key === 'question_no') {
            return { ...item, question_no: parseInt(value) || 1 };
          }
          if (key === 'part') {
            return { ...item, part: value.toLowerCase().slice(0, 1) };
          }
          if (key === 'marks') {
            return { ...item, marks: parseFloat(value) || 0.0 };
          }
        }
        return item;
      })
    );
  };

  const handleUpdateQuestionTotal = (q_no: number, value: string) => {
    setFormQuestionTotals((prev) =>
      prev.map((item) => {
        if (item.question_no === q_no) {
          return { ...item, total: parseFloat(value) || 0.0 };
        }
        return item;
      })
    );
  };

  const handleConfirmAndSave = async () => {
    if (!submissionId) return;

    const saveAction = async () => {
      setFlowState('uploading'); // displays loading indicators
      try {
        const payload = {
          name: formName,
          roll_no: formRollNo,
          branch: formBranch,
          subject: formSubject,
          date: formDate,
          marks_entries: formMarksEntries.map((e) => ({
            question_no: parseInt(String(e.question_no)) || 1,
            part: e.part || 'a',
            marks: parseFloat(String(e.marks)) || 0.0,
          })),
          question_totals: formQuestionTotals.map((q) => ({
            question_no: parseInt(String(q.question_no)) || 1,
            total: parseFloat(String(q.total)) || 0.0,
          })),
          total_marks_declared: formGrandTotal === '' ? null : parseFloat(formGrandTotal),
          field_confidence: extractionResult?.field_confidence || { name: 'high', roll_no: 'high' },
        };

        await axios.put(
          `${API_BASE_URL}/submissions/${submissionId}/extraction`,
          payload
        );

        // Put succeeded and backend disk cleanup has run! Return to Capture batch session.
        navigation.navigate('Capture', { sessionId });
      } catch (err) {
        console.error('Save failed:', err);
        setErrorMessage('Failed to save booklet updates.');
        setFlowState('extracted');
      }
    };

    // Warn teacher if validation is unresolved before saving
    if (validationResult && validationResult.overall_status !== 'valid') {
      const discrepancyCount = validationResult.issues.length;
      Alert.alert(
        'Unresolved Discrepancies',
        `There are still ${discrepancyCount} validation mismatches unresolved. Save anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Anyway', onPress: saveAction },
        ]
      );
    } else {
      await saveAction();
    }
  };

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

            {/* ── Phase 4: Validation Summary Banner ─────────────────────────── */}
            {validationResult && (
              <View style={styles.validationNoticeContainer}>
                {validationResult.overall_status === 'valid' && (
                  <View style={[styles.validationBanner, styles.validBanner]}>
                    <Text style={styles.validationBannerIcon}>✅</Text>
                    <View style={styles.validationBannerTextContainer}>
                      <Text style={styles.validTitle}>Arithmetic Validated</Text>
                      <Text style={styles.validSub}>
                        All question subparts and grand totals match perfectly.
                      </Text>
                    </View>
                  </View>
                )}

                {validationResult.overall_status === 'mismatch' && (
                  <View style={[styles.validationBanner, styles.mismatchBanner]}>
                    <Text style={styles.validationBannerIcon}>❌</Text>
                    <View style={styles.validationBannerTextContainer}>
                      <Text style={styles.mismatchTitle}>Arithmetic Discrepancies</Text>
                      {validationResult.issues.map((issue, idx) => (
                        <Text key={idx} style={styles.issueText}>
                          • {issue}
                        </Text>
                      ))}
                    </View>
                  </View>
                )}

                {validationResult.overall_status === 'incomplete' && (
                  <View style={[styles.validationBanner, styles.incompleteBanner]}>
                    <Text style={styles.validationBannerIcon}>⚠️</Text>
                    <View style={styles.validationBannerTextContainer}>
                      <Text style={styles.incompleteTitle}>Incomplete Marks Data</Text>
                      <Text style={styles.incompleteSub}>
                        Possible extraction gap. Questions present in one list are missing in the other:
                      </Text>
                      {validationResult.issues.map((issue, idx) => (
                        <Text key={idx} style={styles.issueText}>
                          • {issue}
                        </Text>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Metadata Fields */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Student Info</Text>

              {/* Name Field */}
              <View
                style={[
                  styles.fieldRow,
                  extractionResult.field_confidence.name === 'low' && styles.fieldWarningBorder,
                ]}
              >
                <Text style={styles.fieldLabel}>Name:</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="Student Name"
                  placeholderTextColor="#64748b"
                />
              </View>

              {/* Roll No Field */}
              <View
                style={[
                  styles.fieldRow,
                  extractionResult.field_confidence.roll_no === 'low' && styles.fieldWarningBorder,
                ]}
              >
                <Text style={styles.fieldLabel}>Roll No:</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formRollNo}
                  onChangeText={setFormRollNo}
                  placeholder="CS2026-99"
                  placeholderTextColor="#64748b"
                />
              </View>

              {/* Branch */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Branch:</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formBranch}
                  onChangeText={setFormBranch}
                  placeholder="Branch"
                  placeholderTextColor="#64748b"
                />
              </View>

              {/* Subject */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Subject:</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formSubject}
                  onChangeText={setFormSubject}
                  placeholder="Subject"
                  placeholderTextColor="#64748b"
                />
              </View>

              {/* Date */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Date:</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formDate}
                  onChangeText={setFormDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#64748b"
                />
              </View>
            </View>

            {/* Marks Breakdown */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Sub-Question Marks</Text>
              {formMarksEntries.length === 0 ? (
                <Text style={styles.emptyText}>No marks entries. Tap "+ Add" below.</Text>
              ) : (
                formMarksEntries.map((entry, idx) => (
                  <View key={idx} style={styles.marksEditRow}>
                    <Text style={styles.marksEditLabel}>Q: </Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputQ]}
                      value={String(entry.question_no)}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'question_no', val)}
                      keyboardType="numeric"
                      placeholder="Q"
                      placeholderTextColor="#64748b"
                    />
                    <Text style={styles.marksEditLabel}>Part: </Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputPart]}
                      value={entry.part}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'part', val)}
                      maxLength={1}
                      placeholder="Part"
                      placeholderTextColor="#64748b"
                    />
                    <Text style={styles.marksEditLabel}>Marks: </Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputVal]}
                      value={String(entry.marks)}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'marks', val)}
                      keyboardType="numeric"
                      placeholder="Marks"
                      placeholderTextColor="#64748b"
                    />
                    <Pressable
                      style={styles.deleteMarkButton}
                      onPress={() => handleDeleteMarkEntry(idx)}
                      accessibilityLabel={`Delete entry ${idx + 1}`}
                    >
                      <Text style={styles.deleteMarkText}>🗑️</Text>
                    </Pressable>
                  </View>
                ))
              )}
              <Pressable
                style={styles.addMarkButton}
                onPress={handleAddMarkEntry}
                accessibilityLabel="Add new subpart marks row"
              >
                <Text style={styles.addMarkButtonText}>+ Add Sub-part Mark</Text>
              </Pressable>
            </View>

            {/* Question Totals (transcribed totals vs declared) */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Examiner Totals</Text>
              {formQuestionTotals.length === 0 ? (
                <Text style={styles.emptyText}>No question totals detected.</Text>
              ) : (
                formQuestionTotals.map((tot) => {
                  const qVal = validationResult?.question_level.find(
                    (q) => q.question_no === tot.question_no
                  );

                  return (
                    <View
                      key={tot.question_no}
                      style={[
                        styles.totalRow,
                        qVal && !qVal.match && styles.warningRowHighlight,
                      ]}
                    >
                      <Text style={styles.totalLabel}>Question {tot.question_no}:</Text>
                      <View style={styles.row}>
                        <TextInput
                          style={styles.totalInput}
                          value={String(tot.total)}
                          onChangeText={(val) => handleUpdateQuestionTotal(tot.question_no, val)}
                          keyboardType="numeric"
                        />
                        <Text style={styles.totalUnitText}> Marks</Text>
                        {qVal && (
                          qVal.match ? (
                            <Text style={styles.matchPassTag}>  ✅</Text>
                          ) : (
                            <Text style={styles.matchFailTag}>  ⚠️ (Sum: {qVal.computed_sum})</Text>
                          )
                        )}
                      </View>
                    </View>
                  );
                })
              )}

              {/* Grand Total validation line */}
              <View
                style={[
                  styles.totalRow,
                  styles.grandTotalRow,
                  validationResult && !validationResult.grand_total.match && styles.warningRowHighlight,
                ]}
              >
                <Text style={styles.grandTotalLabel}>Declared Grand Total:</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.totalInput, styles.grandTotalInputStyle]}
                    value={formGrandTotal}
                    onChangeText={setFormGrandTotal}
                    keyboardType="numeric"
                    placeholder="Grand Total"
                    placeholderTextColor="#64748b"
                  />
                  <Text style={styles.totalUnitText}> Marks</Text>
                  {validationResult && (
                    validationResult.grand_total.match ? (
                      <Text style={styles.matchPassTag}>  ✅</Text>
                    ) : (
                      <Text style={styles.matchFailTag}>  ⚠️ (Sum: {validationResult.grand_total.computed_sum})</Text>
                    )
                  )}
                </View>
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
                  <Text style={styles.alertIcon}>📸</Text>
                  <Text style={styles.fallbackTitle}>Guide Cropped & Enhanced</Text>
                </View>
                <Text style={styles.fallbackBody}>
                  Booklet was cropped to the guide frame. Deskew and contrast optimized.
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
            <Text style={styles.alertIcon}>⚠️</Text>
            <View style={styles.successTextContainer}>
              <Text style={styles.errorTitle}>Error Occurred</Text>
              <Text style={styles.errorSub}>{errorMessage}</Text>
            </View>
          </View>
        )}

        {/* ── Action Buttons Bottom Row ──────────────────────────────────────── */}
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
              {flowState === 'extracted' ? '↩ Discard / Back' : '↩ Cancel'}
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
          ) : flowState === 'preprocessed' ? (
            // Shown after image is ready on the server: triggers extraction
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
          ) : flowState === 'extracted' ? (
            // Shown after details are extracted: triggers final confirm and save
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.confirmButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleConfirmAndSave}
            >
              <Text style={styles.confirmButtonText}>💾 Confirm & Save</Text>
            </Pressable>
          ) : null}
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

  // ── Phase 4 Validation UI Styles ──────────────────────────────────────────
  validationNoticeContainer: {
    marginBottom: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  validationBanner: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  validationBannerIcon: {
    fontSize: 22,
  },
  validationBannerTextContainer: {
    flex: 1,
    gap: 4,
  },
  validBanner: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: '#22c55e',
  },
  validTitle: {
    color: '#4ade80',
    fontSize: 15,
    fontWeight: '700',
  },
  validSub: {
    color: '#a7f3d0',
    fontSize: 13,
    lineHeight: 18,
  },
  mismatchBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: '#ef4444',
  },
  mismatchTitle: {
    color: '#f87171',
    fontSize: 15,
    fontWeight: '700',
  },
  incompleteBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderColor: '#3b82f6',
  },
  incompleteTitle: {
    color: '#60a5fa',
    fontSize: 15,
    fontWeight: '700',
  },
  incompleteSub: {
    color: '#93c5fd',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  issueText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  warningRowHighlight: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginVertical: 2,
  },
  matchPassTag: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
  },
  matchFailTag: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Phase 5 Form Input Styles ─────────────────────────────────────────────
  fieldInput: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    marginLeft: 12,
  },
  marksEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  marksEditLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  marksInput: {
    color: '#f8fafc',
    fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  marksInputQ: {
    flex: 1.5,
  },
  marksInputPart: {
    flex: 1.5,
  },
  marksInputVal: {
    flex: 2,
  },
  deleteMarkButton: {
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteMarkText: {
    fontSize: 14,
  },
  addMarkButton: {
    marginTop: 8,
    paddingVertical: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#6366f1',
    alignItems: 'center',
  },
  addMarkButtonText: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '700',
  },
  totalInput: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    width: 60,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  grandTotalInputStyle: {
    color: '#ec4899',
    fontSize: 14,
    fontWeight: '700',
  },
  totalUnitText: {
    color: '#94a3b8',
    fontSize: 13,
    marginLeft: 4,
  },
  confirmButton: {
    backgroundColor: '#10b981',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
