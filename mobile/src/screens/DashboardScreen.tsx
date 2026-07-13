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
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

interface SessionMetadata {
  sessionId: string;
  name: string;
  createdAt: string;
  rowCount: number;
  localFilePath: string;
}

export default function DashboardScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // States for cross-platform rename modal dialog
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameNameText, setRenameNameText] = useState('');

  const sessionsFileUri = `${FileSystem.documentDirectory}sessions.json`;

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const info = await FileSystem.getInfoAsync(sessionsFileUri);
      if (info.exists) {
        const fileContent = await FileSystem.readAsStringAsync(sessionsFileUri);
        const data = JSON.parse(fileContent);
        if (Array.isArray(data)) {
          setSessions(
            data.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )
          );
        }
      } else {
        setSessions([]);
      }
    } catch (err) {
      console.error('Failed to load session library metadata:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionsFileUri]);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  const handleCreateNewSession = () => {
    const sessionUuid =
      Math.random().toString(36).substring(2, 11) +
      '-' +
      Math.random().toString(36).substring(2, 11);
    navigation.navigate('Capture', { sessionId: sessionUuid });
  };

  const handleShareSession = async (session: SessionMetadata) => {
    let tempUri: string | null = null;
    try {
      const fileInfo = await FileSystem.getInfoAsync(session.localFilePath);
      if (!fileInfo.exists) {
        Alert.alert('Spreadsheet Missing', 'The local Excel file for this session could not be found.');
        return;
      }

      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
        return;
      }

      const sanitizedName = session.name.replace(/[\/\\?%*:|"<>\s]+/g, '_');
      tempUri = `${FileSystem.cacheDirectory}${sanitizedName}.xlsx`;

      await FileSystem.copyAsync({ from: session.localFilePath, to: tempUri });

      await Sharing.shareAsync(tempUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `Share marks for ${session.name}`,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (err) {
      console.error('Failed to share session spreadsheet:', err);
      Alert.alert('Share Error', 'Could not open native sharing options.');
    } finally {
      if (tempUri) {
        try {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        } catch (cleanupErr) {
          console.warn('Failed to clean up temporary share file:', cleanupErr);
        }
      }
    }
  };

  const handleDeleteSession = (session: SessionMetadata) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${session.name}"? The local spreadsheet file will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await FileSystem.deleteAsync(session.localFilePath, { idempotent: true });
              const updated = sessions.filter((s) => s.sessionId !== session.sessionId);
              await FileSystem.writeAsStringAsync(sessionsFileUri, JSON.stringify(updated));
              setSessions(updated);
            } catch (err) {
              console.error('Delete session failed:', err);
              Alert.alert('Error', 'Failed to delete session files.');
            }
          },
        },
      ]
    );
  };

  const openRenameDialog = (session: SessionMetadata) => {
    setRenameSessionId(session.sessionId);
    setRenameNameText(session.name);
    setRenameModalVisible(true);
  };

  const handleRenameConfirm = async () => {
    if (!renameSessionId || !renameNameText.trim()) return;
    try {
      const updated = sessions.map((s) =>
        s.sessionId === renameSessionId ? { ...s, name: renameNameText.trim() } : s
      );
      await FileSystem.writeAsStringAsync(sessionsFileUri, JSON.stringify(updated));
      setSessions(updated);
      setRenameModalVisible(false);
      setRenameSessionId(null);
      setRenameNameText('');
    } catch (err) {
      console.error('Rename session metadata failed:', err);
      Alert.alert('Error', 'Failed to rename session record.');
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
        <Text style={styles.appTitle}>SIPAR</Text>
        <Text style={styles.appSub}>Smart Photo-to-Answer-Records</Text>
      </View>

      {/* Sessions List */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>SCAN BATCHES</Text>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        ) : sessions.length === 0 ? (
          /* Empty state */
          <View style={styles.emptyCard}>
            <Feather name="inbox" size={40} color={MUTED} />
            <Text style={styles.emptyTitle}>No Scan Batches Yet</Text>
            <Text style={styles.emptyBody}>
              Start a new session to photograph student booklets and compile a consolidated marks sheet.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={handleCreateNewSession}
            >
              <Feather name="plus" size={16} color="#fff" style={styles.btnIcon} />
              <Text style={styles.primaryBtnText}>New Scan Session</Text>
            </Pressable>
          </View>
        ) : (
          sessions.map((session) => (
            <View key={session.sessionId} style={styles.sessionCard}>
              <View style={styles.cardTop}>
                <View style={styles.metaCol}>
                  <Text style={styles.sessionName} numberOfLines={1}>
                    {session.name}
                  </Text>
                  <Text style={styles.sessionDate}>{formatDate(session.createdAt)}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {session.rowCount} {session.rowCount === 1 ? 'booklet' : 'booklets'}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              {/* Card actions */}
              <View style={styles.actionRow}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.shareBtn, pressed && styles.btnPressed]}
                  onPress={() => handleShareSession(session)}
                  accessibilityLabel={`Share session ${session.name}`}
                >
                  <Feather name="share-2" size={14} color="#fff" style={styles.btnIcon} />
                  <Text style={styles.shareBtnText}>Share</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.editBtn, pressed && styles.btnPressed]}
                  onPress={() => openRenameDialog(session)}
                  accessibilityLabel={`Rename session ${session.name}`}
                >
                  <Feather name="edit-2" size={14} color={TEXT_MUTED} style={styles.btnIcon} />
                  <Text style={styles.editBtnText}>Rename</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && styles.btnPressed]}
                  onPress={() => handleDeleteSession(session)}
                  accessibilityLabel={`Delete session ${session.name}`}
                >
                  <Feather name="trash-2" size={14} color={DANGER_TEXT} />
                </Pressable>
              </View>
            </View>
          ))
        )}

        {sessions.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, styles.fabBtn, pressed && styles.btnPressed]}
            onPress={handleCreateNewSession}
          >
            <Feather name="plus" size={16} color="#fff" style={styles.btnIcon} />
            <Text style={styles.primaryBtnText}>New Scan Session</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Rename Modal */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rename Session</Text>
            <TextInput
              style={styles.modalInput}
              value={renameNameText}
              onChangeText={setRenameNameText}
              placeholder="Session name"
              placeholderTextColor={MUTED}
              maxLength={40}
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setRenameModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={handleRenameConfirm}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
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
const SUCCESS_TEXT  = '#34d399';
const DANGER_TEXT   = '#f87171';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Header ──────────────────────────────────────────────────────────────────
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

  // ── List ────────────────────────────────────────────────────────────────────
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

  // ── Empty state ─────────────────────────────────────────────────────────────
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

  // ── Session card ────────────────────────────────────────────────────────────
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

  // ── Action buttons ──────────────────────────────────────────────────────────
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  btnIcon: { marginRight: 5 },
  shareBtn: { flex: 2, backgroundColor: ACCENT },
  shareBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  editBtn: {
    flex: 1.5,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
  },
  editBtnText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '500' },
  deleteBtn: {
    width: 40,
    backgroundColor: `${DANGER_TEXT}10`,
    borderWidth: 1,
    borderColor: `${DANGER_TEXT}25`,
  },

  // ── Primary button ──────────────────────────────────────────────────────────
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

  // ── Modal ────────────────────────────────────────────────────────────────────
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
  modalTitle: { fontSize: 17, fontWeight: '700', color: TEXT, textAlign: 'center' },
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
});
