import { Tabs } from 'expo-router';
import { makeSpotlightTabBar } from '@/components/SpotlightTabBar';
import { COLORS } from '@/format';

const tabBar = makeSpotlightTabBar({ index: '📅', yearly: '📊', accounts: '🏦', settings: '⚙️' });

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={tabBar}
      screenOptions={{
        headerTitleAlign: 'center',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: COLORS.bg },
        headerTitleStyle: { fontWeight: '800', color: COLORS.text },
        sceneStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'รายรับรายจ่าย', tabBarLabel: 'รายเดือน' }} />
      <Tabs.Screen name="yearly" options={{ title: 'สรุปรายปี', tabBarLabel: 'สรุปรายปี' }} />
      <Tabs.Screen name="accounts" options={{ title: 'บัญชี', tabBarLabel: 'บัญชี' }} />
      <Tabs.Screen name="settings" options={{ title: 'ตั้งค่า', tabBarLabel: 'ตั้งค่า' }} />
    </Tabs>
  );
}
