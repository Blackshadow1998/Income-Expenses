import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Text } from 'react-native';
import { COLORS } from '@/format';

/** Emoji tab icon that pops and gets a tinted pill when its tab is active. */
function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: focused ? 1 : 0, speed: 18, bounciness: 10, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, focused]);
  return (
    <Animated.View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: focused ? COLORS.primarySoft : 'transparent',
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
      }}
    >
      <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.6 }}>{glyph}</Text>
    </Animated.View>
  );
}

const icon = (glyph: string) => ({ focused }: { focused: boolean }) => <TabIcon glyph={glyph} focused={focused} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopWidth: 0,
          boxShadow: '0px -4px 20px rgba(30, 27, 75, 0.08)',
          height: Platform.OS === 'web' ? 64 : undefined,
          paddingTop: 6,
        },
        headerTitleAlign: 'center',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: COLORS.bg },
        headerTitleStyle: { fontWeight: '800', color: COLORS.text },
        sceneStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'รายรับรายจ่าย', tabBarLabel: 'รายเดือน', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="yearly" options={{ title: 'สรุปรายปี', tabBarLabel: 'สรุปรายปี', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="accounts" options={{ title: 'บัญชี', tabBarLabel: 'บัญชี', tabBarIcon: icon('🏦') }} />
      <Tabs.Screen name="settings" options={{ title: 'ตั้งค่า', tabBarLabel: 'ตั้งค่า', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
