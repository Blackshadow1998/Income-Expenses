import { useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { COLORS, showError } from '../format';

const native = Platform.OS !== 'web';

// Thai vowel and tone marks that sit above/below the previous letter; they fly with it.
const MARK = /[ัิ-ฺ็-๎]/;
function letters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (MARK.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

const run = (a: Animated.CompositeAnimation) => new Promise<void>((done) => a.start(() => done()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LETTER_MS = 620;
const STAGGER_MS = 80;
const MIN_PENDING_MS = 1500; // the ring makes at least about one turn

type Phase = 'idle' | 'busy';
/** Sizes taken when the animation starts (button, content row, bin and letter centres). */
type Frame = { w: number; h: number; cw: number; shift: number; targets: number[] };

/**
 * Red "delete" button with a show: after `confirm`, its letters jump into the bin, the button shrinks to
 * a round bin with a ring spinning around it while `onDelete` runs, then it opens back up and `onDone`
 * runs (e.g. go back). A failed delete shows the error and leaves the button as it was.
 */
export function DeleteButton({ title, small, style, confirm, onDelete, onDone }: {
  title: string;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  confirm?: () => Promise<boolean>;
  onDelete: () => Promise<unknown>;
  onDone?: () => void;
}) {
  const chars = useMemo(() => letters(title), [title]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [frame, setFrame] = useState<Frame | null>(null);
  const fly = useState(() => new Animated.Value(0))[0]; // letters into the bin, staggered
  const lid = useState(() => new Animated.Value(0))[0]; // 1 = open
  const shrink = useState(() => new Animated.Value(0))[0]; // 1 = round
  const spin = useState(() => new Animated.Value(0))[0];
  const ring = useState(() => new Animated.Value(0))[0]; // ring opacity

  // Layout, read when pressed: button size, content row width, bin centre, each letter's centre.
  const box = useRef({ w: 0, h: 0 });
  const content = useRef({ w: 0 });
  const bin = useRef(0);
  const row = useRef(0);
  const spots = useRef<number[]>([]);

  const press = async () => {
    if (phase !== 'idle') return;
    if (confirm && !(await confirm())) return;
    const { w, h } = box.current;
    setFrame({
      w,
      h,
      cw: content.current.w,
      shift: content.current.w / 2 - bin.current, // moves the bin to the middle once round
      targets: chars.map((_, i) => bin.current - (row.current + (spots.current[i] ?? 0))),
    });
    setPhase('busy');
    const request = onDelete(); // runs while the letters fly
    request.catch(() => {}); // handled below; avoids an unhandled rejection meanwhile

    const total = LETTER_MS + (chars.length - 1) * STAGGER_MS;
    await run(
      Animated.parallel([
        Animated.timing(fly, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: native }),
        Animated.sequence([
          Animated.timing(lid, { toValue: 1, duration: 240, useNativeDriver: native }),
          Animated.delay(Math.max(0, total - 450)),
          Animated.timing(lid, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: native }),
        ]),
      ]),
    );
    spin.setValue(0);
    const spinning = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: native }));
    spinning.start();
    await run(
      Animated.parallel([
        Animated.timing(shrink, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.timing(ring, { toValue: 1, duration: 520, useNativeDriver: native }),
      ]),
    );
    const [result] = await Promise.allSettled([request, sleep(MIN_PENDING_MS)]);
    await run(Animated.timing(ring, { toValue: 0, duration: 300, useNativeDriver: native }));
    spinning.stop();
    if (result.status === 'rejected') showError(result.reason);
    fly.setValue(0); // letters come back hidden behind the round edge and show as it opens
    await run(Animated.spring(shrink, { toValue: 0, speed: 8, bounciness: 7, useNativeDriver: false }));
    setPhase('idle');
    setFrame(null);
    if (result.status === 'fulfilled') onDone?.();
  };

  const total = LETTER_MS + (chars.length - 1) * STAGGER_MS;
  const h = frame?.h ?? 0;
  const fontSize = small ? 13 : 15;

  return (
    <Pressable
      onPress={press}
      disabled={phase !== 'idle'}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[style, frame && { width: frame.w, height: frame.h }]}
    >
      {frame && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              left: frame.w / 2 - h / 2 - 6,
              top: -6,
              width: h + 12,
              height: h + 12,
              borderRadius: h / 2 + 6,
              opacity: ring,
              transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            },
          ]}
        />
      )}
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => {
          if (phase === 'idle') box.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        }}
        style={[
          styles.btn,
          small && styles.btnSmall,
          frame
            ? {
                alignSelf: 'center',
                width: shrink.interpolate({ inputRange: [0, 1], outputRange: [frame.w, frame.h] }),
                height: frame.h,
                borderRadius: shrink.interpolate({ inputRange: [0, 1], outputRange: [small ? 10 : 12, frame.h / 2] }),
              }
            : { alignSelf: 'stretch' },
        ]}
      >
        <Animated.View
          onLayout={(e) => (content.current = { w: e.nativeEvent.layout.width })}
          style={[styles.content, frame && { width: frame.cw, transform: [{ translateX: shrink.interpolate({ inputRange: [0, 1], outputRange: [0, frame.shift] }) }] }]}
        >
          <View onLayout={(e) => (bin.current = e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2)}>
            <Bin lid={lid} />
          </View>
          <View style={styles.row} onLayout={(e) => (row.current = e.nativeEvent.layout.x)}>
            {chars.map((c, i) => {
              const start = (i * STAGGER_MS) / total;
              const end = (i * STAGGER_MS + LETTER_MS) / total;
              const mid = (start + end) / 2;
              const p = <T extends number | string>([a, b, c]: T[]) =>
                fly.interpolate<T>({ inputRange: [0, start, mid, end, 1], outputRange: [a, a, b, c, c] });
              const dx = frame?.targets[i] ?? 0;
              return (
                <Animated.Text
                  key={i}
                  onLayout={(e) => (spots.current[i] = e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2)}
                  style={[
                    styles.letter,
                    { fontSize },
                    frame && {
                      opacity: p([1, 1, 0]),
                      transform: [
                        { translateX: p([0, dx * 0.55, dx]) },
                        { translateY: p([0, -h * 0.55, -2]) },
                        { scale: p([1, 0.85, 0.3]) },
                        { rotate: p(['0deg', '-25deg', '-70deg']) },
                      ],
                    },
                  ]}
                >
                  {c}
                </Animated.Text>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** Bin drawn with views; the lid hinges open on its left end. */
function Bin({ lid }: { lid: Animated.Value }) {
  return (
    <View style={styles.bin}>
      <Animated.View style={{ transformOrigin: 'left bottom', transform: [{ rotate: lid.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-50deg'] }) }] }}>
        <View style={styles.handle} />
        <View style={styles.lid} />
      </Animated.View>
      <View style={styles.can} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    borderColor: COLORS.dangerBorder,
  },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  letter: { fontWeight: '700', color: COLORS.out },
  ring: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: 'transparent',
    borderTopColor: COLORS.out,
    borderRightColor: COLORS.out,
  },
  bin: { width: 16, alignItems: 'center' },
  handle: {
    alignSelf: 'center',
    width: 6,
    height: 3,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: COLORS.out,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  lid: { width: 16, height: 2, borderRadius: 1, backgroundColor: COLORS.out },
  can: {
    width: 12,
    height: 13,
    marginTop: 1.5,
    borderWidth: 1.8,
    borderTopWidth: 0,
    borderColor: COLORS.out,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
});
