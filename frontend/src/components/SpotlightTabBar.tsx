import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/format';

const useNativeDriver = Platform.OS !== 'web';
const LAMP = '#f3c892'; // warm light, reads on the dark glass in both themes
const BAR_HEIGHT = 64;

/**
 * Floating dark-glass tab bar with a "spotlight": a lamp on the top edge of the active tab shines a cone
 * of warm light down onto its icon, and glides to the next tab on press. Other tabs are dimmed.
 * `glyphs` maps route names to their emoji icon.
 */
export function makeSpotlightTabBar(glyphs: Record<string, string>) {
  return function TabBar(props: BottomTabBarProps) {
    return <Bar {...props} glyphs={glyphs} />;
  };
}

function Bar({ state, descriptors, emitter, navigateToTab, insets, glyphs }: BottomTabBarProps & { glyphs: Record<string, string> }) {
  const [width, setWidth] = useState(0);
  const pos = useState(() => new Animated.Value(state.index))[0];
  const tabWidth = width / state.routes.length;

  useEffect(() => {
    Animated.spring(pos, { toValue: state.index, speed: 14, bounciness: 6, useNativeDriver }).start();
  }, [pos, state.index]);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.spot, { width: tabWidth, transform: [{ translateX: Animated.multiply(pos, tabWidth) }] }]}
          >
            <LinearGradient
              colors={['rgba(243, 200, 146, 0.38)', 'rgba(243, 200, 146, 0.10)', 'rgba(243, 200, 146, 0)']}
              style={styles.beam}
            />
            <View style={styles.lamp} />
          </Animated.View>
        )}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = index === state.index;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };
          // 1 when this tab is under the spotlight, fading as the light moves away.
          const lit = pos.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={styles.tab}
            >
              <Animated.Text
                style={[
                  styles.glyph,
                  {
                    opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [0.42, 1] }),
                    transform: [
                      { translateY: lit.interpolate({ inputRange: [0, 1], outputRange: [2, -1] }) },
                      { scale: lit.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) },
                    ],
                  },
                ]}
              >
                {glyphs[route.name] ?? '•'}
              </Animated.Text>
              <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: COLORS.bg, paddingHorizontal: 12, paddingTop: 6 },
  bar: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(28, 22, 18, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 236, 214, 0.08)',
    boxShadow: '0px 10px 28px rgba(28, 18, 10, 0.35)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(14px)' } : null),
  },
  spot: { position: 'absolute', top: 0, bottom: 0, left: 0, alignItems: 'center' },
  lamp: {
    position: 'absolute',
    top: 0,
    width: 30,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: LAMP,
    boxShadow: `0px 0px 12px ${LAMP}`,
  },
  // The cone: narrow under the lamp, widening and fading towards the bottom.
  beam: { position: 'absolute', top: 2, bottom: 0, width: '78%', borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  glyph: { fontSize: 20 },
  label: { fontSize: 11, fontWeight: '700', color: 'rgba(241, 233, 223, 0.45)' },
  labelOn: { color: LAMP },
});
