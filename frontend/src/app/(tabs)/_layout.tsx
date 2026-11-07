import { Tabs } from 'expo-router';
import { makeSpotlightTabBar } from '@/components/SpotlightTabBar';
import { COLORS } from '@/format';

// "รายรับรายจ่าย" holds both the monthly and the yearly view (switched at the top of each);
// the yearly route has no button of its own.
const tabBar = makeSpotlightTabBar({ index: '📒', trips: '🧾', accounts: '🏦', settings: '⚙️' }, { yearly: 'index' });

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
      <Tabs.Screen name="index" options={{ title: 'รายรับรายจ่าย', tabBarLabel: 'รายรับรายจ่าย' }} />
      <Tabs.Screen name="trips" options={{ title: 'หารบิลทริป', tabBarLabel: 'หารบิล' }} />
      <Tabs.Screen name="accounts" options={{ title: 'บัญชี', tabBarLabel: 'บัญชี' }} />
      <Tabs.Screen name="settings" options={{ title: 'ตั้งค่า', tabBarLabel: 'ตั้งค่า' }} />
      <Tabs.Screen name="yearly" options={{ title: 'รายรับรายจ่าย', tabBarLabel: 'รายปี' }} />
    </Tabs>
  );
}
