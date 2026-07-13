import React, { useCallback, useEffect, useState } from 'react';
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

export default function DashboardScreen({ navigation }: Props) {
  const [sets, setSets] = useState<SetMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // States for cross-platform set creation modal
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // States for View Rows modal
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
              
              // Immediately remove from lists without requiring full refresh
              setSets((prev) => prev.filter((s) => s.set_id !== set.set_id));
              
              // Clear current local set persistence if deleted
              try {
                const stored = await FileSystem.readAsStringAsync(currentSetFileUri);
                const { setId } = JSON.parse(stored);
                if (setId === set.set_id) {
                  await FileSystem.deleteAsync(currentSetFileUri, { idempotent: true });
                }
              } catch (clearErr) {
                // Ignore if file doesn't exist
              }

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
      if (tempUri) {
        try {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        } catch (cleanupErr) {
          console.warn(cleanupErr);
        }
      }
      if (localUri) {
        try {
          await FileSystem.deleteAsync(localUri, { idempotent: true });
        } catch (cleanupErr) {
          console.warn(cleanupErr);
        }
      }
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>Answer Sheet Analysis</Text>
        <Text style={styles.appSub}>Scan · Extract · Verify</Text>
      </View>

      {/* Sets List */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>SCAN SETS</Text>

        {loading && sets.length === 0 ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : sets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="inbox" size={40} color={MUTED} />
            <Text style={styles.emptyTitle}>No Sets Created Yet</Text>
            <Text style={styles.emptyBody}>
              Create a new named set to photograph booklets and append marks to its spreadsheet.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={handleOpenCreateModal}
            >
              <Feather name="plus" size={16} color="#fff" style={styles.btnIcon} />
              <Text style={styles.primaryBtnText}>New Scan Set</Text>
            </Pressable>
          </View>
        ) : (
          sets.map((item) => (
            <View key={item.set_id} style={styles.sessionCard}>
              <Pressable
                style={styles.cardTop}
                onPress={() => handleSelectSet(item.set_id)}
              >
                <View style={styles.metaCol}>
                  <Text style={styles.sessionName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.sessionDate}>{formatDate(item.created_at)}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {item.row_count} {item.row_count === 1 ? 'row' : 'rows'}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.divider} />

              {/* Actions row: download, view rows, delete */}
              <View style={styles.actionRow}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.shareBtn, pressed && styles.btnPressed]}
                  onPress={() => handleShareSetSpreadsheet(item)}
                  accessibilityLabel={`Download spreadsheet for ${item.name}`}
                >
                  <Feather name="share-2" size={14} color="#fff" style={styles.btnIcon} />
                  <Text style={styles.shareBtnText}>Download & Share</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
                  onPress={() => handleViewRows(item)}
                  accessibilityLabel={`View confirmed rows for ${item.name}`}
                >
                  <Feather name="eye" size={16} color={TEXT} />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.iconBtn, styles.deleteBtn, pressed && styles.btnPressed]}
                  onPress={() => handleDeleteSet(item)}
                  accessibilityLabel={`Delete set ${item.name}`}
                >
                  <Feather name="trash-2" size={16} color="#f87171" />
                </Pressable>
              </View>
            </View>
          ))
        )}

        {sets.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, styles.fabBtn, pressed && styles.btnPressed]}
            onPress={handleOpenCreateModal}
          >
            <Feather name="plus" size={16} color="#fff" style={styles.btnIcon} />
            <Text style={styles.primaryBtnText}>New Scan Set</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Create Set Modal */}
      <Modal
        visible={createModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
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
              <Pressable
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={handleConfirmCreateSet}
              >
                <Text style={styles.modalSaveText}>Create Set</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* View Rows Modal */}
      <Modal
        visible={viewRowsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewRowsModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {viewRowsSetName}
              </Text>
              <Pressable onPress={() => setViewRowsModalVisible(false)}>
                <Feather name="x" size={20} color={TEXT_MUTED} />
              </Pressable>
            </View>

            {viewRowsLoading ? (
              <ActivityIndicator size="large" color={ACCENT} style={{ marginVertical: 32 }} />
            ) : viewRowsList.length === 0 ? (
              <Text style={styles.noRowsText}>No confirmed booklet entries in this set yet.</Text>
            ) : (
              <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.rowsContainer}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, { flex: 2.2 }]}>Student Name</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1.8 }]}>Roll No</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>Marks</Text>
                  <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Status</Text>
                </View>
                {viewRowsList.map((row) => (
                  <View key={row.submission_id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, { flex: 2.2, fontWeight: '600' }]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1.8 }]} numberOfLines={1}>
                      {row.roll_no}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>
                      {row.total_marks}
                    </Text>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={[
                        styles.valBadge,
                        row.validation_status === 'valid' ? styles.valValid : styles.valMismatch
                      ]}>
                        {row.validation_status === 'valid' ? 'Valid' : 'Mismatch'}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={() => setViewRowsModalVisible(false)}
            >
              <Text style={styles.primaryBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG        = '#0b0b0e';
const SURFACE   = '#111116';
const BORDER    = '#1e1e26';
const ACCENT    = '#5f5af6';
const TEXT      = '#e8e8f0';
const TEXT_MUTED = '#7a7a8c';
const MUTED     = '#4a4a5a';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: 1.5,
  },
  appSub: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 3,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 56, gap: 12 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    marginBottom: 4,
  },

  centerWrap: { paddingVertical: 64, alignItems: 'center' },

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
  emptyBody: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },

  sessionCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  metaCol: { flex: 1, gap: 4 },
  sessionName: { fontSize: 15, fontWeight: '600', color: TEXT },
  sessionDate: { fontSize: 12, color: TEXT_MUTED },
  badge: {
    backgroundColor: `${ACCENT}18`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${ACCENT}40`,
  },
  badgeText: { color: ACCENT, fontSize: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: BORDER },

  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  btnIcon: { marginRight: 5 },
  shareBtn: { flex: 1, backgroundColor: ACCENT },
  shareBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  iconBtn: {
    width: 36,
    height: 36,
    backgroundColor: '#1b1b24',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    backgroundColor: 'rgba(224,90,90,0.08)',
    borderColor: 'rgba(224,90,90,0.25)',
  },

  primaryBtn: {
    flexDirection: 'row',
    backgroundColor: ACCENT,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  fabBtn: { marginTop: 8 },
  btnPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },

  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#18181f',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: TEXT, flex: 1, marginRight: 8 },
  modalDesc: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 18 },
  modalInput: {
    backgroundColor: '#0f0f14',
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
  modalCancelText: { color: TEXT_MUTED, fontWeight: '600' },
  modalSaveBtn: { backgroundColor: ACCENT },
  modalSaveText: { color: '#fff', fontWeight: '700' },

  noRowsText: {
    color: TEXT_MUTED,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 32,
  },
  rowsScroll: {
    width: '100%',
    maxHeight: 300,
  },
  rowsContainer: {
    gap: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingBottom: 8,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderColor: BORDER,
  },
  tableCell: {
    fontSize: 13,
    color: TEXT,
  },
  valBadge: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  valValid: {
    backgroundColor: 'rgba(52,199,89,0.12)',
    color: '#34c759',
  },
  valMismatch: {
    backgroundColor: 'rgba(255,149,0,0.12)',
    color: '#ff9500',
  },
});
