import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutRectangle, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { FadeIn, GridLoader, PressScale, Shake, ShakeHandle } from './motion';
import { VAULT, VaultDial } from './VaultDial';
import { t } from '../i18n';

export const PIN_LENGTH = 6;

const native = Platform.OS !== 'web';

// Digit keys sit on a circle around the dial, clockwise from just right of the pointer to just left of it,
// in a new random order for every PIN entry and after every delete so finger positions don't give the PIN away.
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
  const key = Math.round(Math.min(68, Math.max(50, face * 0.175)));
  const r = face / 2 - key / 2;
  const keyCentre = (i: number): Point => {
    const a = ((-72 + i * 36) * Math.PI) / 180;
    return { x: face / 2 + r * Math.cos(a), y: face / 2 + r * Math.sin(a) };
  };
  return { key, keyCentre, dial: Math.round(2 * (r - key / 2 - 8)) };
}
/** A key thrown from its spot into the safe ('in'), or bounced back out of it on delete ('out'). */
type Flight = { id: number; digit: string; from: Point; to: Point; kind: 'in' | 'out'; delay: number };
/** Hides a key and pops it back `after` ms later (a new object every time). */
type Pop = { after: number };

const OUT_MS = 560;

/**
 * 6-digit PIN entry on a safe dial (see VaultDial). Calls onComplete once all digits are in and clears
 * them after it settles; `granted` shows the unlocked dial. On web the number keys and Backspace work
 * too (turn off with listenKeys when another pad is on top). Put VaultBackdrop behind it.
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
  const [keys, setKeys] = useState(shuffled);
  const [pops, setPops] = useState<Record<string, Pop>>({});
  const { width, height } = useWindowDimensions();
  // The dial with its ring of keys is one square; the header above and status + footer below take about 320 px.
  const faceSize = Math.max(280, Math.min(400, width - 16, height - 320));
  const { key: KEY, keyCentre, dial: dialSize } = useMemo(() => faceGeometry(faceSize), [faceSize]);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Where the face (dial + keys) sits inside the pad, for the flying keys.
  const faceBox = useRef<LayoutRectangle | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextFlight = useRef(0);
  const launch = useCallback((digit: string, from: Point, to: Point, kind: Flight['kind'], delay = 0) => {
    setFlights((list) => [...list, { id: nextFlight.current++, digit, from, to, kind, delay }]);
  }, []);
  const landed = useCallback((id: number) => setFlights((list) => list.filter((f) => f.id !== id)), []);
  const pop = useCallback((digit: string, after: number) => setPops((p) => ({ ...p, [digit]: { after } })), []);
  const centre = useCallback((): Point | null => {
    const f = faceBox.current;
    return f && { x: f.x + faceSize / 2, y: f.y + faceSize / 2 };
  }, [faceSize]);
  const keyAt = useCallback(
    (order: string[], key: string): Point | null => {
      const f = faceBox.current;
      const i = order.indexOf(key);
      if (!f || i < 0) return null;
      const p = keyCentre(i);
      return { x: f.x + p.x, y: f.y + p.y };
    },
    [keyCentre],
  );

  // Kept in step with `digits`/`keys` by the handlers, so quick key presses see the latest value.
  const digitsRef = useRef('');
  const keysRef = useRef(keys);
  const press = useCallback(
    (key: string) => {
      if (busy) return;
      const cur = digitsRef.current;
      let next = cur;
      const mid = centre();
      if (key === '⌫' || key === 'clear') {
        const keep = key === 'clear' ? 0 : Math.max(0, cur.length - 1);
        if (keep === cur.length) return;
        // The keys jump to new random spots and each removed digit bounces back out of the safe onto
        // its key's new spot, the last one first; the key itself appears when its digit lands.
        const order = shuffled();
        keysRef.current = order;
        setKeys(order);
        for (let i = cur.length - 1, n = 0; i >= keep; i--, n++) {
          const to = keyAt(order, cur[i]);
          if (mid && to) launch(cur[i], mid, to, 'out', n * 90);
          pop(cur[i], n * 90 + OUT_MS - 60);
        }
        next = cur.slice(0, keep);
      } else if (/^[0-9]$/.test(key) && cur.length < PIN_LENGTH) {
        // The key is thrown into the safe and vanishes; a fresh one pops up in its spot.
        const from = keyAt(keysRef.current, key);
        if (from && mid) launch(key, from, mid, 'in');
        pop(key, 140);
        next = cur + key;
      }
      if (next === cur) return;
      digitsRef.current = next;
      setDigits(next);
    },
    [busy, centre, keyAt, launch, pop],
  );

  useEffect(() => {
    if (digits.length !== PIN_LENGTH) return;
    Promise.resolve(onCompleteRef.current(digits)).finally(() => {
      digitsRef.current = '';
      setDigits('');
      const order = shuffled();
      keysRef.current = order;
      setKeys(order);
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
      <View style={styles.header}>
        <View style={styles.badgeRow}>
          <LinearGradient colors={['rgba(233, 181, 98, 0)', VAULT.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.badgeLine} />
          <View style={styles.badge}>
            <LockIcon />
          </View>
          <LinearGradient colors={[VAULT.gold, 'rgba(233, 181, 98, 0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.badgeLine} />
        </View>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
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
          return <DialKey key={k} digit={k} x={p.x - KEY / 2} y={p.y - KEY / 2} size={KEY} pop={pops[k]} onPress={() => press(k)} />;
        })}
        {/* Delete sits in the bottom-right corner, outside the circle of keys. */}
        <PressScale
          onPress={() => press('⌫')}
          onLongPress={() => press('clear')}
          disabled={digits.length === 0 || granted}
          accessibilityLabel={t('pin.deleteDigit')}
          scaleTo={0.88}
          containerStyle={[styles.keySpot, { right: 0, bottom: 0 }]}
          style={[styles.key, { width: KEY, height: KEY, borderRadius: KEY / 2 }]}
        >
          <KeyFace size={KEY} />
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
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {flights.map((f) => (
          <FlyingKey key={f.id} flight={f} size={KEY} onDone={landed} />
        ))}
      </View>
    </FadeIn>
  );
}

/** One digit key: glides to its new spot after a shuffle, and hides then pops back when `pop` changes. */
function DialKey({ digit, x, y, size, pop, onPress }: { digit: string; x: number; y: number; size: number; pop?: Pop; onPress: () => void }) {
  const pos = useState(() => new Animated.ValueXY({ x, y }))[0];
  useEffect(() => {
    Animated.spring(pos, { toValue: { x, y }, speed: 12, bounciness: 8, useNativeDriver: native }).start();
  }, [pos, x, y]);
  const shown = useState(() => new Animated.Value(1))[0];
  useEffect(() => {
    if (!pop) return;
    shown.setValue(0);
    Animated.sequence([
      Animated.delay(pop.after),
      Animated.spring(shown, { toValue: 1, speed: 18, bounciness: 14, useNativeDriver: native }),
    ]).start();
  }, [shown, pop]);
  return (
    <Animated.View
      style={[
        styles.keySpot,
        { left: 0, top: 0, opacity: shown },
        { transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] },
      ]}
    >
      <PressScale onPress={onPress} accessibilityLabel={digit} scaleTo={0.88} style={[styles.key, { width: size, height: size, borderRadius: size / 2 }]}>
        <KeyFace size={size} />
        <Text style={[styles.keyText, { fontSize: Math.round(size * 0.42) }]}>{digit}</Text>
      </PressScale>
    </Animated.View>
  );
}

/** Dark domed fill of a key, under its gold rim. */
function KeyFace({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={['#30271f', '#16110d', '#0e0b09']}
      locations={[0, 0.6, 1]}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
    />
  );
}

/**
 * A key flying into the safe ('in': spinning, shrinking into the core and gone) or bouncing back out of
 * it ('out': growing from the core and overshooting onto its new spot).
 */
function FlyingKey({ flight, size, onDone }: { flight: Flight; size: number; onDone: (id: number) => void }) {
  const v = useState(() => new Animated.Value(0))[0];
  const into = flight.kind === 'in';
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: into ? 520 : OUT_MS,
      delay: flight.delay,
      easing: into ? Easing.in(Easing.cubic) : Easing.out(Easing.back(1.8)),
      useNativeDriver: native,
    }).start(() => onDone(flight.id));
  }, [v, into, flight, onDone]);
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  // Thrown in a slight curve rather than a straight line.
  const bend = into ? -dy * 0.25 : dy * 0.15;
  return (
    <Animated.View
      style={[
        styles.key,
        styles.flying,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          left: flight.from.x - size / 2,
          top: flight.from.y - size / 2,
          opacity: v.interpolate(into ? { inputRange: [0, 0.75, 1], outputRange: [1, 0.9, 0] } : { inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, dx * 0.5 + bend, dx] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: into ? [1.08, 0.12] : [0.12, 1] }) },
            { rotate: v.interpolate({ inputRange: [0, 1], outputRange: into ? ['0deg', '240deg'] : ['-200deg', '0deg'] }) },
          ],
        },
      ]}
    >
      <KeyFace size={size} />
      <Text style={[styles.keyText, styles.flyingText, { fontSize: Math.round(size * 0.42) }]}>{flight.digit}</Text>
    </Animated.View>
  );
}

/** Padlock drawn with views (shackle + body + keyhole). */
function LockIcon() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.shackle} />
      <View style={styles.lockBody}>
        <View style={styles.keyhole} />
      </View>
    </View>
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

/** Thin gold circle through point (px, py) around (cx, cy); only the part on screen shows. */
function Arc({ cx, cy, px, py, alpha, glow }: { cx: number; cy: number; px: number; py: number; alpha: number; glow?: boolean }) {
  const r = Math.hypot(px - cx, py - cy);
  return (
    <View
      style={{
        position: 'absolute',
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        borderWidth: 1,
        borderColor: `rgba(233, 181, 98, ${alpha})`,
        boxShadow: glow ? '0px 0px 16px rgba(233, 181, 98, 0.35)' : undefined,
      }}
    />
  );
}

/** Full-screen dark-gold background of the PIN screens: soft glow behind the dial and sweeping gold arcs. */
export function VaultBackdrop() {
  const { width: w, height: h } = useWindowDimensions();
  const glow = Math.min(w, h) * 0.5;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: VAULT.bg }]}>
      <LinearGradient colors={['#211913', '#0f0b09', '#0a0807']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View
        style={{
          position: 'absolute',
          left: w / 2 - glow,
          top: h * 0.5 - glow,
          width: glow * 2,
          height: glow * 2,
          borderRadius: glow,
          backgroundColor: 'rgba(233, 181, 98, 0.035)',
          boxShadow: '0px 0px 120px rgba(233, 181, 98, 0.10)',
        }}
      />
      {/* Top right: sweeps from the top edge down the right side. */}
      <Arc cx={-0.2 * w} cy={0.55 * h} px={0.6 * w} py={0} alpha={0.32} glow />
      <Arc cx={-0.2 * w} cy={0.55 * h} px={0.68 * w} py={0} alpha={0.1} />
      <Arc cx={-0.2 * w} cy={0.55 * h} px={0.78 * w} py={0} alpha={0.06} />
      {/* Bottom left: from the left side down to the bottom edge. */}
      <Arc cx={1.2 * w} cy={0.45 * h} px={0} py={0.8 * h} alpha={0.26} glow />
      <Arc cx={1.2 * w} cy={0.45 * h} px={0} py={0.86 * h} alpha={0.09} />
      <Arc cx={1.2 * w} cy={0.45 * h} px={0} py={0.92 * h} alpha={0.05} />
    </View>
  );
}

// Always dark (a vault), whatever the app theme.
const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    paddingHorizontal: 8,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  header: { alignItems: 'center', gap: 6, marginBottom: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  badgeLine: { width: 72, height: 1.5 },
  badge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: VAULT.gold,
    backgroundColor: '#1a1410',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 0px 22px rgba(233, 181, 98, 0.45)',
  },
  shackle: {
    width: 16,
    height: 11,
    borderWidth: 3,
    borderBottomWidth: 0,
    borderColor: VAULT.gold,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  lockBody: { width: 24, height: 18, borderRadius: 4, backgroundColor: VAULT.gold, alignItems: 'center', justifyContent: 'center' },
  keyhole: { width: 4, height: 7, borderRadius: 2, backgroundColor: VAULT.bg },
  title: { fontSize: 22, fontWeight: '800', color: VAULT.text, textAlign: 'center' },
  subtitle: { color: VAULT.muted, textAlign: 'center', fontSize: 15 },
  status: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8 },
  error: { color: VAULT.red, textAlign: 'center' },
  granted: { color: VAULT.gold, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  dial: { position: 'absolute' },
  keySpot: { position: 'absolute' },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(233, 181, 98, 0.7)',
    boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.55), 0px 0px 10px rgba(233, 181, 98, 0.12)',
  },
  keyText: { fontWeight: '700', color: VAULT.text },
  flying: { position: 'absolute', borderColor: VAULT.gold, boxShadow: '0px 0px 18px rgba(233, 181, 98, 0.6)' },
  flyingText: { color: VAULT.gold },
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
