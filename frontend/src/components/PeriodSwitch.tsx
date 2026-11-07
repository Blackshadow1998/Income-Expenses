import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, SHADOW } from '../format';
import { PressScale } from './motion';

/** "รายเดือน | รายปี" switch at the top of the รายรับรายจ่าย tab (two routes, one tab button). */
export function PeriodSwitch({ current }: { current: 'month' | 'year' }) {
  const go = (to: 'month' | 'year') => to !== current && router.navigate(to === 'month' ? '/' : '/yearly');
  return (
    <View style={styles.segment}>
      {(['month', 'year'] as const).map((k) => (
        <PressScale key={k} onPress={() => go(k)} containerStyle={{ flex: 1 }} style={[styles.btn, current === k && styles.btnOn]}>
          <Text style={[styles.text, current === k && { color: COLORS.primary }]}>{k === 'month' ? '📅 รายเดือน' : '📊 รายปี'}</Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 14, padding: 3 },
  btn: { paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  btnOn: { backgroundColor: COLORS.card, ...SHADOW },
  text: { fontWeight: '800', color: COLORS.muted, fontSize: 14 },
});
