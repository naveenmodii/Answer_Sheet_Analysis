/**
 * ReviewScreen — Phase 3 + Phase 5 + Phase 8
 *
 * Displays the captured image and manages the full submission lifecycle:
 *   • Process & Upload → uploads image + calls preprocess
 *   • Extract Details  → calls Claude Vision API
 *   • Editable form    → teacher corrects extracted fields
 *   • Live validation  → debounced re-validation on every edit
 *   • Confirm & Save   → commits to session SQLite record
 *
 * Part 2 fix: KeyboardAwareScrollView scrolls the active field above the
 * keyboard on both iOS and Android — no field is ever hidden.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  TextInput,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Feather } from '@expo/vector-icons';
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

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG          = '#0b0b0e';
const SURFACE     = '#111116';
const PANEL_BG    = '#0e0e13';
const BORDER      = '#1e1e26';
const ACCENT      = '#5f5af6';
const TEXT        = '#e8e8f0';
const TEXT_MUTED  = '#7a7a8c';
const MUTED       = '#4a4a5a';
const SUCCESS_BG   = 'rgba(16,185,129,0.07)';
const SUCCESS_BORDER = 'rgba(16,185,129,0.25)';
const SUCCESS_TEXT   = '#34d399';
const WARN_BG     = 'rgba(245,158,11,0.07)';
const WARN_BORDER  = 'rgba(245,158,11,0.25)';
const WARN_TEXT    = '#fbbf24';
const DANGER_BG   = 'rgba(239,68,68,0.07)';
const DANGER_BORDER = 'rgba(239,68,68,0.25)';
const DANGER_TEXT   = '#f87171';
const INFO_BG     = 'rgba(59,130,246,0.07)';
const INFO_BORDER  = 'rgba(59,130,246,0.25)';
const INFO_TEXT    = '#60a5fa';

export default function ReviewScreen({ route, navigation }: Props) {
  const { imageUri, sessionId } = route.params;

  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prepStatus, setPrepStatus] = useState<PreprocessingStatus>('pending');
  const [prepDebugReason, setPrepDebugReason] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [displayUri, setDisplayUri] = useState<string>(imageUri);

  // ── Phase 5: Local form state ─────────────────────────────────────────────
  const [formName, setFormName] = useState('');
  const [formRollNo, setFormRollNo] = useState('');
  const [formBranch, setFormBranch] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formMarksEntries, setFormMarksEntries] = useState<MarksEntry[]>([]);
  const [formQuestionTotals, setFormQuestionTotals] = useState<QuestionTotal[]>([]);
  const [formGrandTotal, setFormGrandTotal] = useState('');

  // ── Upload & Preprocess Handler ───────────────────────────────────────────
  const handleUploadAndPreprocess = useCallback(async () => {
    setFlowState('uploading');
    setErrorMessage(null);
    setPrepStatus('pending');
    setPrepDebugReason(null);

    try {
      const formData = new FormData();
      const filename = imageUri.split('/').pop() || 'booklet.jpg';
      formData.append('file', {
        uri: imageUri,
        name: filename,
        type: 'image/jpeg',
      } as any);
      if (sessionId) {
        formData.append('session_id', sessionId);
      }

      const uploadResponse = await axios.post<{ submission_id: string; status: string }>(
        `${API_BASE_URL}/submissions`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30_000,
        }
      );

      const subId = uploadResponse.data.submission_id;
      setSubmissionId(subId);
      setFlowState('preprocessing');

      const prepResponse = await axios.post<SubmissionRecord>(
        `${API_BASE_URL}/submissions/${subId}/preprocess`,
        {},
        { timeout: 30_000 }
      );

      setPrepStatus(prepResponse.data.preprocessing_status);
      setPrepDebugReason(prepResponse.data.preprocessing_debug_reason ?? null);
      setDisplayUri(`${API_BASE_URL}/submissions/${subId}/preprocessed?t=${Date.now()}`);
      setFlowState('preprocessed');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>;
      const detail =
        axiosErr.response?.data?.detail ??
        axiosErr.message ??
        'Extraction request failed. Check server status.';
      setErrorMessage(detail);
      setFlowState('error');
    }
  }, [imageUri, sessionId]);

  // ── Extract Details Handler ───────────────────────────────────────────────
  const handleExtractDetails = useCallback(async () => {
    if (!submissionId) return;
    setFlowState('extracting');
    setErrorMessage(null);

    try {
      const extractResponse = await axios.post<SubmissionRecord>(
        `${API_BASE_URL}/submissions/${submissionId}/extract`,
        {},
        { timeout: 45_000 }
      );

      if (extractResponse.data.extraction_status === 'success' && extractResponse.data.extraction_result) {
        const extData = extractResponse.data.extraction_result;
        setExtractionResult(extData);
        setFormName(extData.name || '');
        setFormRollNo(extData.roll_no || '');
        setFormBranch(extData.branch || '');
        setFormSubject(extData.subject || '');
        setFormDate(extData.date || '');
        setFormMarksEntries(extData.marks_entries || []);
        setFormQuestionTotals(extData.question_totals || []);
        setFormGrandTotal(extData.total_marks_declared !== null ? String(extData.total_marks_declared) : '');

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
        const errorMsg = extractResponse.data.extraction_error ?? 'AI failed to extract details.';
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

  // ── Phase 5: Debounced live re-validation ─────────────────────────────────
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
    }, 450);

    return () => clearTimeout(delayTimer);
  }, [
    formName, formRollNo, formBranch, formSubject, formDate,
    formMarksEntries, formQuestionTotals, formGrandTotal,
    flowState, submissionId, extractionResult,
  ]);

  // ── Phase 5: Form action helpers ──────────────────────────────────────────
  const handleAddMarkEntry = () => {
    setFormMarksEntries((prev) => [...prev, { question_no: 1, part: 'a', marks: 0.0 }]);
  };

  const handleDeleteMarkEntry = (idx: number) => {
    setFormMarksEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateMarkEntry = (idx: number, key: 'question_no' | 'part' | 'marks', value: string) => {
    setFormMarksEntries((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (key === 'question_no') return { ...item, question_no: parseInt(value) || 1 };
        if (key === 'part') return { ...item, part: value.toLowerCase().slice(0, 1) };
        if (key === 'marks') return { ...item, marks: parseFloat(value) || 0.0 };
        return item;
      })
    );
  };

  const handleUpdateQuestionTotal = (q_no: number, value: string) => {
    setFormQuestionTotals((prev) =>
      prev.map((item) =>
        item.question_no === q_no ? { ...item, total: parseFloat(value) || 0.0 } : item
      )
    );
  };

  const handleConfirmAndSave = async () => {
    if (!submissionId) return;

    const saveAction = async () => {
      setFlowState('uploading');
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

        await axios.put(`${API_BASE_URL}/submissions/${submissionId}/extraction`, payload);
        navigation.navigate('Capture', { sessionId });
      } catch (err) {
        console.error('Save failed:', err);
        setErrorMessage('Failed to save booklet updates.');
        setFlowState('extracted');
      }
    };

    if (validationResult && validationResult.overall_status !== 'valid') {
      const count = validationResult.issues.length;
      Alert.alert(
        'Unresolved Discrepancies',
        `There are still ${count} validation mismatch${count === 1 ? '' : 'es'} unresolved. Save anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Anyway', onPress: saveAction },
        ]
      );
    } else {
      await saveAction();
    }
  };

  const isUploadingOrPrep = flowState === 'uploading' || flowState === 'preprocessing';
  const isWorking = isUploadingOrPrep || flowState === 'extracting';

  return (
    <View style={styles.root}>
      {/* Image preview — hidden once extraction is complete */}
      {flowState !== 'extracted' && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: displayUri }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel="Captured booklet preview"
          />

          {flowState === 'preprocessing' && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={styles.processingOverlayText}>Aligning and cleaning page…</Text>
            </View>
          )}

          {flowState === 'extracting' && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={styles.processingOverlayText}>Reading handwriting…</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Bottom panel with KeyboardAwareScrollView ── */}
      <KeyboardAwareScrollView
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        extraScrollHeight={100}
        enableResetScrollToCoords={false}
      >
        {/* ── Extracted form ─────────────────────────────────────────────── */}
        {flowState === 'extracted' && extractionResult && (
          <View style={styles.extractedContainer}>
            {/* Header row */}
            <View style={styles.extractedHeaderRow}>
              <Feather name="check-circle" size={18} color={SUCCESS_TEXT} />
              <Text style={styles.extractedHeaderTitle}>Extracted Details</Text>
              <Text style={styles.extractedHeaderHint}>— edit any field to correct</Text>
            </View>

            {/* ── Validation banner ─────────────────────────────────────── */}
            {validationResult && (
              <View>
                {validationResult.overall_status === 'valid' && (
                  <View style={[styles.statusBanner, styles.successBanner]}>
                    <Feather name="check-circle" size={16} color={SUCCESS_TEXT} />
                    <View style={styles.bannerTextCol}>
                      <Text style={styles.bannerTitle}>Arithmetic Validated</Text>
                      <Text style={styles.bannerSub}>All sub-totals and grand total match.</Text>
                    </View>
                  </View>
                )}

                {validationResult.overall_status === 'mismatch' && (
                  <View style={[styles.statusBanner, styles.dangerBanner]}>
                    <Feather name="alert-triangle" size={16} color={DANGER_TEXT} />
                    <View style={styles.bannerTextCol}>
                      <Text style={[styles.bannerTitle, { color: DANGER_TEXT }]}>Arithmetic Discrepancies</Text>
                      {validationResult.issues.map((issue, idx) => (
                        <Text key={idx} style={styles.bannerIssue}>• {issue}</Text>
                      ))}
                    </View>
                  </View>
                )}

                {validationResult.overall_status === 'incomplete' && (
                  <View style={[styles.statusBanner, styles.infoBanner]}>
                    <Feather name="info" size={16} color={INFO_TEXT} />
                    <View style={styles.bannerTextCol}>
                      <Text style={[styles.bannerTitle, { color: INFO_TEXT }]}>Incomplete Marks Data</Text>
                      <Text style={styles.bannerSub}>
                        Questions present in one list are missing from the other:
                      </Text>
                      {validationResult.issues.map((issue, idx) => (
                        <Text key={idx} style={styles.bannerIssue}>• {issue}</Text>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ── Student Info card ─────────────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>STUDENT INFO</Text>

              <View style={[
                styles.fieldRow,
                extractionResult.field_confidence.name === 'low' && styles.fieldRowWarn,
              ]}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formName}
                  onChangeText={setFormName}
                  placeholder="Student Name"
                  placeholderTextColor={MUTED}
                />
              </View>

              <View style={[
                styles.fieldRow,
                extractionResult.field_confidence.roll_no === 'low' && styles.fieldRowWarn,
              ]}>
                <Text style={styles.fieldLabel}>Roll No</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formRollNo}
                  onChangeText={setFormRollNo}
                  placeholder="CS2026-99"
                  placeholderTextColor={MUTED}
                />
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Branch</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formBranch}
                  onChangeText={setFormBranch}
                  placeholder="Branch"
                  placeholderTextColor={MUTED}
                />
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Subject</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formSubject}
                  onChangeText={setFormSubject}
                  placeholder="Subject"
                  placeholderTextColor={MUTED}
                />
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Date</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formDate}
                  onChangeText={setFormDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                />
              </View>
            </View>

            {/* ── Sub-question marks card ───────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>SUB-QUESTION MARKS</Text>

              {formMarksEntries.length === 0 ? (
                <Text style={styles.emptyText}>No entries yet. Tap "Add" below.</Text>
              ) : (
                formMarksEntries.map((entry, idx) => (
                  <View key={idx} style={styles.marksRow}>
                    <Text style={styles.marksRowLabel}>Q</Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputQ]}
                      value={String(entry.question_no)}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'question_no', val)}
                      keyboardType="numeric"
                      placeholder="Q"
                      placeholderTextColor={MUTED}
                    />
                    <Text style={styles.marksRowLabel}>Part</Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputPart]}
                      value={entry.part}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'part', val)}
                      maxLength={1}
                      placeholder="a"
                      placeholderTextColor={MUTED}
                    />
                    <Text style={styles.marksRowLabel}>Marks</Text>
                    <TextInput
                      style={[styles.marksInput, styles.marksInputVal]}
                      value={String(entry.marks)}
                      onChangeText={(val) => handleUpdateMarkEntry(idx, 'marks', val)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={MUTED}
                    />
                    <Pressable
                      style={styles.deleteMarkBtn}
                      onPress={() => handleDeleteMarkEntry(idx)}
                      accessibilityLabel={`Delete entry ${idx + 1}`}
                    >
                      <Feather name="trash-2" size={15} color={DANGER_TEXT} />
                    </Pressable>
                  </View>
                ))
              )}

              <Pressable
                style={styles.addMarkBtn}
                onPress={handleAddMarkEntry}
                accessibilityLabel="Add new sub-part marks row"
              >
                <Feather name="plus" size={14} color={ACCENT} style={{ marginRight: 6 }} />
                <Text style={styles.addMarkBtnText}>Add Sub-part</Text>
              </Pressable>
            </View>

            {/* ── Examiner totals card ──────────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>EXAMINER TOTALS</Text>

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
                      style={[styles.totalRow, qVal && !qVal.match && styles.totalRowWarn]}
                    >
                      <Text style={styles.totalLabel}>Question {tot.question_no}</Text>
                      <View style={styles.totalRightCol}>
                        <TextInput
                          style={styles.totalInput}
                          value={String(tot.total)}
                          onChangeText={(val) => handleUpdateQuestionTotal(tot.question_no, val)}
                          keyboardType="numeric"
                        />
                        <Text style={styles.totalUnit}>marks</Text>
                        {qVal && (
                          qVal.match ? (
                            <Feather name="check-circle" size={14} color={SUCCESS_TEXT} style={{ marginLeft: 6 }} />
                          ) : (
                            <View style={styles.mismatchTag}>
                              <Feather name="alert-triangle" size={12} color={WARN_TEXT} />
                              <Text style={styles.mismatchTagText}>{qVal.computed_sum}</Text>
                            </View>
                          )
                        )}
                      </View>
                    </View>
                  );
                })
              )}

              {/* Grand total row */}
              <View style={[
                styles.totalRow,
                styles.grandTotalRow,
                validationResult && !validationResult.grand_total.match && styles.totalRowWarn,
              ]}>
                <Text style={styles.grandTotalLabel}>Grand Total</Text>
                <View style={styles.totalRightCol}>
                  <TextInput
                    style={[styles.totalInput, styles.grandTotalInput]}
                    value={formGrandTotal}
                    onChangeText={setFormGrandTotal}
                    keyboardType="numeric"
                    placeholder="—"
                    placeholderTextColor={MUTED}
                  />
                  <Text style={styles.totalUnit}>marks</Text>
                  {validationResult && (
                    validationResult.grand_total.match ? (
                      <Feather name="check-circle" size={14} color={SUCCESS_TEXT} style={{ marginLeft: 6 }} />
                    ) : (
                      <View style={styles.mismatchTag}>
                        <Feather name="alert-triangle" size={12} color={WARN_TEXT} />
                        <Text style={styles.mismatchTagText}>{validationResult.grand_total.computed_sum}</Text>
                      </View>
                    )
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Pre-extraction status banners ──────────────────────────────── */}
        {flowState === 'preprocessed' && (
          <>
            {prepStatus === 'fallback' && (
              <View style={[styles.statusBanner, styles.warnBanner]}>
                <Feather name="crop" size={16} color={WARN_TEXT} />
                <View style={styles.bannerTextCol}>
                  <Text style={[styles.bannerTitle, { color: WARN_TEXT }]}>Guide Cropped & Enhanced</Text>
                  <Text style={styles.bannerSub}>
                    Booklet was cropped to guide frame; deskew and contrast optimised.
                  </Text>
                </View>
              </View>
            )}

            {prepStatus === 'success' && (
              <View style={[styles.statusBanner, styles.successBanner]}>
                <Feather name="check-circle" size={16} color={SUCCESS_TEXT} />
                <View style={styles.bannerTextCol}>
                  <Text style={styles.bannerTitle}>Preprocessing Complete</Text>
                  <Text style={styles.bannerSub}>
                    Perspective warp, rotation, and contrast enhanced.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* ── Error banner ───────────────────────────────────────────────── */}
        {flowState === 'error' && errorMessage && (
          <View style={[styles.statusBanner, styles.dangerBanner]}>
            <Feather name="alert-triangle" size={16} color={DANGER_TEXT} />
            <View style={styles.bannerTextCol}>
              <Text style={[styles.bannerTitle, { color: DANGER_TEXT }]}>Error Occurred</Text>
              <Text style={styles.bannerSub}>{errorMessage}</Text>
            </View>
          </View>
        )}

        {/* ── Action buttons ─────────────────────────────────────────────── */}
        <View style={styles.buttonRow}>
          {/* Cancel / Discard button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              styles.secondaryButton,
              (pressed || isWorking) && styles.buttonPressed,
            ]}
            onPress={handleRetake}
            disabled={isWorking}
          >
            <Feather name="arrow-left" size={14} color={TEXT_MUTED} style={{ marginRight: 5 }} />
            <Text style={styles.secondaryButtonText}>
              {flowState === 'extracted' ? 'Discard' : 'Cancel'}
            </Text>
          </Pressable>

          {/* Primary action: Upload / Extract / Retry / Confirm */}
          {(flowState === 'idle' || flowState === 'error' || isUploadingOrPrep) ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                isWorking && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleUploadAndPreprocess}
              disabled={isWorking}
            >
              {isUploadingOrPrep ? (
                <>
                  <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>Processing…</Text>
                </>
              ) : (
                <>
                  <Feather name={flowState === 'error' ? 'refresh-cw' : 'upload'} size={14} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.primaryButtonText}>
                    {flowState === 'error' ? 'Retry' : 'Process & Upload'}
                  </Text>
                </>
              )}
            </Pressable>
          ) : flowState === 'preprocessed' ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                flowState === 'extracting' && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleExtractDetails}
              disabled={flowState === 'extracting'}
            >
              {flowState === 'extracting' ? (
                <>
                  <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>Extracting…</Text>
                </>
              ) : (
                <>
                  <Feather name="search" size={14} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.primaryButtonText}>Extract Details</Text>
                </>
              )}
            </Pressable>
          ) : flowState === 'extracted' ? (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.confirmButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleConfirmAndSave}
            >
              <Feather name="save" size={14} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.primaryButtonText}>Confirm & Save</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Image preview ─────────────────────────────────────────────────────────
  imageContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,11,14,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingOverlayText: { color: '#a5a0ff', fontSize: 15, fontWeight: '600' },

  // ── Panel / scroll container ──────────────────────────────────────────────
  panel: {
    flex: 1,
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  panelContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },

  // ── Extracted header row ──────────────────────────────────────────────────
  extractedContainer: { gap: 16 },
  extractedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  extractedHeaderTitle: { color: TEXT, fontSize: 17, fontWeight: '700' },
  extractedHeaderHint: { color: TEXT_MUTED, fontSize: 12, fontWeight: '400', flex: 1 },

  // ── Status banners ────────────────────────────────────────────────────────
  statusBanner: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    alignItems: 'flex-start',
  },
  successBanner: { backgroundColor: SUCCESS_BG, borderColor: SUCCESS_BORDER },
  dangerBanner: { backgroundColor: DANGER_BG, borderColor: DANGER_BORDER },
  warnBanner: { backgroundColor: WARN_BG, borderColor: WARN_BORDER },
  infoBanner: { backgroundColor: INFO_BG, borderColor: INFO_BORDER },
  bannerTextCol: { flex: 1, gap: 3 },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: SUCCESS_TEXT },
  bannerSub: { fontSize: 12, color: TEXT_MUTED, lineHeight: 17 },
  bannerIssue: { fontSize: 12, color: TEXT_MUTED, lineHeight: 17 },

  // ── Cards ─────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },

  // ── Field rows ────────────────────────────────────────────────────────────
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  fieldRowWarn: {
    borderWidth: 1,
    borderColor: WARN_BORDER,
    backgroundColor: WARN_BG,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fieldLabel: { color: TEXT_MUTED, fontSize: 13, fontWeight: '500', width: 64 },
  fieldInput: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 7,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyText: { color: MUTED, fontSize: 12 },

  // ── Marks rows ────────────────────────────────────────────────────────────
  marksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  marksRowLabel: { color: MUTED, fontSize: 11, fontWeight: '600' },
  marksInput: {
    color: TEXT,
    fontSize: 13,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 7,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  marksInputQ: { flex: 1.5 },
  marksInputPart: { flex: 1.5 },
  marksInputVal: { flex: 2 },
  deleteMarkBtn: {
    width: 32,
    height: 32,
    backgroundColor: DANGER_BG,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: DANGER_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMarkBtn: {
    flexDirection: 'row',
    marginTop: 4,
    paddingVertical: 10,
    backgroundColor: 'rgba(95,90,246,0.06)',
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${ACCENT}50`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMarkBtnText: { color: ACCENT, fontSize: 13, fontWeight: '600' },

  // ── Totals rows ───────────────────────────────────────────────────────────
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  totalRowWarn: {
    backgroundColor: WARN_BG,
    borderWidth: 1,
    borderColor: WARN_BORDER,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginVertical: 2,
  },
  totalLabel: { color: TEXT_MUTED, fontSize: 13, fontWeight: '500' },
  totalRightCol: { flexDirection: 'row', alignItems: 'center' },
  totalInput: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 7,
    width: 60,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  totalUnit: { color: TEXT_MUTED, fontSize: 12, marginLeft: 5 },
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  grandTotalLabel: { color: TEXT, fontSize: 14, fontWeight: '700' },
  grandTotalInput: { color: TEXT, fontSize: 14, fontWeight: '700' },
  mismatchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WARN_BG,
    borderWidth: 1,
    borderColor: WARN_BORDER,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 6,
    gap: 3,
  },
  mismatchTagText: { color: WARN_TEXT, fontSize: 11, fontWeight: '600' },

  // ── Buttons ───────────────────────────────────────────────────────────────
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryButtonText: { color: TEXT_MUTED, fontSize: 14, fontWeight: '600' },
  primaryButton: { backgroundColor: ACCENT },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmButton: { backgroundColor: '#059669' },
});
