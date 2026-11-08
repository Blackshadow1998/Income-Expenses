import { useEffect, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../format';
import { t } from '../i18n';

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

interface Props {
  labels: string[];
  series: BarSeries[];
  values: Record<string, number>[]; // one record per label, keyed by series key
  selected?: number | null;
  onSelect?: (index: number) => void;
  height?: number;
}

const MIN_COL_WIDTH = 25; // 12 columns still fit on a 375px-wide phone

/** Grouped bar chart built from plain Views, so it renders the same on web, iOS and Android. */
export function BarChart({ labels, series, values, selected, onSelect, height = 200 }: Props) {
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...values.flatMap((v) => series.map((s) => v[s.key] ?? 0)));
  // Bars grow from the axis whenever the data or the series change.
  const grow = useState(() => new Animated.Value(0))[0];
  const dataKey = JSON.stringify([series.map((s) => s.key), values]);
  const measured = width > 0;
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [grow, dataKey, measured]);
  const colWidth = Math.max(MIN_COL_WIDTH, width / Math.max(1, labels.length));
  const barWidth = Math.max(3, Math.min(18, (colWidth - 4 - 2 * (series.length - 1)) / series.length));

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>{s.label}</Text>
          </View>
        ))}
      </View>
      {width > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            {labels.map((label, i) => {
              const active = selected === i;
              return (
                <Pressable
                  key={label}
                  onPress={() => onSelect?.(i)}
                  style={[styles.col, { width: colWidth }, active && styles.colActive]}
                >
                  <View style={[styles.bars, { height }]}>
                    {series.map((s) => {
                      const v = values[i]?.[s.key] ?? 0;
                      const h = v > 0 ? Math.max(2, (v / max) * (height - 16)) : 0;
                      return (
                        <View key={s.key} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                          <Animated.View
                            style={{
                              width: barWidth,
                              height: Animated.multiply(grow, h),
                              backgroundColor: s.color,
                              borderTopLeftRadius: 5,
                              borderTopRightRadius: 5,
                              opacity: selected == null || active ? 1 : 0.45,
                            }}
                          />
                        </View>
                      );
                    })}
                  </View>
                  <Text style={[styles.xLabel, active && { color: COLORS.primary, fontWeight: '700' }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
      <Text style={styles.scale}>{t('chart.max', { amount: compact(max) })}</Text>
    </View>
  );
}

/** 1250 -> "1.3K", 2500000 -> "2.5M" */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  col: { alignItems: 'center', paddingTop: 4, borderRadius: 10 },
  colActive: { backgroundColor: COLORS.primarySoft },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, borderBottomColor: COLORS.border, alignSelf: 'stretch', justifyContent: 'center' },
  xLabel: { fontSize: 10, color: COLORS.muted, marginTop: 4, marginBottom: 4 },
  scale: { fontSize: 11, color: COLORS.muted, textAlign: 'right', marginTop: 4 },
});
