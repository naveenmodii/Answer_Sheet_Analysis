import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import axios from 'axios';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '../config';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

interface SetMetadata {
  set_id: string;
  name: string;
  created_at: string;
  status: string;
  row_count: number;
}

interface SetRowRecord {
  submission_id: string;
  name: string;
  roll_no: string;
  total_marks: number;
  validation_status: string;
}

// ── Cool violet/dark modern aesthetic ──────────────────────────────────────────
const BG        = '#0A0A0F';   // near-black, cool undertone
const SURFACE   = '#14141F';   // card/surface background
const BORDER    = '#2A2A3D';   // subtle 1px border for glassmorphic look
const ACCENT    = '#8B7FFF';   // violet accent
const TEXT      = '#F1F1F5';   // near-white
const MUTED     = '#8888A0';   // warm grey-taupe
const DANGER    = '#FF6B6B';   // custom red for delete button

export default function DashboardScreen({ navigation }: Props) {
  const [sets, setSets] = useState<SetMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  const [viewRowsModalVisible, setViewRowsModalVisible] = useState(false);
  const [viewRowsList, setViewRowsList] = useState<SetRowRecord[]>([]);
  const [viewRowsLoading, setViewRowsLoading] = useState(false);
  const [viewRowsSetName, setViewRowsSetName] = useState('');

  const currentSetFileUri = `${FileSystem.documentDirectory}current_set.json`;

  const loadSets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get<SetMetadata[]>(`${API_BASE_URL}/submissions/sets`);
      setSets(res.data);
    } catch (err) {
      console.error('Failed to load sets metadata list:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSets();
    }, [loadSets])
  );

  const handleOpenCreateModal = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0] ?? '';
    const timeStr = now.toTimeString().split(' ')[0]?.substring(0, 5) ?? '';
    setNewSetName(`Set ${dateStr} ${timeStr}`);
    setCreateModalVisible(true);
  };

  const handleConfirmCreateSet = async () => {
    const finalName = newSetName.trim();
    if (!finalName) return;
    try {
      setCreateModalVisible(false);
      setLoading(true);
      const res = await axios.post<SetMetadata>(`${API_BASE_URL}/submissions/sets`, {
        name: finalName,
      });
      const newSet = res.data;
      try {
        await FileSystem.writeAsStringAsync(
          currentSetFileUri,
          JSON.stringify({ setId: newSet.set_id })
        );
      } catch (storeErr) {
        console.warn('Failed to save selected set ID locally:', storeErr);
      }
      navigation.navigate('Capture', { setId: newSet.set_id });
    } catch (err) {
      console.error('Failed to create new set:', err);
      Alert.alert('Error', 'Could not create a new scanning set.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSet = async (setId: string) => {
    try {
      await FileSystem.writeAsStringAsync(
        currentSetFileUri,
        JSON.stringify({ setId })
      );
    } catch (storeErr) {
      console.warn('Failed to save selected set ID locally:', storeErr);
    }
    navigation.navigate('Capture', { setId });
  };

  const handleViewRows = async (set: SetMetadata) => {
    setViewRowsSetName(set.name);
    setViewRowsList([]);
    setViewRowsModalVisible(true);
    setViewRowsLoading(true);
    try {
      const res = await axios.get<SetRowRecord[]>(
        `${API_BASE_URL}/submissions/sets/${set.set_id}/rows`
      );
      setViewRowsList(res.data);
    } catch (err) {
      console.error('Failed to fetch set rows:', err);
      Alert.alert('Error', 'Could not load confirmed booklet rows for this set.');
      setViewRowsModalVisible(false);
    } finally {
      setViewRowsLoading(false);
    }
  };

  const handleDeleteSet = (set: SetMetadata) => {
    Alert.alert(
      'Delete Set',
      `Delete '${set.name}'? This cannot be undone. All associated submissions and spreadsheet reports will be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await axios.delete(`${API_BASE_URL}/submissions/sets/${set.set_id}`);
              setSets((prev) => prev.filter((s) => s.set_id !== set.set_id));
              try {
                const stored = await FileSystem.readAsStringAsync(currentSetFileUri);
                const { setId } = JSON.parse(stored);
                if (setId === set.set_id) {
                  await FileSystem.deleteAsync(currentSetFileUri, { idempotent: true });
                }
              } catch {}
              Alert.alert('Deleted', `Set '${set.name}' has been deleted.`);
            } catch (err) {
              console.error('Failed to delete set:', err);
              Alert.alert('Error', 'Could not delete the selected set.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDownloadSetSpreadsheet = async (set: SetMetadata) => {
    try {
      setLoading(true);
      const filename = `${set.name.replace(/[\/\\?%*:|"<>\s]+/g, '_')}_report.xlsx`;
      const localUri = `${FileSystem.documentDirectory}${filename}`;
      const downloadResult = await FileSystem.downloadAsync(
        `${API_BASE_URL}/submissions/sets/${set.set_id}/download`,
        localUri
      );
      if (downloadResult.status !== 200) {
        throw new Error('Server download returned status ' + downloadResult.status);
      }
      Alert.alert('Download Complete', `Saved to app directory as:\n${filename}`);
    } catch (err) {
      console.error('Failed to download set spreadsheet:', err);
      Alert.alert('Download Error', 'Could not download the set spreadsheet.');
    } finally {
      setLoading(false);
    }
  };

  const handleShareSetSpreadsheet = async (set: SetMetadata) => {
    let localUri: string | null = null;
    let tempUri: string | null = null;
    try {
      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
        return;
      }
      setLoading(true);
      localUri = `${FileSystem.documentDirectory}set_${set.set_id}.xlsx`;
      const downloadResult = await FileSystem.downloadAsync(
        `${API_BASE_URL}/submissions/sets/${set.set_id}/download`,
        localUri
      );
      if (downloadResult.status !== 200) {
        throw new Error('Server download returned status ' + downloadResult.status);
      }
      const sanitizedName = set.name.replace(/[\/\\?%*:|"<>\s]+/g, '_');
      tempUri = `${FileSystem.cacheDirectory}${sanitizedName}.xlsx`;
      await FileSystem.copyAsync({ from: downloadResult.uri, to: tempUri });
      await Sharing.shareAsync(tempUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `Share spreadsheet for ${set.name}`,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (err) {
      console.error('Failed to share set spreadsheet:', err);
      Alert.alert('Download Error', 'Could not download or share the set spreadsheet.');
    } finally {
      setLoading(false);
      if (tempUri) { try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch {} }
      if (localUri) { try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch {} }
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <View style={styles.root}>
      {/* ── Center Header with Gradient Title ── */}
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <MaskedView
            style={styles.maskedView}
            maskElement={<Text style={styles.appTitle}>Mulyank</Text>}
          >
            <LinearGradient
              colors={['#E0C3FC', '#8B7FFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </MaskedView>
        </View>
        <Text style={styles.appSub}>Answer Sheet Evaluation</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Centered section label with violet underline */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>SCAN SETS</Text>
          <LinearGradient
            colors={['#E0C3FC', '#8B7FFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sectionUnderline}
          />
        </View>

        {loading && sets.length === 0 ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : sets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="inbox" size={40} color={MUTED} />
            <Text style={styles.emptyTitle}>No Sets Created Yet</Text>
            <Text style={styles.emptyBody}>
              Create a named set to photograph booklets and append marks to its spreadsheet.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.ctaBtn, pressed && styles.btnPressed]}
              onPress={handleOpenCreateModal}
            >
              <Feather name="plus" size={16} color="#0A0A0F" style={styles.btnIcon} />
              <Text style={styles.ctaBtnText}>New Scan Set</Text>
            </Pressable>
          </View>
        ) : (
          sets.map((item) => (
            <View key={item.set_id} style={styles.card}>
              <Pressable
                style={styles.cardTop}
                onPress={() => handleSelectSet(item.set_id)}
              >
                <View style={styles.metaCol}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
                </View>
                <View style={styles.rowBadge}>
                  <Text style={styles.rowBadgeText}>
                    {item.row_count} {item.row_count === 1 ? 'row' : 'rows'}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.divider} />

              {/* Action row with side-by-side Download/Share & compact Eye/Trash */}
              <View style={styles.actionRow}>
                <View style={styles.btnCol}>
                  <Pressable
                    style={({ pressed }) => [styles.glassBtn, pressed && styles.btnPressed]}
                    onPress={() => handleDownloadSetSpreadsheet(item)}
                  >
                    <Feather name="download" size={13} color={ACCENT} style={styles.btnIcon} />
                    <Text style={styles.glassBtnText}>Download</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.glassBtn, pressed && styles.btnPressed]}
                    onPress={() => handleShareSetSpreadsheet(item)}
                  >
                    <Feather name="share-2" size={13} color={ACCENT} style={styles.btnIcon} />
                    <Text style={styles.glassBtnText}>Share</Text>
                  </Pressable>
                </View>

                <View style={styles.iconCol}>
                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
                    onPress={() => handleViewRows(item)}
                  >
                    <Feather name="eye" size={15} color={ACCENT} />
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, styles.deleteBtnStyle, pressed && styles.btnPressed]}
                    onPress={() => handleDeleteSet(item)}
                  >
                    <Feather name="trash-2" size={15} color={DANGER} />
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}

        {sets.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.ctaBtn, { marginTop: 8 }, pressed && styles.btnPressed]}
            onPress={handleOpenCreateModal}
          >
            <Feather name="plus" size={16} color="#0A0A0F" style={styles.btnIcon} />
            <Text style={styles.ctaBtnText}>New Scan Set</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* ── Create Set Modal ── */}
      <Modal visible={createModalVisible} transparent animationType="fade" onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Scan Set</Text>
            <Text style={styles.modalDesc}>
              Enter a name for this scanning set. All booklets scanned in this set will be appended as rows in its Excel spreadsheet.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={newSetName}
              onChangeText={setNewSetName}
              placeholder="e.g. Computer Science CS-101"
              placeholderTextColor={MUTED}
              maxLength={40}
            />
            <View style={styles.modalButtons}>
              <Pressable style={[styles.modalBtn, styles.modalCancelBtn]} onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalSaveBtn]} onPress={handleConfirmCreateSet}>
                <Text style={styles.modalSaveText}>Create Set</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── View Rows Modal ── */}
      <Modal visible={viewRowsModalVisible} transparent animationType="fade" onRequestClose={() => setViewRowsModalVisible(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{viewRowsSetName}</Text>
              <Pressable onPress={() => setViewRowsModalVisible(false)}>
                <Feather name="x" size={20} color={MUTED} />
              </Pressable>
            </View>

            {viewRowsLoading ? (
              <ActivityIndicator size="large" color={ACCENT} style={{ marginVertical: 32 }} />
            ) : viewRowsList.length === 0 ? (
              <Text style={styles.noRowsText}>No confirmed booklet entries in this set yet.</Text>
            ) : (
              <ScrollView style={{ width: '100%', maxHeight: 300 }} contentContainerStyle={{ gap: 8 }}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, { flex: 2.2 }]}>Student Name</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1.8 }]}>Roll No</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Marks</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Status</Text>
                </View>
                {viewRowsList.map((row) => (
                  <View key={row.submission_id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, { flex: 2.2, fontWeight: '600' }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={[styles.tableCell, { flex: 1.8 }]} numberOfLines={1}>{row.roll_no}</Text>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{row.total_marks}</Text>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={[styles.valBadge, row.validation_status === 'valid' ? styles.valValid : styles.valMismatch]}>
                        {row.validation_status === 'valid' ? 'Valid' : 'Mismatch'}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable style={({ pressed }) => [styles.ctaBtn, pressed && styles.btnPressed]} onPress={() => setViewRowsModalVisible(false)}>
              <Text style={styles.ctaBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    paddingTop: 56,
    paddingBottom: 20,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: 'center',
  },
  titleContainer: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  maskedView: {
    width: 150,
    height: '100%',
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#000000',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  appSub: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '500',
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  // ── Scroll ──────────────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 56, gap: 12 },
  sectionHeader: {
    alignItems: 'center',
    marginVertical: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  sectionUnderline: {
    width: 40,
    height: 2,
    borderRadius: 1,
    marginTop: 6,
  },
  centerWrap: { paddingVertical: 64, alignItems: 'center' },

  // ── Empty ────────────────────────────────────────────────────────────────────
  emptyCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  emptyBody: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 8 },

  // ── Card ─────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metaCol: { flex: 1, gap: 4 },
  cardName: { fontSize: 15, fontWeight: '600', color: TEXT },
  cardDate: { fontSize: 12, color: MUTED },
  rowBadge: {
    backgroundColor: '#1E1E2E',
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rowBadgeText: { color: '#A78BFA', fontSize: 11, fontWeight: '600' },
  divider: { height: 1, backgroundColor: BORDER },

  // ── Actions ──────────────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  btnCol: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  iconCol: {
    flexDirection: 'row',
    gap: 6,
  },
  glassBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1E1E2E',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  glassBtnText: {
    color: '#8B7FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  btnIcon: { marginRight: 4 },
  btnPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },

  iconBtn: {
    width: 38,
    height: 38,
    backgroundColor: '#1E1E2E',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnStyle: {
    borderColor: 'rgba(255, 107, 107, 0.3)',
    backgroundColor: '#1E1E2E',
  },

  // ── Modals ───────────────────────────────────────────────────────────────────
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 20,
    gap: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: TEXT, flex: 1, marginRight: 8 },
  modalDesc: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 18 },
  modalInput: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: TEXT,
    fontSize: 14,
  },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER },
  modalCancelText: { color: MUTED, fontWeight: '600', fontSize: 14 },
  modalSaveBtn: { backgroundColor: ACCENT },
  modalSaveText: { color: '#0A0A0F', fontWeight: '700', fontSize: 14 },

  // ── Table ─────────────────────────────────────────────────────────────────────
  noRowsText: { color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 32 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingBottom: 8,
    marginBottom: 4,
  },
  tableHeaderCell: { fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 0.5 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderColor: BORDER,
  },
  tableCell: { fontSize: 13, color: TEXT },
  valBadge: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  valValid: { backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80' },
  valMismatch: { backgroundColor: 'rgba(251,146,60,0.15)', color: '#fb923c' },

  // ── CTA Button ──────────────────────────────────────────────────────────────
  ctaBtn: {
    flexDirection: 'row',
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  ctaBtnText: { color: '#0A0A0F', fontSize: 14, fontWeight: '700' },
});
