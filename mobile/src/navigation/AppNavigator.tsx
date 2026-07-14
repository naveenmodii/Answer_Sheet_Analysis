import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CaptureScreen from '../screens/CaptureScreen';
import ReviewScreen from '../screens/ReviewScreen';
import DashboardScreen from '../screens/DashboardScreen';

// ─── Route param types ───────────────────────────────────────────────────────
export type RootStackParamList = {
  Dashboard: undefined;
  Capture: { setId: string };
  Review: {
    imageUri: string;
    setId: string;
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
          headerStyle: { backgroundColor: '#2A1B17' },
          headerTintColor: '#E8A33D',
          headerTitleStyle: { fontWeight: '700' },
          headerBackTitleVisible: false,
        }}
      >
        <Stack.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ title: 'Mulyank', headerShown: false }}
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
