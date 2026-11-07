import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, LayoutChangeEvent, LayoutRectangle, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { Firefly, Point } from './Firefly';
import { GoogleButton } from './GoogleButton';
import { FadeIn, PressScale, Shake, ShakeHandle } from './motion';

type Mode = 'login' | 'signup' | 'forgot';
type FieldKey = 'name' | 'email' | 'username' | 'password' | 'password2';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const NIGHT = ['#120c09', '#2b1d16', '#4a2f22'] as const;
const GOLD = '#facc15';
const TEXT_X = 46; // where typed text starts inside a field (after the icon)
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Night-sky sign-in / sign-up. A firefly lives in the form: it sits on the field being typed in and
 * follows the text, flies to the eye icon when the password is shown, and lights up the button on submit.
 */
export function SignInScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [values, setValues] = useState<Record<FieldKey, string>>({ name: '', email: '', username: '', password: '', password2: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<FieldKey | null>(null);
  const [eyeVisit, setEyeVisit] = useState<FieldKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [layouts, setLayouts] = useState<Partial<Record<FieldKey | 'button' | 'form', LayoutRectangle>>>({});
  const shaker = useRef<ShakeHandle>(null);
  const signup = mode === 'signup';

  const set = (k: FieldKey) => (v: string) => setValues((s) => ({ ...s, [k]: v }));
  const measure = (k: FieldKey | 'button' | 'form') => (e: LayoutChangeEvent) => {
    const l = e.nativeEvent.layout;
    setLayouts((s) => ({ ...s, [k]: l }));
  };

  // Where the firefly should be right now.
  const target = useMemo<Point | null>(() => {
    if (busy && layouts.button) return { x: layouts.button.x + layouts.button.width / 2, y: layouts.button.y + layouts.button.height / 2 };
    const at = eyeVisit ?? focus;
    const l = at && layouts[at];
    if (!at || !l) return null;
    if (eyeVisit) return { x: l.x + l.width - 26, y: l.y + l.height / 2 };
    const secret = (at === 'password' || at === 'password2') && !showPassword;
    const charWidth = secret ? 9 : 8.4;
    const x = l.x + TEXT_X + values[at].length * charWidth + 6;
    return { x: Math.min(x, l.x + l.width - (at.startsWith('password') ? 58 : 22)), y: l.y + l.height / 2 + 8 };
  }, [busy, focus, eyeVisit, layouts, values, showPassword]);

  const home = useMemo<Point>(() => ({ x: (layouts.form?.width ?? 320) - 48, y: 30 }), [layouts.form?.width]);

  const toggleEye = (k: FieldKey) => {
    setShowPassword((v) => !v);
    setEyeVisit(k);
    setTimeout(() => setEyeVisit(null), 650);
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    const fail = (msg: string) => {
      setError(msg);
      shaker.current?.shake();
    };
    if (!values.username.trim() || !values.password) return fail('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    if (signup && !EMAIL_RE.test(values.email.trim())) return fail('กรุณากรอกอีเมลให้ถูกต้อง (ใช้ตอนลืมรหัสผ่าน)');
    if (signup && values.password !== values.password2) return fail('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    setBusy(true);
    try {
      if (signup) await signUp(values.name, values.email.trim(), values.username, values.password);
      else await signIn(values.username, values.password);
    } catch (e) {
      setBusy(false);
      fail(errorText(e));
    }
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError(null);
    setFocus(null);
  };

  // Each field's wrapper is a direct child of the card, so its layout is in the firefly's coordinates.
  const field = (
    k: FieldKey,
    label: string,
    icon: string,
    opts: { secret?: boolean; hint?: string; auto?: AutoComplete; last?: boolean; appear?: boolean } = {},
  ) => (
    <View key={k} onLayout={measure(k)}>
      <FadeIn from={opts.appear ? -10 : 0} delay={0}>
      <AuthField
        label={label}
        icon={icon}
        hint={opts.hint}
        value={values[k]}
        onChangeText={set(k)}
        secret={opts.secret && !showPassword}
        onEye={opts.secret ? () => toggleEye(k) : undefined}
        eyeOpen={showPassword}
        focused={focus === k}
        onFocus={() => setFocus(k)}
        onBlur={() => setFocus((f) => (f === k ? null : f))}
        autoComplete={opts.auto}
        onSubmitEditing={opts.last ? submit : undefined}
      />
      </FadeIn>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={NIGHT} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      <Stars />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <FadeIn style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 40 }}>{mode === 'forgot' ? '🔑' : '💰'}</Text>
          <Text style={styles.title}>{HEADINGS[mode][0]}</Text>
          <Text style={styles.subtitle}>{HEADINGS[mode][1]}</Text>
        </FadeIn>

        <FadeIn delay={120}>
          <Shake ref={shaker}>
            <View style={styles.card} onLayout={measure('form')}>
              <Firefly target={target} home={home} />
              {mode === 'forgot' ? (
                <ForgotPassword
                  onBack={() => switchMode('login')}
                  onDone={(username, temp) => {
                    setValues((s) => ({ ...s, username, password: temp }));
                    switchMode('login');
                  }}
                />
              ) : (
              <>
              <Segment mode={mode} onChange={switchMode} />

              {signup && field('name', 'ชื่อที่แสดง', '😊', { hint: 'เช่น เอก', auto: 'name', appear: true })}
              {signup && field('email', 'อีเมล (ใช้ตอนลืมรหัสผ่าน)', '✉️', { hint: 'you@example.com', auto: 'email', appear: true })}
              {field('username', 'ชื่อผู้ใช้', '👤', { hint: signup ? 'a-z 0-9 . _ - อย่างน้อย 3 ตัว' : undefined, auto: 'username' })}
              {field('password', 'รหัสผ่าน', '🔒', {
                secret: true,
                hint: signup ? 'อย่างน้อย 8 ตัวอักษร' : undefined,
                auto: signup ? 'new-password' : 'current-password',
                last: !signup,
              })}
              {signup && field('password2', 'ยืนยันรหัสผ่าน', '🔁', { secret: true, auto: 'new-password', last: true, appear: true })}

              {!!error && (
                <FadeIn key={error} from={-6}>
                  <Text style={styles.error}>⚠️ {error}</Text>
                </FadeIn>
              )}

              <View onLayout={measure('button')}>
                <SubmitButton title={signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'} busy={busy} onPress={submit} />
              </View>

              <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.dividerText}>หรือ</Text>
                <View style={styles.line} />
              </View>
              <GoogleButton
                text={signup ? 'continue_with' : 'signin_with'}
                onCredential={async (credential) => {
                  setError(null);
                  try {
                    await signInWithGoogle(credential);
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              />
              <Pressable onPress={() => switchMode('forgot')} hitSlop={8}>
                <Text style={[styles.link, { textAlign: 'center' }]}>ลืมรหัสผ่าน?</Text>
              </Pressable>
              </>
              )}
            </View>
          </Shake>
        </FadeIn>
        {signup && <Text style={styles.note}>หลังสมัครจะให้ตั้ง PIN 6 หลัก ไว้ปลดล็อกแอปครั้งต่อไป</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const HEADINGS: Record<Mode, [string, string]> = {
  login: ['ยินดีต้อนรับกลับมา', 'เข้าสู่ระบบเพื่อดูยอดเงินของคุณ'],
  signup: ['เริ่มจดรายรับรายจ่าย', 'สมัครฟรี ใช้ได้ทันที'],
  forgot: ['ลืมรหัสผ่าน', 'รับรหัสยืนยันทางอีเมลที่ใช้สมัคร'],
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * E-mail → 6-digit code (3 minutes) → temporary password (24 hours). The server answers the same
 * for unknown addresses, so this screen never says whether an e-mail has an account.
 */
function ForgotPassword({ onBack, onDone }: { onBack: () => void; onDone: (username: string, temp: string) => void }) {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [focus, setFocus] = useState<'email' | 'code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [deadline, setDeadline] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<{ username: string; temp_password: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [step]);

  const send = async () => {
    if (busy) return;
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError('กรุณากรอกอีเมลให้ถูกต้อง');
    setBusy(true);
    try {
      const r = await api.auth.forgot(email.trim());
      const t = Date.now();
      setMessage(r.message);
      setDeadline(t + r.expires_in * 1000);
      setResendAt(t + 60_000);
      setNow(t);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('กรุณากรอกรหัส 6 หลัก');
    if (now > deadline) return setError('รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่');
    setBusy(true);
    try {
      setResult(await api.auth.verifyForgot(email.trim(), code));
      setStep('done');
    } catch (e) {
      setError(errorText(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (Platform.OS === 'web' && result) {
      await navigator.clipboard?.writeText(result.temp_password).catch(() => {});
      setCopied(true);
    }
  };

  const errorLine = !!error && (
    <FadeIn key={error} from={-6}>
      <Text style={styles.error}>⚠️ {error}</Text>
    </FadeIn>
  );

  if (step === 'done' && result) {
    const until = new Date(result.expires_at);
    return (
      <FadeIn style={{ gap: 14 }}>
        <Text style={styles.forgotText}>รหัสผ่านสำรองของ</Text>
        <Text style={styles.username}>@{result.username}</Text>
        <Pressable onPress={copy} style={styles.tempBox} accessibilityLabel="คัดลอกรหัสผ่านสำรอง">
          <Text selectable style={styles.tempText}>{result.temp_password}</Text>
          {Platform.OS === 'web' && <Text style={styles.tempHint}>{copied ? '✓ คัดลอกแล้ว' : 'แตะเพื่อคัดลอก'}</Text>}
        </Pressable>
        <Text style={styles.forgotText}>
          ใช้ได้ถึง {until.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} (24 ชั่วโมง){'\n'}
          เข้าสู่ระบบด้วยรหัสนี้แล้วต้องตั้งรหัสผ่านใหม่ทันที หลังจากนั้นรหัสสำรองจะใช้ไม่ได้
        </Text>
        <SubmitButton title="เข้าสู่ระบบด้วยรหัสสำรอง" busy={false} onPress={() => onDone(result.username, result.temp_password)} />
      </FadeIn>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {step === 'email' ? (
        <>
          <Text style={styles.forgotText}>กรอกอีเมลที่ใช้สมัคร เราจะส่งรหัสยืนยัน 6 หลักไปให้ (ใช้ได้ 3 นาที)</Text>
          <AuthField
            label="อีเมล"
            icon="✉️"
            hint="you@example.com"
            value={email}
            onChangeText={setEmail}
            eyeOpen={false}
            focused={focus === 'email'}
            onFocus={() => setFocus('email')}
            onBlur={() => setFocus(null)}
            autoComplete="email"
            onSubmitEditing={send}
          />
          {errorLine}
          <SubmitButton title="ส่งรหัสยืนยัน" busy={busy} onPress={send} />
        </>
      ) : (
        <>
          <Text style={styles.forgotText}>{message}</Text>
          <Text style={styles.forgotText}>
            อีเมล: <Text style={{ color: '#fff', fontWeight: '700' }}>{email.trim()}</Text>
          </Text>
          <AuthField
            label="รหัสยืนยัน 6 หลัก"
            icon="🔢"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            eyeOpen={false}
            focused={focus === 'code'}
            onFocus={() => setFocus('code')}
            onBlur={() => setFocus(null)}
            autoComplete="one-time-code"
            onSubmitEditing={verify}
          />
          <Text style={[styles.forgotText, now > deadline && { color: '#fca5a5' }]}>
            {now > deadline ? 'รหัสหมดอายุแล้ว — กดขอรหัสใหม่' : `รหัสหมดอายุใน ${mmss(deadline - now)}`}
          </Text>
          {errorLine}
          <SubmitButton title="ยืนยันรหัส" busy={busy} onPress={verify} />
          <Pressable onPress={send} disabled={now < resendAt || busy} hitSlop={8}>
            <Text style={[styles.link, { textAlign: 'center' }, now < resendAt && { opacity: 0.45 }]}>
              {now < resendAt ? `ขอรหัสใหม่ได้ใน ${mmss(resendAt - now)}` : 'ขอรหัสใหม่'}
            </Text>
          </Pressable>
        </>
      )}
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.switch}>← กลับไปเข้าสู่ระบบ</Text>
      </Pressable>
    </View>
  );
}

type AutoComplete = 'name' | 'email' | 'username' | 'current-password' | 'new-password' | 'one-time-code';

/** Input with an icon and a label that floats up when focused or filled. */
function AuthField(props: {
  label: string;
  icon: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  secret?: boolean;
  onEye?: () => void;
  eyeOpen: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  autoComplete?: AutoComplete;
  onSubmitEditing?: () => void;
}) {
  const up = props.focused || props.value !== '';
  const [float] = useState(() => new Animated.Value(up ? 1 : 0));
  useEffect(() => {
    Animated.spring(float, { toValue: up ? 1 : 0, speed: 22, bounciness: 6, useNativeDriver: false }).start();
  }, [float, up]);

  return (
    <View style={[styles.field, props.focused && styles.fieldFocused]}>
      <Text style={styles.icon}>{props.icon}</Text>
      <Animated.Text
        pointerEvents="none"
        style={[
          styles.label,
          {
            top: float.interpolate({ inputRange: [0, 1], outputRange: [19, 7] }),
            fontSize: float.interpolate({ inputRange: [0, 1], outputRange: [15, 11] }),
            color: props.focused ? GOLD : 'rgba(226, 232, 240, 0.7)',
          },
        ]}
      >
        {props.label}
      </Animated.Text>
      <TextInput
        nativeID={`auth-${props.icon.codePointAt(0)}`} // the web focus ring is replaced by the gold border (index.html)
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        secureTextEntry={props.secret}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={props.autoComplete}
        keyboardType={props.autoComplete === 'email' ? 'email-address' : props.autoComplete === 'one-time-code' ? 'number-pad' : 'default'}
        onSubmitEditing={props.onSubmitEditing}
        placeholder={props.focused ? props.hint : undefined}
        placeholderTextColor="rgba(226, 232, 240, 0.35)"
        style={[styles.input, props.onEye && { paddingRight: 52 }]}
      />
      {props.onEye && (
        <PressScale
          onPress={props.onEye}
          hitSlop={8}
          scaleTo={0.8}
          containerStyle={styles.eye}
          style={styles.eyeInner}
          accessibilityLabel={props.eyeOpen ? 'ซ่อนรหัสผ่าน' : 'ดูรหัสผ่าน'}
        >
          <Text style={{ fontSize: 17 }}>{props.eyeOpen ? '🙈' : '👁️'}</Text>
        </PressScale>
      )}
    </View>
  );
}

/** Login / sign-up switch with a sliding pill. */
function Segment({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const [width, setWidth] = useState(0);
  const [pos] = useState(() => new Animated.Value(mode === 'login' ? 0 : 1));
  useEffect(() => {
    Animated.spring(pos, { toValue: mode === 'login' ? 0 : 1, speed: 20, bounciness: 8, useNativeDriver: false }).start();
  }, [pos, mode]);
  return (
    <View style={styles.segment} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Animated.View
          style={[styles.segPill, { width: width / 2 - 4, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, width / 2] }) }] }]}
        />
      )}
      {(['login', 'signup'] as const).map((m) => (
        <Pressable key={m} onPress={() => onChange(m)} style={styles.segBtn}>
          <Text style={[styles.segText, mode === m && { color: '#2b1d16' }]}>{m === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Gradient button that fills with warm light while it works (the firefly is sitting on it). */
function SubmitButton({ title, busy, onPress }: { title: string; busy: boolean; onPress: () => void }) {
  const [glow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(glow, { toValue: busy ? 1 : 0, duration: busy ? 650 : 250, useNativeDriver: false }).start();
  }, [glow, busy]);
  return (
    <PressScale onPress={onPress} disabled={busy} scaleTo={0.97} style={styles.button}>
      <LinearGradient colors={['#8b5e3c', '#c08552']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#fde68a', opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }) }]} />
      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </PressScale>
  );
}

const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: `${(i * 37) % 100}%` as const,
  top: `${(i * 53 + 7) % 92}%` as const,
  size: 1.5 + ((i * 7) % 3),
  delay: (i * 211) % 2400,
}));

/** Softly twinkling stars behind the form. */
function Stars() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {STARS.map((s, i) => (
        <Star key={i} {...s} />
      ))}
    </View>
  );
}

function Star({ left, top, size, delay }: (typeof STARS)[number]) {
  const [o] = useState(() => new Animated.Value(0.25));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(o, { toValue: 0.9, duration: 1400, useNativeDriver: false }),
        Animated.timing(o, { toValue: 0.25, duration: 1400, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o, delay]);
  return <Animated.View style={{ position: 'absolute', left, top, width: size, height: size, borderRadius: size, backgroundColor: '#fff', opacity: o }} />;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: 18, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: 'rgba(226, 232, 240, 0.75)', textAlign: 'center' },
  card: {
    gap: 14,
    padding: 20,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    boxShadow: '0px 20px 50px rgba(0, 0, 0, 0.45)',
  },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  segPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, backgroundColor: '#fde68a', boxShadow: '0px 0px 16px rgba(250, 204, 21, 0.55)' },
  segBtn: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  segText: { color: 'rgba(226, 232, 240, 0.85)', fontWeight: '800' },
  field: {
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  fieldFocused: { borderColor: 'rgba(250, 204, 21, 0.75)', boxShadow: '0px 0px 0px 3px rgba(250, 204, 21, 0.15)' },
  icon: { position: 'absolute', left: 14, top: 18, fontSize: 17 },
  label: { position: 'absolute', left: TEXT_X, fontWeight: '600' },
  input: { color: '#f8fafc', fontSize: 16, paddingLeft: TEXT_X, paddingRight: 14, paddingBottom: 9, paddingTop: 24, height: 58 },
  eye: { position: 'absolute', right: 10, top: 12 },
  eyeInner: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  link: { color: GOLD, fontWeight: '700' },
  error: { color: '#fca5a5', textAlign: 'center' },
  button: { height: 54, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 10px 24px rgba(139, 94, 60, 0.45)' },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  dividerText: { color: 'rgba(226, 232, 240, 0.55)', fontSize: 12 },
  switch: { color: 'rgba(226, 232, 240, 0.8)', textAlign: 'center' },
  note: { color: 'rgba(226, 232, 240, 0.6)', textAlign: 'center', fontSize: 13 },
  forgotText: { color: 'rgba(226, 232, 240, 0.8)', textAlign: 'center', lineHeight: 21 },
  username: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: -8 },
  tempBox: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(250, 204, 21, 0.6)',
    backgroundColor: 'rgba(250, 204, 21, 0.08)',
  },
  tempText: { color: '#fde68a', fontSize: 26, fontWeight: '800', letterSpacing: 2, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  tempHint: { color: 'rgba(226, 232, 240, 0.6)', fontSize: 12 },
});
