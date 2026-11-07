import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View } from 'react-native';
import { AuthProvider, useAuth } from '@/auth';
import {
  LoadingScreen, NewPasswordScreen, OfflineScreen, Overlay, PinLockScreen, PinSetupScreen, SignInScreen,
} from '@/components/AuthScreens';
import { COLORS, IS_DARK } from '@/format';

// Behind the app on web (overscroll, browser chrome) match the theme too.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.style.backgroundColor = COLORS.bg;
  document.body.style.backgroundColor = COLORS.bg;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style={IS_DARK ? 'light' : 'dark'} />
      <Gate />
    </AuthProvider>
  );
}

/**
 * The app itself is mounted only once someone is signed in (and remounted per user, so no screen
 * keeps another user's data). The PIN screens cover it instead of replacing it, so an idle lock
 * doesn't lose what was on screen, e.g. a half-filled form.
 */
function Gate() {
  const { status, user, touch } = useAuth();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'offline') return <OfflineScreen />;
  if (status === 'signedOut' || !user) return <SignInScreen />;

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        touch();
        return false;
      }}
    >
      <Stack
        key={user.id}
        screenOptions={{
          contentStyle: { backgroundColor: COLORS.bg },
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: COLORS.bg },
          headerTitleStyle: { fontWeight: '800', color: COLORS.text },
          headerTintColor: COLORS.primary,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="transaction" options={{ title: 'รายการ' }} />
        <Stack.Screen name="account" options={{ title: 'บัญชี' }} />
        <Stack.Screen name="change-pin" options={{ title: 'เปลี่ยน PIN' }} />
        <Stack.Screen name="transfer" options={{ title: 'โอนระหว่างบัญชี' }} />
        <Stack.Screen name="change-password" options={{ title: 'เปลี่ยนรหัสผ่าน' }} />
        <Stack.Screen name="subcategories" options={{ title: 'จัดการรายการ' }} />
        <Stack.Screen name="budgets" options={{ title: 'งบประมาณ' }} />
        <Stack.Screen name="recurring" options={{ title: 'รายการประจำ' }} />
        <Stack.Screen name="debts" options={{ title: 'หนี้ ให้ยืม / กู้' }} />
        <Stack.Screen name="search" options={{ title: 'ค้นหารายการ' }} />
      </Stack>
      {status === 'needsPassword' && (
        <Overlay>
          <NewPasswordScreen />
        </Overlay>
      )}
      {status === 'needsPin' && (
        <Overlay>
          <PinSetupScreen />
        </Overlay>
      )}
      {status === 'locked' && (
        <Overlay>
          <PinLockScreen />
        </Overlay>
      )}
    </View>
  );
}
