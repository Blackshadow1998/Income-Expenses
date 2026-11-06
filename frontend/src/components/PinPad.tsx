import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../format';

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
  onCompleteRef.current = onComplete;

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
    <View style={styles.wrap}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <View style={styles.dots} accessibilityLabel={`ใส่แล้ว ${digits.length} จาก ${PIN_LENGTH} หลัก`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[styles.dot, i < digits.length && styles.dotFilled]} />
        ))}
      </View>
      <View style={styles.status}>
        {busy ? <ActivityIndicator color={COLORS.primary} /> : !!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.keypad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              onPress={() => press(k)}
              accessibilityLabel={k === '⌫' ? 'ลบตัวเลข' : k}
              style={({ pressed }) => [styles.key, k !== '⌫' && styles.keyDigit, pressed && styles.keyPressed]}
            >
              <Text style={[styles.keyText, k === '⌫' && { fontSize: 22 }]}>{k}</Text>
            </Pressable>
          ),
        )}
      </View>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, padding: 24, width: '100%', maxWidth: 360, alignSelf: 'center' },
  lock: { fontSize: 32 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  subtitle: { color: COLORS.muted, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 14, marginTop: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: COLORS.primary },
  dotFilled: { backgroundColor: COLORS.primary },
  status: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: COLORS.out, textAlign: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 76 + 2 * 12, gap: 12 }, // 3 keys per row
  key: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  keyDigit: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  keyPressed: { backgroundColor: '#eef0ff' },
  keyText: { fontSize: 28, fontWeight: '600', color: COLORS.text },
});
