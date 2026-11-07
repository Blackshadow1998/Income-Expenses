import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

const native = Platform.OS !== 'web';

/** Fixed dark "vault" palette: the PIN screens look the same in light and dark theme. */
export const VAULT = {
  bg: '#100c0a',
  ring: ['#241d18', '#1b1612'],
  edge: 'rgba(255, 236, 214, 0.10)',
  gold: '#e9b562',
  goldSoft: 'rgba(233, 181, 98, 0.35)',
  red: '#ef5b4c',
  text: '#f1e9df',
  muted: '#a8998b',
};

export type DialMode = 'idle' | 'granted' | 'denied';

const TICKS = 12;

/** Dial geometry: centre, outer ring radius (room left for ticks and pointer), core radius, ring width. */
function geometry(size: number, length: number) {
  const c = size / 2;
  const outer = c - 18;
  const core = size * 0.11; // just room for the PIN dots, leaving the rings wide enough for readable digits
  return { c, outer, core, t: (outer - core) / length };
}

/** Where ring `i`'s digit under the pointer sits, from the dial's top-left corner. */
export function ringTop(size: number, length: number, i: number) {
  const { c, outer, t } = geometry(size, length);
  return { x: c, y: c - (outer - i * t - t / 2) };
}

/**
 * Safe-dial PIN display: one ring of digits 0–9 per PIN digit. Entering a digit spins its ring until
 * that digit sits under the pointer and lights the ring gold; a moment later the ring's numbers fade so
 * the PIN can't be read off the screen. `granted` turns the core into a glowing check, `denied` red.
 */
export function VaultDial({ digits, length, mode, size }: { digits: string; length: number; mode: DialMode; size: number }) {
  const { c, outer, core, t } = geometry(size, length);
  const color = mode === 'denied' ? VAULT.red : VAULT.gold;

  const angles = useState(() => Array.from({ length }, () => new Animated.Value(0)))[0];
  const current = useRef<number[]>(Array(length).fill(0));
  const prev = useRef('');
  useEffect(() => {
    angles.forEach((a, i) => {
      const was = prev.current[i];
      const now = digits[i];
      if (was === now) return;
      const cur = current.current[i];
      // Filled: one extra turn, ending with the digit at the top. Cleared: roll forward back to 0.
      const want = now === undefined ? 0 : -Number(now) * 36;
      const base = now === undefined ? cur : cur - 360;
      const target = base + ((((want - base) % 360) + 360) % 360);
      current.current[i] = target;
      Animated.timing(a, { toValue: target, duration: now === undefined ? 450 : 750, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
    });
    prev.current = digits;
  }, [angles, digits]);

  // The newest digit stays readable briefly; older ones are masked straight away.
  const [maskedFor, setMaskedFor] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setMaskedFor(digits), 700);
    return () => clearTimeout(timer);
  }, [digits]);
  const showLast = maskedFor !== digits;

  const granted = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    Animated.timing(granted, { toValue: mode === 'granted' ? 1 : 0, duration: mode === 'granted' ? 700 : 200, easing: Easing.out(Easing.back(1.6)), useNativeDriver: native }).start();
  }, [granted, mode]);

  const lit = mode === 'granted' ? TICKS : Math.round((digits.length / length) * TICKS);

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`ใส่แล้ว ${digits.length} จาก ${length} หลัก`}>
      {/* Glow behind the dial when unlocked. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.abs,
          { left: c - outer, top: c - outer, width: outer * 2, height: outer * 2, borderRadius: outer, backgroundColor: VAULT.gold },
          { opacity: granted.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }), transform: [{ scale: granted.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.08] }) }] },
        ]}
      />

      {Array.from({ length: TICKS }, (_, k) => {
        const a = (k * 360) / TICKS;
        const r = c - 8;
        const on = k < lit || mode === 'denied';
        return (
          <View
            key={k}
            style={[
              styles.abs,
              styles.tick,
              {
                left: c + r * Math.sin((a * Math.PI) / 180) - 3,
                top: c - r * Math.cos((a * Math.PI) / 180) - 8,
                transform: [{ rotate: `${a}deg` }],
                backgroundColor: on ? color : '#4a4039',
                boxShadow: on ? `0px 0px 8px ${color}` : undefined,
              },
            ]}
          />
        );
      })}

      <Animated.View style={[styles.abs, { width: size, height: size, opacity: granted.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]}>
        {Array.from({ length }, (_, i) => {
          const r = outer - i * t;
          const filled = i < digits.length;
          const masked = filled && (i < digits.length - 1 || !showLast);
          const edge = mode === 'denied' ? VAULT.red : filled || mode === 'granted' ? VAULT.gold : VAULT.edge;
          return (
            <View key={i} style={[styles.abs, { width: size, height: size }]}>
              <View
                style={[
                  styles.abs,
                  {
                    left: c - r,
                    top: c - r,
                    width: r * 2,
                    height: r * 2,
                    borderRadius: r,
                    backgroundColor: VAULT.ring[i % 2],
                    borderWidth: 1,
                    borderColor: edge,
                    boxShadow: edge === VAULT.edge ? undefined : `0px 0px 10px ${mode === 'denied' ? 'rgba(239, 91, 76, 0.45)' : VAULT.goldSoft}`,
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.abs,
                  { width: size, height: size },
                  { transform: [{ rotate: angles[i].interpolate({ inputRange: [-36000, 36000], outputRange: ['-36000deg', '36000deg'] }) }] },
                ]}
              >
                {Array.from({ length: 10 }, (_, d) => {
                  const a = d * 36;
                  const rm = r - t / 2;
                  const top = filled && Number(digits[i]) === d;
                  return (
                    <Text
                      key={d}
                      style={[
                        styles.abs,
                        styles.digit,
                        {
                          fontSize: Math.min(16, t * 0.82),
                          left: c + rm * Math.sin((a * Math.PI) / 180) - 10,
                          top: c - rm * Math.cos((a * Math.PI) / 180) - 10,
                          transform: [{ rotate: `${a}deg` }],
                          color: top && !masked ? color : VAULT.muted,
                          opacity: masked ? 0.12 : top ? 1 : 0.55,
                        },
                      ]}
                    >
                      {d}
                    </Text>
                  );
                })}
              </Animated.View>
            </View>
          );
        })}
        {/* Reading line under the pointer. */}
        <View style={[styles.abs, { left: c - 0.5, top: c - outer, width: 1, height: outer - core, backgroundColor: VAULT.goldSoft }]} />
      </Animated.View>

      {/* Pointer */}
      <View style={[styles.abs, styles.pointer, { left: c - 8, top: c - outer - 16, borderTopColor: color }]} />

      {/* Core: PIN dots, or the check when unlocked. */}
      <Animated.View
        style={[
          styles.abs,
          styles.core,
          {
            left: c - core,
            top: c - core,
            width: core * 2,
            height: core * 2,
            borderRadius: core,
            borderColor: mode === 'denied' ? VAULT.red : VAULT.goldSoft,
            transform: [{ scale: granted.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
            boxShadow: mode === 'granted' ? '0px 0px 40px rgba(233, 181, 98, 0.8)' : undefined,
          },
        ]}
      >
        {/* Gold fill fades in (opacity, so it also runs on the native driver). */}
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: core, backgroundColor: VAULT.gold, opacity: granted }]} />
        {mode === 'granted' ? (
          <Text style={styles.check}>✓</Text>
        ) : (
          <View style={styles.dots}>
            {Array.from({ length }, (_, i) => (
              <View key={i} style={[styles.dot, i < digits.length && { backgroundColor: color, boxShadow: `0px 0px 6px ${color}` }]} />
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  tick: { width: 6, height: 16, borderRadius: 3 },
  digit: { width: 20, height: 20, lineHeight: 20, textAlign: 'center', fontWeight: '800', fontVariant: ['tabular-nums'] },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  core: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d0a08', overflow: 'hidden' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3a312a' },
  check: { fontSize: 34, fontWeight: '900', color: '#ffffff' },
});
