import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FadeIn, GridLoader, PressScale, Shake, ShakeHandle } from './motion';
import { VAULT, VaultDial } from './VaultDial';

export const PIN_LENGTH = 6;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/**
 * 6-digit PIN entry on a safe dial (see VaultDial). Calls onComplete once all digits are in and clears
 * them after it settles; `granted` shows the unlocked dial. On web the number keys and Backspace work
 * too (turn off with listenKeys when another pad is on top).
 */
export function PinPad({
  title,
  subtitle,
  error,
  busy,
  granted,
  onComplete,
  footer,
  listenKeys = true,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy?: boolean;
  granted?: boolean;
  onComplete: (pin: string) => Promise<void> | void;
  footer?: ReactNode;
  listenKeys?: boolean;
}) {
  const [digits, setDigits] = useState('');
  const { width } = useWindowDimensions();
  const dialSize = Math.min(320, width - 48);
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
      <Text style={styles.title}>{granted ? 'ปลดล็อกแล้ว' : title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <Shake ref={shaker}>
        <VaultDial
          digits={digits}
          length={PIN_LENGTH}
          size={dialSize}
          mode={granted ? 'granted' : error && digits.length === 0 ? 'denied' : 'idle'}
        />
      </Shake>
      <View style={styles.status}>
        {busy && !granted ? <GridLoader size={22} /> : !!error && !granted && <Text style={styles.error}>{error}</Text>}
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

// Always dark (a vault), whatever the app theme; on a light page it shows as a dark panel.
const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    paddingHorizontal: 16,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    backgroundColor: VAULT.bg,
    borderRadius: 28,
  },
  title: { fontSize: 20, fontWeight: '800', color: VAULT.text, textAlign: 'center' },
  subtitle: { color: VAULT.muted, textAlign: 'center', marginBottom: 6 },
  status: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: VAULT.red, textAlign: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 70 + 2 * 14, gap: 12, columnGap: 14 }, // 3 keys per row
  key: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  keyDigit: {
    backgroundColor: '#1d1713',
    borderWidth: 1,
    borderColor: 'rgba(233, 181, 98, 0.22)',
    boxShadow: '0px 6px 14px rgba(0, 0, 0, 0.45)',
  },
  keyText: { fontSize: 26, fontWeight: '600', color: VAULT.text },
});
