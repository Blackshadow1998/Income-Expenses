import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { COLORS } from '../format';
import { PinPad } from './PinPad';
import { VAULT } from './VaultDial';
import { Button, Card, ErrorBox, Loading } from './ui';
import { t } from '../i18n';

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

/** After signing in with a temporary password: a new password must be set before anything else. */
export function NewPasswordScreen() {
  const { tempPassword, replaceTempPassword, signOut } = useAuth();
  const [current, setCurrent] = useState(tempPassword);
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (next.length < 8) return setError(t('auth.pwTooShort'));
    if (next !== next2) return setError(t('auth.pwMismatch'));
    if (next === current) return setError(t('auth.pwSameAsTemp'));
    setBusy(true);
    try {
      await replaceTempPassword(current, next);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.newPassword}>
      <Text style={{ fontSize: 40, textAlign: 'center' }}>🔑</Text>
      <Text style={styles.title}>{t('auth.newPwTitle')}</Text>
      <Text style={styles.sub}>{t('auth.newPwSub')}</Text>
      <Card style={{ gap: 10 }}>
        {!tempPassword && <PasswordInput placeholder={t('auth.tempPw')} value={current} onChangeText={setCurrent} />}
        <PasswordInput placeholder={t('auth.newPw')} value={next} onChangeText={setNext} />
        <PasswordInput placeholder={t('auth.newPw2')} value={next2} onChangeText={setNext2} onSubmitEditing={save} />
        {!!error && <Text style={{ color: COLORS.out }}>{error}</Text>}
        <Button title={busy ? t('common.saving') : t('auth.saveNewPw')} onPress={save} disabled={busy} />
      </Card>
      <FooterLink title={t('common.signOut')} onPress={signOut} />
    </View>
  );
}

function PasswordInput(props: { placeholder: string; value: string; onChangeText: (v: string) => void; onSubmitEditing?: () => void }) {
  return (
    <TextInput
      {...props}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={COLORS.muted}
      style={styles.input}
    />
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
      setError(t('pin.mismatch'));
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
      title={first === null ? t('pin.setTitle') : t('pin.confirmTitle')}
      subtitle={first === null ? t('pin.setSub', { name: user?.name ?? '' }) : undefined}
      error={error}
      busy={busy}
      onComplete={onComplete}
      footer={<FooterLink title={t('common.signOut')} onPress={signOut} />}
    />
  );
}

/** Ask for the PIN after an app start or 5 minutes without use. Shown over the app, which keeps its state. */
export function PinLockScreen() {
  const { unlock, forgotPin, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(false);

  const onComplete = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      // Let the dial show "unlocked" for a moment before the app appears.
      await unlock(pin, async () => {
        setGranted(true);
        await new Promise((r) => setTimeout(r, 1100));
      });
    } catch (e) {
      // After too many wrong PINs the session is gone and the sign-in screen replaces this one.
      if (!(e instanceof ApiError && e.code === 'unauthenticated')) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PinPad
      title={t('pin.unlockTitle')}
      subtitle={user ? t('pin.hello', { name: user.name }) : undefined}
      error={error}
      busy={busy}
      granted={granted}
      onComplete={onComplete}
      footer={<FooterLink title={t('pin.forgot')} onPress={forgotPin} />}
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

/** Full-screen cover for the PIN screens, drawn above the app's navigator. `vault` = the dark PIN look. */
export function Overlay({ children, vault }: { children: React.ReactNode; vault?: boolean }) {
  return (
    <View style={[styles.overlay, vault && { backgroundColor: VAULT.bg }]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>{children}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: COLORS.bg, zIndex: 1000 },
  link: { color: VAULT.gold, textAlign: 'center', fontWeight: '600' }, // footer of the (dark) PIN pad
  newPassword: { gap: 12, padding: 24, width: '100%', maxWidth: 400, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  sub: { color: COLORS.muted, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.input,
  },
});
