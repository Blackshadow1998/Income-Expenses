import { Tabs } from 'expo-router';
import { makeSpotlightTabBar } from '@/components/SpotlightTabBar';
import { COLORS } from '@/format';
import { t } from '@/i18n';

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
      <Tabs.Screen name="index" options={{ title: t('tabs.ledger'), tabBarLabel: t('tabs.ledgerShort') }} />
      <Tabs.Screen name="trips" options={{ title: t('tabs.trips'), tabBarLabel: t('tabs.tripsShort') }} />
      <Tabs.Screen name="accounts" options={{ title: t('tabs.accounts'), tabBarLabel: t('tabs.accounts') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarLabel: t('tabs.settings') }} />
      <Tabs.Screen name="yearly" options={{ title: t('tabs.ledger'), tabBarLabel: t('tabs.yearly') }} />
    </Tabs>
  );
}
