import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, currentMonth, MONTHS_SHORT, pad2, SHADOW, yearLabel } from '../format';
import { t } from '../i18n';
import { FadeIn, PressScale } from './motion';
import { Button, Stepper } from './ui';

/**
 * Pop-up to jump straight to a month: a year stepper over a 3×4 grid of months. `marked` months
 * ('YYYY-MM', those with entries) get a dot; the picked one is filled, the current one outlined.
 */
export function MonthPicker({ visible, value, marked, onPick, onClose }: {
  visible: boolean;
  value: string;
  marked: string[];
  onPick: (month: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.back} onPress={onClose}>
        {/* Mounted only while open, so the year starts at the shown month every time. */}
        {visible && <Sheet value={value} marked={marked} onPick={onPick} onClose={onClose} />}
      </Pressable>
    </Modal>
  );
}

function Sheet({ value, marked, onPick, onClose }: { value: string; marked: string[]; onPick: (month: string) => void; onClose: () => void }) {
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const now = currentMonth();
  const pick = (m: string) => {
    onClose();
    if (m !== value) onPick(m);
  };
  return (
    <FadeIn from={24} style={styles.sheetWrap}>
      {/* Swallows taps so only the dimmed area closes the picker. */}
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.title}>{t('month.pickTitle')}</Text>
        <Stepper label={t('year.label', { year: yearLabel(year) })} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
        <View style={styles.grid}>
          {MONTHS_SHORT.map((name, i) => {
            const m = `${year}-${pad2(i + 1)}`;
            const on = m === value;
            return (
              <PressScale
                key={m}
                onPress={() => pick(m)}
                scaleTo={0.9}
                containerStyle={styles.cellSpot}
                style={[styles.cell, m === now && styles.cellNow, on && styles.cellOn]}
              >
                <Text style={[styles.cellText, on && styles.cellTextOn]}>{name}</Text>
                <View style={[styles.dot, marked.includes(m) && { backgroundColor: on ? '#fff' : COLORS.primary }]} />
              </PressScale>
            );
          })}
        </View>
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="soft" onPress={onClose} style={{ flex: 1 }} />
          <Button title={t('month.thisMonth')} onPress={() => pick(now)} style={{ flex: 1 }} />
        </View>
      </Pressable>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', padding: 16 },
  sheetWrap: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  sheet: { backgroundColor: COLORS.card, borderRadius: 22, padding: 18, gap: 14, borderWidth: 1, borderColor: COLORS.border, ...SHADOW },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  cellSpot: { width: '33.333%', paddingHorizontal: 4 },
  cell: {
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cellNow: { borderColor: COLORS.primary },
  cellOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  cellText: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  cellTextOn: { color: '#fff' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  actions: { flexDirection: 'row', gap: 10 },
});
