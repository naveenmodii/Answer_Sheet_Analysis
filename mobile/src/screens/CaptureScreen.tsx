import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Capture'>;

// ─── Placeholder — camera logic added in Phase 1 ─────────────────────────────
export default function CaptureScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconPlaceholder}>
        <Text style={styles.icon}>📷</Text>
      </View>

      <Text style={styles.title}>Capture Screen</Text>
      <Text style={styles.subtitle}>
        Phase 1 — Camera capture &amp; image preprocessing will be implemented here.
      </Text>

      {/* Navigate to Review to verify the stack wiring works */}
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Review')}
        accessibilityLabel="Go to Review Screen"
      >
        <Text style={styles.buttonText}>Go to Review Screen →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#4f46e5',
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#e0e0ff',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#8888bb',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
