import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { COLORS, GRADIENTS, SHADOW } from '../format';
import { FadeIn, PressScale, Shake, ShakeHandle } from './motion';

export const PIN_LENGTH = 6;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/**
 * Bank-app style 6-digit PIN entry. Calls onComplete once all digits are in and clears them after it
 * settles. On web the number keys and Backspace work too (turn off with listenKeys when another pad is on top).
 */
export function PinPad({
  title,
  subtitle,
  error,
  busy,
  onComplete,
  footer,
  listenKeys = true,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy?: boolean;
  onComplete: (pin: string) => Promise<void> | void;
  footer?: ReactNode;
  listenKeys?: boolean;
}) {
  const [digits, setDigits] = useState('');
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const press = useCallback(
    (key: string) => {
      if (busy) return;
      if (key === '⌫') setDigits((d) => d.slice(0, -1));
      else if (/^[0-9]$/.test(key)) setDigits((d) => (d.length < PIN_LENGTH ? d + key : d));
    },
    [busy],
  );

  useEffect(() => {
    if (digits.length !== PIN_LENGTH) return;
    Promise.resolve(onCompleteRef.current(digits)).finally(() => setDigits(''));
  }, [digits]);

  const shaker = useRef<ShakeHandle>(null);
  useEffect(() => {
    if (error) shaker.current?.shake();
  }, [error]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !listenKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') press('⌫');
      else press(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, listenKeys]);

  return (
    <FadeIn style={styles.wrap}>
      <LinearGradient colors={GRADIENTS.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.lock}>
        <Text style={{ fontSize: 28 }}>🔒</Text>
      </LinearGradient>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <Shake ref={shaker}>
        <View style={styles.dots} accessibilityLabel={`ใส่แล้ว ${digits.length} จาก ${PIN_LENGTH} หลัก`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <Dot key={i} filled={i < digits.length} />
          ))}
        </View>
      </Shake>
      <View style={styles.status}>
        {busy ? <ActivityIndicator color={COLORS.primary} /> : !!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.keypad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <PressScale
              key={i}
              onPress={() => press(k)}
              accessibilityLabel={k === '⌫' ? 'ลบตัวเลข' : k}
              scaleTo={0.88}
              style={[styles.key, k !== '⌫' && styles.keyDigit]}
            >
              <Text style={[styles.keyText, k === '⌫' && { fontSize: 22 }]}>{k}</Text>
            </PressScale>
          ),
        )}
      </View>
      {footer}
    </FadeIn>
  );
}

/** PIN dot that pops when a digit is entered. */
function Dot({ filled }: { filled: boolean }) {
  const v = useState(() => new Animated.Value(filled ? 1 : 0))[0];
  useEffect(() => {
    Animated.spring(v, { toValue: filled ? 1 : 0, speed: 30, bounciness: 14, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, filled]);
  return (
    <View style={styles.dot}>
      <Animated.View style={[styles.dotFill, { transform: [{ scale: v }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, padding: 24, width: '100%', maxWidth: 360, alignSelf: 'center' },
  lock: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    boxShadow: '0px 10px 24px rgba(139, 94, 60, 0.35)',
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  subtitle: { color: COLORS.muted, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 14, marginTop: 12 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFill: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primary },
  status: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: COLORS.out, textAlign: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 76 + 2 * 12, gap: 12 }, // 3 keys per row
  key: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  keyDigit: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, ...SHADOW },
  keyText: { fontSize: 28, fontWeight: '600', color: COLORS.text },
});
