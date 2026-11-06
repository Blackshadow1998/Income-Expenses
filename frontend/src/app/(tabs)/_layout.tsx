import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { COLORS } from '@/format';

const icon = (glyph: string) => () => <Text style={{ fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        headerTitleAlign: 'center',
        sceneStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'รายรับรายจ่าย', tabBarLabel: 'รายเดือน', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="yearly" options={{ title: 'สรุปรายปี', tabBarLabel: 'สรุปรายปี', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="accounts" options={{ title: 'บัญชี', tabBarLabel: 'บัญชี', tabBarIcon: icon('🏦') }} />
    </Tabs>
  );
}
