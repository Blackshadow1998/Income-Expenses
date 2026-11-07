import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutRectangle, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FadeIn, GridLoader, PressScale, Shake, ShakeHandle } from './motion';
import { ringTop, VAULT, VaultDial } from './VaultDial';

export const PIN_LENGTH = 6;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
const KEY = 70;
const COL_GAP = 14;
const ROW_GAP = 12;

type Point = { x: number; y: number };
/** A digit flying from its key into the dial ('in') or dropping out of it on delete ('out'). */
type Flight = { id: number; digit: string; from: Point; to: Point; kind: 'in' | 'out'; delay: number };

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

  // Where the dial and keypad sit inside the pad, for the flying digits.
  const dialBox = useRef<LayoutRectangle | null>(null);
  const padBox = useRef<LayoutRectangle | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextFlight = useRef(0);
  const launch = useCallback((digit: string, from: Point, to: Point, kind: Flight['kind'], delay = 0) => {
    setFlights((list) => [...list, { id: nextFlight.current++, digit, from, to, kind, delay }]);
  }, []);
  const landed = useCallback((id: number) => setFlights((list) => list.filter((f) => f.id !== id)), []);
  const ringAt = useCallback(
    (i: number): Point | null => {
      const d = dialBox.current;
      if (!d) return null;
      const p = ringTop(dialSize, PIN_LENGTH, i);
      return { x: d.x + p.x, y: d.y + p.y };
    },
    [dialSize],
  );
  const keyAt = useCallback((key: string): Point | null => {
    const p = padBox.current;
    const i = KEYS.indexOf(key);
    if (!p || i < 0) return null;
    return { x: p.x + (i % 3) * (KEY + COL_GAP) + KEY / 2, y: p.y + Math.floor(i / 3) * (KEY + ROW_GAP) + KEY / 2 };
  }, []);

  // Kept in step with `digits` by the handlers, so quick key presses see the latest value.
  const digitsRef = useRef('');
  const press = useCallback(
    (key: string) => {
      if (busy) return;
      const cur = digitsRef.current;
      let next = cur;
      if (key === '⌫' || key === 'clear') {
        const keep = key === 'clear' ? 0 : Math.max(0, cur.length - 1);
        // Each removed digit drops out of its ring, the last one first.
        for (let i = cur.length - 1, n = 0; i >= keep; i--, n++) {
          const from = ringAt(i);
          if (from) launch(cur[i], from, { x: from.x + 14, y: from.y + 230 }, 'out', n * 70);
        }
        next = cur.slice(0, keep);
      } else if (/^[0-9]$/.test(key) && cur.length < PIN_LENGTH) {
        const from = keyAt(key);
        const to = ringAt(cur.length);
        if (from && to) launch(key, from, to, 'in');
        next = cur + key;
      }
      if (next === cur) return;
      digitsRef.current = next;
      setDigits(next);
    },
    [busy, launch, ringAt, keyAt],
  );

  useEffect(() => {
    if (digits.length !== PIN_LENGTH) return;
    Promise.resolve(onCompleteRef.current(digits)).finally(() => {
      digitsRef.current = '';
      setDigits('');
    });
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

      <View onLayout={(e) => (dialBox.current = e.nativeEvent.layout)}>
        <Shake ref={shaker}>
          <VaultDial
            digits={digits}
            length={PIN_LENGTH}
            size={dialSize}
            mode={granted ? 'granted' : error && digits.length === 0 ? 'denied' : 'idle'}
          />
        </Shake>
      </View>
      <View style={styles.status}>
        {busy && !granted ? <GridLoader size={22} /> : !!error && !granted && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.keypad} onLayout={(e) => (padBox.current = e.nativeEvent.layout)}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : k === '⌫' ? (
            <PressScale
              key={i}
              onPress={() => press('⌫')}
              onLongPress={() => press('clear')}
              disabled={digits.length === 0 || granted}
              accessibilityLabel="ลบตัวเลข (กดค้างเพื่อลบทั้งหมด)"
              scaleTo={0.88}
              style={[styles.key, styles.keyDelete]}
            >
              <DeleteIcon />
            </PressScale>
          ) : (
            <PressScale key={i} onPress={() => press(k)} accessibilityLabel={k} scaleTo={0.88} style={[styles.key, styles.keyDigit]}>
              <Text style={styles.keyText}>{k}</Text>
            </PressScale>
          ),
        )}
      </View>
      {footer}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {flights.map((f) => (
          <FlyingDigit key={f.id} flight={f} onDone={landed} />
        ))}
      </View>
    </FadeIn>
  );
}

/** A digit shooting up from its key into its ring (curving a little), or dropping and spinning away. */
function FlyingDigit({ flight, onDone }: { flight: Flight; onDone: (id: number) => void }) {
  const v = useState(() => new Animated.Value(0))[0];
  const into = flight.kind === 'in';
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: into ? 560 : 650,
      delay: flight.delay,
      easing: into ? Easing.inOut(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => onDone(flight.id));
  }, [v, into, flight, onDone]);
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  return (
    <Animated.Text
      style={[
        styles.flying,
        {
          left: flight.from.x - 20,
          top: flight.from.y - 20,
          color: into ? VAULT.gold : '#e58a7c',
          textShadowColor: into ? VAULT.gold : 'transparent',
          opacity: v.interpolate(into ? { inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] } : { inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, into ? dx * 0.25 : dx * 0.4, dx] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: into ? [1.3, 0.55] : [1, 0.8] }) },
            { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', into ? '0deg' : '120deg'] }) },
          ],
        },
      ]}
    >
      {flight.digit}
    </Animated.Text>
  );
}

/** Backspace tag (arrow-shaped plate with an ×), drawn with views so it looks the same on every font. */
function DeleteIcon() {
  return (
    <View style={styles.delIcon}>
      <View style={styles.delArrow} />
      <View style={styles.delPlate}>
        <Text style={styles.delX}>✕</Text>
      </View>
    </View>
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
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * KEY + 2 * COL_GAP, rowGap: ROW_GAP, columnGap: COL_GAP }, // 3 keys per row
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  flying: {
    position: 'absolute',
    width: 40,
    height: 40,
    lineHeight: 40,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 0 },
  },
  keyDigit: {
    backgroundColor: '#1d1713',
    borderWidth: 1,
    borderColor: 'rgba(233, 181, 98, 0.22)',
    boxShadow: '0px 6px 14px rgba(0, 0, 0, 0.45)',
  },
  keyText: { fontSize: 26, fontWeight: '600', color: VAULT.text },
  keyDelete: { borderWidth: 1, borderColor: 'rgba(233, 181, 98, 0.35)', backgroundColor: 'rgba(233, 181, 98, 0.08)' },
  delIcon: { flexDirection: 'row', alignItems: 'center' },
  delArrow: {
    width: 0,
    height: 0,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderRightWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: VAULT.gold,
  },
  delPlate: {
    height: 22,
    paddingHorizontal: 6,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: VAULT.gold,
    justifyContent: 'center',
  },
  delX: { fontSize: 12, fontWeight: '900', color: VAULT.bg, lineHeight: 14 },
});
