import { forwardRef, ReactNode, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, PressableProps, StyleProp, Text, TextStyle, ViewStyle } from 'react-native';
import { COLORS } from '../format';

// Small animation helpers on top of React Native's built-in Animated (works on web, iOS and Android).
const native = Platform.OS !== 'web';

/** Fades and slides its children up when mounted; `delay` staggers lists. */
export function FadeIn({ children, delay = 0, style, from = 14 }: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  from?: number; // px to slide up from
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 380,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** Pressable that springs down a little while pressed. `containerStyle` is for layout (e.g. flex: 1). */
export function PressScale({ children, style, containerStyle, scaleTo = 0.96, ...props }: PressableProps & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const s = useRef(new Animated.Value(1)).current;
  const spring = (to: number) => Animated.spring(s, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: native }).start();
  return (
    <Pressable
      {...props}
      style={containerStyle}
      onPressIn={(e) => { spring(scaleTo); props.onPressIn?.(e); }}
      onPressOut={(e) => { spring(1); props.onPressOut?.(e); }}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }, props.disabled && { opacity: 0.55 }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Counts from the previous value to the new one. */
export function AnimatedNumber({ value, format, style, duration = 700 }: {
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    const t0 = Date.now();
    let frame = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const n = start + (value - start) * eased;
      from.current = n;
      setShown(n);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <Text style={style}>{format(shown)}</Text>;
}

/** Grey placeholder block that gently pulses while data loads. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: native }),
        Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: COLORS.skeleton, borderRadius: 12 }, style, { opacity: v }]} />;
}

/** Bar whose width grows to `fraction` (0–1) of its track. */
export function GrowBar({ fraction, color, style, delay = 0 }: {
  fraction: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: fraction, duration: 650, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [v, fraction, delay]);
  return (
    <Animated.View
      style={[{ height: '100%', backgroundColor: color }, style, { width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
    />
  );
}

export interface ShakeHandle {
  shake: () => void;
}

/** Wrapper that can be told to shake sideways, e.g. on a wrong PIN. */
export const Shake = forwardRef<ShakeHandle, { children: ReactNode; style?: StyleProp<ViewStyle> }>(
  function Shake({ children, style }, ref) {
    const x = useRef(new Animated.Value(0)).current;
    useImperativeHandle(ref, () => ({
      shake: () => {
        x.setValue(0);
        Animated.sequence(
          [12, -12, 9, -9, 5, -5, 0].map((to) => Animated.timing(x, { toValue: to, duration: 45, useNativeDriver: native })),
        ).start();
      },
    }), [x]);
    return <Animated.View style={[style, { transform: [{ translateX: x }] }]}>{children}</Animated.View>;
  },
);
