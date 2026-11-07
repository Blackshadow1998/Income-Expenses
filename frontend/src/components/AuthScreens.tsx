import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { COLORS } from '../format';
import { PinPad } from './PinPad';
import { ErrorBox, Loading } from './ui';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LoadingScreen() {
  return (
    <View style={styles.center}>
      <Loading />
    </View>
  );
}

export function OfflineScreen() {
  const { error, retry } = useAuth();
  return (
    <View style={[styles.center, { padding: 16 }]}>
      <ErrorBox message={error ?? ''} onRetry={retry} />
    </View>
  );
}

export { SignInScreen } from './SignInScreen';

/** Choose the PIN: after sign-up, or after signing in from "forgot PIN". Shown over the app. */
export function PinSetupScreen() {
  const { setPin, signOut, user } = useAuth();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onComplete = async (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setError('PIN สองครั้งไม่ตรงกัน กรุณาตั้งใหม่');
      return;
    }
    setBusy(true);
    try {
      await setPin(pin);
    } catch (e) {
      setFirst(null);
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <PinPad
      title={first === null ? 'ตั้ง PIN 6 หลัก' : 'ยืนยัน PIN อีกครั้ง'}
      subtitle={first === null ? `${user?.name ?? ''} — ใช้ PIN นี้ปลดล็อกแอปเมื่อเปิดใหม่หรือไม่ได้ใช้ 5 นาที` : undefined}
      error={error}
      busy={busy}
      onComplete={onComplete}
      footer={<FooterLink title="ออกจากระบบ" onPress={signOut} />}
    />
  );
}

/** Ask for the PIN after an app start or 5 minutes without use. Shown over the app, which keeps its state. */
export function PinLockScreen() {
  const { unlock, forgotPin, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onComplete = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      await unlock(pin);
    } catch (e) {
      // After too many wrong PINs the session is gone and the sign-in screen replaces this one.
      if (!(e instanceof ApiError && e.code === 'unauthenticated')) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PinPad
      title="ใส่ PIN เพื่อปลดล็อก"
      subtitle={user ? `สวัสดี ${user.name}` : undefined}
      error={error}
      busy={busy}
      onComplete={onComplete}
      footer={<FooterLink title="ลืม PIN? เข้าสู่ระบบด้วยรหัสผ่าน" onPress={forgotPin} />}
    />
  );
}

function FooterLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginTop: 12 }}>
      <Text style={styles.link}>{title}</Text>
    </Pressable>
  );
}

/** Full-screen cover for the PIN screens, drawn above the app's navigator. */
export function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.overlay}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>{children}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: COLORS.bg, zIndex: 1000 },
  link: { color: COLORS.primary, textAlign: 'center', fontWeight: '600' },
});
