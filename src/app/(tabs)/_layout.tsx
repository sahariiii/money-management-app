import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { Button } from '@/components';
import { colors, fontWeight, spacing } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type TabIconProps = { color: ColorValue; size: number; focused: boolean };

function TabIcon({ name, focusedName, color, size, focused }: TabIconProps & { name: IconName; focusedName: IconName }) {
  return (
    <Ionicons
      name={focused ? focusedName : name}
      size={size}
      color={typeof color === 'string' ? color : undefined}
    />
  );
}

function tabIcon(name: IconName, focusedName: IconName) {
  return function Icon(props: TabIconProps) {
    return <TabIcon name={name} focusedName={focusedName} {...props} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('home-outline', 'home'),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Button
                label="Upload"
                icon="cloud-upload-outline"
                variant="ghost"
                size="sm"
                onPress={() => router.push('/upload-statement')}
              />
              <Button
                label="Scan"
                icon="camera-outline"
                variant="ghost"
                size="sm"
                onPress={() => router.push('/scan-receipt')}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: 'Activity', tabBarIcon: tabIcon('list-outline', 'list') }}
      />
      <Tabs.Screen
        name="chat"
        // Hide the tab bar while typing so it doesn't ride up above the keyboard on Android.
        options={{ title: 'Assistant', tabBarIcon: tabIcon('sparkles-outline', 'sparkles'), tabBarHideOnKeyboard: true }}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: 'Cards', tabBarIcon: tabIcon('card-outline', 'card') }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: tabIcon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', marginRight: spacing.sm },
});
