import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CaptureScreen from '../screens/CaptureScreen';
import ReviewScreen from '../screens/ReviewScreen';

// ─── Route param types ───────────────────────────────────────────────────────
export type RootStackParamList = {
  Capture: undefined;
  Review: undefined; // Phase 1: will carry extracted data from Capture
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Navigator ───────────────────────────────────────────────────────────────
export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Capture"
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#e0e0ff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen
          name="Capture"
          component={CaptureScreen}
          options={{ title: 'Scan Booklet' }}
        />
        <Stack.Screen
          name="Review"
          component={ReviewScreen}
          options={{ title: 'Review & Save' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
