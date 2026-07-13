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
          // Sort by creation date descending
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

  // Load sessions list whenever screen gets focus
  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  const handleCreateNewSession = () => {
    // Generate simple clean UUID
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
        Alert.alert(
          'Spreadsheet Missing',
          'The local Excel file for this session could not be found.'
        );
        return;
      }

      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
        return;
      }

      // 1. Sanitize the user-assigned custom session name for safe filename usage
      const sanitizedName = session.name.replace(/[\/\\?%*:|"<>\s]+/g, '_');
      tempUri = `${FileSystem.cacheDirectory}${sanitizedName}.xlsx`;

      // 2. Make a temporary copy with the user-assigned custom name
      await FileSystem.copyAsync({
        from: session.localFilePath,
        to: tempUri,
      });

      // 3. Share the custom named copy instead of session_{id}.xlsx
      await Sharing.shareAsync(tempUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `Share marks for ${session.name}`,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
      });
    } catch (err) {
      console.error('Failed to share session spreadsheet:', err);
      Alert.alert('Share Error', 'Could not open native sharing options.');
    } finally {
      // 4. Safely delete the temporary renamed copy from cache
      if (tempUri) {
        try {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        } catch (cleanupErr) {
          console.warn('Failed to clean up temporary share spreadsheet file:', cleanupErr);
        }
      }
    }
  };

  const handleDeleteSession = (session: SessionMetadata) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${session.name}"? This will delete the local spreadsheet file permanently.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Delete actual xlsx file
              await FileSystem.deleteAsync(session.localFilePath, { idempotent: true });

              // 2. Remove metadata entry
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
      const updated = sessions.map((s) => {
        if (s.sessionId === renameSessionId) {
          return { ...s, name: renameNameText.trim() };
        }
        return s;
      });

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
      const date = new Date(isoStr);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <View style={styles.root}>
      {/* Upper Title Area */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>SIPAR</Text>
        <Text style={styles.appSub}>Smart Photo-to-Answer-Records</Text>
      </View>

      {/* Main Sessions Container */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.sectionHeader}>Scan Batches Library</Text>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : sessions.length === 0 ? (
          /* Empty Library State Card */
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>No Scan Batches Yet</Text>
            <Text style={styles.emptyBody}>
              Start scanning student booklets to compile consolidated Excel marks sheets automatically.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleCreateNewSession}
            >
              <Text style={styles.primaryButtonText}>+ New Scan Session</Text>
            </Pressable>
          </View>
        ) : (
          /* Session Cards List */
          sessions.map((session) => (
            <View key={session.sessionId} style={styles.sessionCard}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.metaCol}>
                  <Text style={styles.sessionName} numberOfLines={1}>
                    {session.name}
                  </Text>
                  <Text style={styles.sessionDate}>
                    {formatDate(session.createdAt)}
                  </Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {session.rowCount} {session.rowCount === 1 ? 'row' : 'rows'}
                  </Text>
                </View>
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.shareBtn,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => handleShareSession(session)}
                  accessibilityLabel={`Share session ${session.name}`}
                >
                  <Text style={styles.shareBtnText}>📊 Share sheet</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.editBtn,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => openRenameDialog(session)}
                  accessibilityLabel={`Rename session ${session.name}`}
                >
                  <Text style={styles.editBtnText}>✏️ Rename</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.deleteBtn,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => handleDeleteSession(session)}
                  accessibilityLabel={`Delete session ${session.name}`}
                >
                  <Text style={styles.deleteBtnText}>🗑️</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        {/* Append Bottom Action if library has sessions */}
        {sessions.length > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              styles.fabButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleCreateNewSession}
          >
            <Text style={styles.primaryButtonText}>+ New Scan Session</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Rename Dialog Modal */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rename Scan Session</Text>
            <TextInput
              style={styles.modalInput}
              value={renameNameText}
              onChangeText={setRenameNameText}
              placeholder="Session Name"
              placeholderTextColor="#64748b"
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    paddingTop: 58,
    paddingBottom: 20,
    alignItems: 'center',
    backgroundColor: '#16162a',
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#818cf8',
    letterSpacing: 2,
  },
  appSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
    gap: 16,
  },
  sectionHeader: {
    color: '#a5b4fc',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  centerWrap: {
    paddingVertical: 64,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },

  /* Empty Card State */
  emptyCard: {
    backgroundColor: '#16162a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    padding: 30,
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  emptyBody: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },

  /* Session Cards List */
  sessionCard: {
    backgroundColor: '#16162a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  metaCol: {
    flex: 1,
    gap: 4,
  },
  sessionName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  sessionDate: {
    fontSize: 12,
    color: '#64748b',
  },
  badge: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  badgeText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtn: {
    flex: 2,
    backgroundColor: '#10b981',
  },
  shareBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  editBtn: {
    flex: 1.5,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  editBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 44,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  deleteBtnText: {
    fontSize: 15,
  },

  /* Buttons */
  primaryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  fabButton: {
    marginTop: 10,
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
});
