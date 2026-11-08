import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View } from 'react-native';
import { AuthProvider, useAuth } from '@/auth';
import {
  LoadingScreen, NewPasswordScreen, OfflineScreen, Overlay, PinLockScreen, PinSetupScreen, SignInScreen,
} from '@/components/AuthScreens';
import { COLORS, IS_DARK } from '@/format';
import { LANG, t } from '@/i18n';

// Theme and language are both read synchronously at import time (before the first render), so no
// screen is ever drawn in the wrong palette or language.
// Behind the app on web (overscroll, browser chrome) match the theme too.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.style.backgroundColor = COLORS.bg;
  document.body.style.backgroundColor = COLORS.bg;
  document.documentElement.lang = LANG;
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
        <Stack.Screen name="transaction" options={{ title: t('screen.transaction') }} />
        <Stack.Screen name="account" options={{ title: t('screen.account') }} />
        <Stack.Screen name="change-pin" options={{ title: t('screen.changePin') }} />
        <Stack.Screen name="transfer" options={{ title: t('screen.transfer') }} />
        <Stack.Screen name="change-password" options={{ title: t('screen.changePassword') }} />
        <Stack.Screen name="subcategories" options={{ title: t('screen.subcategories') }} />
        <Stack.Screen name="budgets" options={{ title: t('screen.budgets') }} />
        <Stack.Screen name="recurring" options={{ title: t('screen.recurring') }} />
        <Stack.Screen name="slip-rules" options={{ title: t('screen.slipRules') }} />
        <Stack.Screen name="debts" options={{ title: t('screen.debts') }} />
        <Stack.Screen name="search" options={{ title: t('screen.search') }} />
        <Stack.Screen name="trip" options={{ title: t('screen.trip') }} />
        <Stack.Screen name="trip-bill" options={{ title: t('screen.tripBill') }} />
        <Stack.Screen name="trip-payment" options={{ title: t('screen.tripPayment') }} />
      </Stack>
      {status === 'needsPassword' && (
        <Overlay>
          <NewPasswordScreen />
        </Overlay>
      )}
      {status === 'needsPin' && (
        <Overlay vault>
          <PinSetupScreen />
        </Overlay>
      )}
      {status === 'locked' && (
        <Overlay vault>
          <PinLockScreen />
        </Overlay>
      )}
    </View>
  );
}
