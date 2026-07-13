import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CaptureScreen from '../screens/CaptureScreen';
import ReviewScreen from '../screens/ReviewScreen';
import DashboardScreen from '../screens/DashboardScreen';

// ─── Route param types ───────────────────────────────────────────────────────
export type RootStackParamList = {
  Dashboard: undefined;
  Capture: { sessionId: string };
  Review: {
    imageUri: string;
    sessionId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── Navigator ───────────────────────────────────────────────────────────────
export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Dashboard"
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#e0e0ff',
          headerTitleStyle: { fontWeight: '700' },
          headerBackTitleVisible: false,
        }}
      >
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ title: 'SIPAR Dashboard', headerShown: false }}
        />
        <Stack.Screen
          name="Capture"
          component={CaptureScreen}
          options={{ title: 'Scan Booklet', headerShown: false }}
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
