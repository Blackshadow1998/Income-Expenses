import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

export interface Point {
  x: number;
  y: number;
}

// Spring that pulls the firefly toward its target every frame (no keyframed timeline):
// velocity = velocity * DAMPING + (target - position) * STIFFNESS.
const STIFFNESS = 0.04;
const DAMPING = 0.76;

/**
 * A glowing firefly that flies to `target` (coordinates inside the same parent). With no target it
 * drifts around `home`. It flickers softly all the time.
 */
export function Firefly({ target, home }: { target: Point | null; home: Point }) {
  const [xy] = useState(() => new Animated.ValueXY({ x: home.x, y: home.y }));
  const [flicker] = useState(() => new Animated.Value(1));
  const goal = useRef<{ target: Point | null; home: Point }>({ target, home });

  useEffect(() => {
    goal.current = { target, home };
  }, [target, home]);

  useEffect(() => {
    const pos = { x: home.x, y: home.y };
    const vel = { x: 0, y: 0 };
    let frame = 0;
    const tick = (t: number) => {
      const { target: tg, home: hm } = goal.current;
      // Idle: wander lazily around home.
      const aim = tg ?? { x: hm.x + Math.sin(t / 900) * 34, y: hm.y + Math.cos(t / 1300) * 14 };
      vel.x = vel.x * DAMPING + (aim.x - pos.x) * STIFFNESS;
      vel.y = vel.y * DAMPING + (aim.y - pos.y) * STIFFNESS;
      pos.x += vel.x;
      pos.y += vel.y;
      xy.setValue(pos);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The loop reads goal.current; it starts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xy]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 0.55, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(flicker, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flicker]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { transform: [{ translateX: Animated.subtract(xy.x, 14) }, { translateY: Animated.subtract(xy.y, 14) }] }]}
    >
      <Animated.View style={[styles.halo, { opacity: flicker }]} />
      <Animated.View style={styles.core} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, top: 0, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  halo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(253, 224, 71, 0.22)',
    boxShadow: '0px 0px 18px 8px rgba(250, 204, 21, 0.45)',
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fffbe6',
    boxShadow: '0px 0px 8px 3px rgba(253, 224, 71, 0.95)',
  },
});
