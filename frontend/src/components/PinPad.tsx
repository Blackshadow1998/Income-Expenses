import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutRectangle, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FadeIn, GridLoader, PressScale, Shake, ShakeHandle } from './motion';
import { ringTop, VAULT, VaultDial } from './VaultDial';
import { t } from '../i18n';

export const PIN_LENGTH = 6;

// Digit keys sit on a circle around the dial, clockwise from just right of the pointer to just left of it,
// in a new random order for every PIN entry so the finger positions don't give the PIN away.
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
function shuffled() {
  const a = [...DIGITS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Point = { x: number; y: number };

/** Face layout for a square of `face` px: key size, centre of each key, dial size inside the key circle. */
function faceGeometry(face: number) {
  const key = Math.round(Math.min(60, Math.max(48, face * 0.16)));
  const r = face / 2 - key / 2;
  const keyCentre = (i: number): Point => {
    const a = ((-72 + i * 36) * Math.PI) / 180;
    return { x: face / 2 + r * Math.cos(a), y: face / 2 + r * Math.sin(a) };
  };
  return { key, keyCentre, dial: Math.round(2 * (r - key / 2 - 8)) };
}
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
  const [keys, setKeys] = useState(shuffled); // reshuffled after every complete PIN
  const { width, height } = useWindowDimensions();
  // The dial with its ring of keys is one square; the status line and footer below take about 200 px.
  const faceSize = Math.max(280, Math.min(368, width - 32, height - 200));
  const { key: KEY, keyCentre, dial: dialSize } = useMemo(() => faceGeometry(faceSize), [faceSize]);
  const keyShape = { width: KEY, height: KEY, borderRadius: KEY / 2 };

  // The title starts as a card in the middle of the screen; a tap or a key press puts it away, and it
  // comes back when the title changes (e.g. "confirm PIN" while setting one up).
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const prompting = dismissedFor !== title && !granted;
  const dismiss = useCallback(() => setDismissedFor(title), [title]);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Where the face (dial + keys) sits inside the pad, for the flying digits.
  const faceBox = useRef<LayoutRectangle | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextFlight = useRef(0);
  const launch = useCallback((digit: string, from: Point, to: Point, kind: Flight['kind'], delay = 0) => {
    setFlights((list) => [...list, { id: nextFlight.current++, digit, from, to, kind, delay }]);
  }, []);
  const landed = useCallback((id: number) => setFlights((list) => list.filter((f) => f.id !== id)), []);
  const ringAt = useCallback(
    (i: number): Point | null => {
      const f = faceBox.current;
      if (!f) return null;
      const p = ringTop(dialSize, PIN_LENGTH, i);
      const off = (faceSize - dialSize) / 2;
      return { x: f.x + off + p.x, y: f.y + off + p.y };
    },
    [dialSize, faceSize],
  );
  const keyAt = useCallback(
    (key: string): Point | null => {
      const f = faceBox.current;
      const i = keys.indexOf(key);
      if (!f || i < 0) return null;
      const p = keyCentre(i);
      return { x: f.x + p.x, y: f.y + p.y };
    },
    [keyCentre, keys],
  );

  // Kept in step with `digits` by the handlers, so quick key presses see the latest value.
  const digitsRef = useRef('');
  const press = useCallback(
    (key: string) => {
      if (busy) return;
      dismiss();
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
    [busy, dismiss, launch, ringAt, keyAt],
  );

  useEffect(() => {
    if (digits.length !== PIN_LENGTH) return;
    Promise.resolve(onCompleteRef.current(digits)).finally(() => {
      digitsRef.current = '';
      setDigits('');
      setKeys(shuffled());
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
      <View style={{ width: faceSize, height: faceSize }} onLayout={(e) => (faceBox.current = e.nativeEvent.layout)}>
        <View style={[styles.dial, { top: (faceSize - dialSize) / 2, left: (faceSize - dialSize) / 2 }]}>
          <Shake ref={shaker}>
            <VaultDial
              digits={digits}
              length={PIN_LENGTH}
              size={dialSize}
              mode={granted ? 'granted' : error && digits.length === 0 ? 'denied' : 'idle'}
            />
          </Shake>
        </View>
        {keys.map((k, i) => {
          const p = keyCentre(i);
          return (
            <PressScale
              key={k}
              onPress={() => press(k)}
              accessibilityLabel={k}
              scaleTo={0.88}
              containerStyle={[styles.keySpot, { left: p.x - KEY / 2, top: p.y - KEY / 2 }]}
              style={[styles.key, styles.keyDigit, keyShape]}
            >
              <Text style={[styles.keyText, { fontSize: Math.round(KEY * 0.4) }]}>{k}</Text>
            </PressScale>
          );
        })}
        {/* Delete sits in the bottom-right corner, outside the circle of keys. */}
        <PressScale
          onPress={() => press('⌫')}
          onLongPress={() => press('clear')}
          disabled={digits.length === 0 || granted}
          accessibilityLabel={t('pin.deleteDigit')}
          scaleTo={0.88}
          containerStyle={[styles.keySpot, { right: 0, bottom: 0 }]}
          style={[styles.key, styles.keyDelete, keyShape]}
        >
          <DeleteIcon />
        </PressScale>
      </View>
      <View style={styles.status}>
        {granted ? (
          <Text style={styles.granted}>{t('pin.unlocked')}</Text>
        ) : busy ? (
          <GridLoader size={22} />
        ) : (
          !!error && <Text style={styles.error}>{error}</Text>
        )}
      </View>
      {footer}
      <Prompt visible={prompting} title={title} subtitle={subtitle} error={error} onDismiss={dismiss} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {flights.map((f) => (
          <FlyingDigit key={f.id} flight={f} onDone={landed} />
        ))}
      </View>
    </FadeIn>
  );
}

/** Title card in the middle of the pad over a dimmed dial; a tap (or any key) puts it away. */
function Prompt({ visible, title, subtitle, error, onDismiss }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  error?: string | null;
  onDismiss: () => void;
}) {
  const v = useState(() => new Animated.Value(visible ? 1 : 0))[0];
  useEffect(() => {
    Animated.timing(v, { toValue: visible ? 1 : 0, duration: visible ? 260 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, visible]);
  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.promptBack, { opacity: v }]}>
      <Pressable onPress={onDismiss} style={styles.promptFill} accessibilityRole="button" accessibilityLabel={`${title} ${t('pin.tapToStart')}`}>
        <Animated.View style={[styles.promptCard, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
          <Text style={{ fontSize: 34 }}>🔐</Text>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          {visible && !!error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.tapHint}>{t('pin.tapToStart')}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
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
  subtitle: { color: VAULT.muted, textAlign: 'center' },
  status: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: VAULT.red, textAlign: 'center' },
  granted: { color: VAULT.gold, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  promptBack: { backgroundColor: 'rgba(16, 12, 10, 0.72)', borderRadius: 28, ...(Platform.OS === 'web' ? { backdropFilter: 'blur(3px)' } : null) },
  promptFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  promptCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: '#1d1713',
    borderWidth: 1,
    borderColor: 'rgba(233, 181, 98, 0.3)',
    boxShadow: '0px 0px 40px rgba(233, 181, 98, 0.18)',
  },
  tapHint: { marginTop: 6, color: VAULT.gold, fontWeight: '700', fontSize: 13 },
  dial: { position: 'absolute' },
  keySpot: { position: 'absolute' },
  key: { alignItems: 'center', justifyContent: 'center' },
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
