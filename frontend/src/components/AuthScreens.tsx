import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { COLORS } from '../format';
import { PinPad } from './PinPad';
import { Button, Card, ErrorBox, Loading } from './ui';

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

/** Username + password sign-in, with a switch to sign-up. */
export function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!username.trim() || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }
    if (signup && password !== password2) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      if (signup) await signUp(name, username, password);
      else await signIn(username, password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setError(null);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
        <Text style={styles.appTitle}>รายรับรายจ่าย</Text>
        <Card style={{ gap: 12 }}>
          <Text style={styles.h2}>{signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</Text>
          {signup && (
            <Field label="ชื่อที่แสดง" value={name} onChangeText={setName} placeholder="เช่น เอก" autoComplete="name" />
          )}
          <Field
            label="ชื่อผู้ใช้"
            value={username}
            onChangeText={setUsername}
            placeholder={signup ? 'a-z 0-9 . _ - อย่างน้อย 3 ตัว' : undefined}
            autoComplete="username"
          />
          <Field
            label="รหัสผ่าน"
            value={password}
            onChangeText={setPassword}
            secure
            placeholder={signup ? 'อย่างน้อย 8 ตัวอักษร' : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            onSubmitEditing={signup ? undefined : submit}
          />
          {signup && (
            <Field
              label="ยืนยันรหัสผ่าน"
              value={password2}
              onChangeText={setPassword2}
              secure
              autoComplete="new-password"
              onSubmitEditing={submit}
            />
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button title={busy ? 'กำลังดำเนินการ…' : signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'} onPress={submit} disabled={busy} />
          <Pressable onPress={switchMode} hitSlop={8}>
            <Text style={styles.link}>{signup ? 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก'}</Text>
          </Pressable>
        </Card>
        {signup && (
          <Text style={styles.note}>หลังสมัครจะให้ตั้ง PIN 6 หลัก ไว้ปลดล็อกแอปครั้งต่อไป</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  secure,
  ...input
}: {
  label: string;
  secure?: boolean;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoComplete?: 'name' | 'username' | 'current-password' | 'new-password';
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#9ca3af"
        style={styles.input}
      />
    </View>
  );
}

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
  formPage: { flexGrow: 1, justifyContent: 'center', padding: 16, gap: 12, maxWidth: 420, width: '100%', alignSelf: 'center' },
  appTitle: { fontSize: 26, fontWeight: '800', color: COLORS.primary, textAlign: 'center', marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  label: { color: COLORS.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: '#fff',
  },
  error: { color: COLORS.out },
  link: { color: COLORS.primary, textAlign: 'center', fontWeight: '600' },
  note: { color: COLORS.muted, textAlign: 'center', fontSize: 13 },
});
