import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { Budget } from '../api';
import { CATEGORY_ICONS, COLORS, money } from '../format';
import { GrowBar, PressScale } from './motion';
import { Card } from './ui';
import { t, tCode } from '../i18n';

export function budgetColor(ratio: number) {
  return ratio > 1 ? COLORS.out : ratio >= 0.8 ? '#f59e0b' : COLORS.in;
}

/** This month's budgets as progress bars: green, amber from 80%, red when over. */
export function BudgetCard({ budgets }: { budgets: Budget[] }) {
  const manage = () => router.push('/budgets');
  if (budgets.length === 0) {
    return (
      <PressScale onPress={manage} scaleTo={0.98} style={styles.empty}>
        <Text style={{ fontSize: 20 }}>🎯</Text>
        <Text style={{ color: COLORS.primary, fontWeight: '700', flex: 1 }}>{t('budget.setUp')}</Text>
        <Text style={{ color: COLORS.primary, fontSize: 18 }}>›</Text>
      </PressScale>
    );
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.header}>
        <Text style={styles.h3}>{t('budget.thisMonth')}</Text>
        <PressScale onPress={manage} hitSlop={8}>
          <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{t('budget.manage')}</Text>
        </PressScale>
      </View>
      {budgets.map((b, i) => {
        const ratio = b.spent / b.amount;
        const color = budgetColor(ratio);
        const left = b.amount - b.spent;
        return (
          <View key={b.id} style={{ gap: 5 }}>
            <View style={styles.line}>
              <Text style={styles.name} numberOfLines={1}>
                {CATEGORY_ICONS[b.category_code]} {b.subcategory_name || t('budget.wholeCategory', { name: tCode('category', b.category_code, b.category_name) })}
              </Text>
              <Text style={{ color, fontWeight: '800' }}>{Math.round(ratio * 100)}%</Text>
            </View>
            <View style={styles.track}>
              <GrowBar fraction={Math.min(1, ratio)} color={color} delay={150 + i * 80} style={{ borderRadius: 5 }} />
            </View>
            <Text style={styles.sub}>
              {t('budget.used', { spent: money(b.spent), amount: money(b.amount) })}{' '}
              <Text style={{ color: left < 0 ? COLORS.out : COLORS.muted }}>
                {left < 0 ? t('budget.over', { amount: money(-left) }) : t('budget.left', { amount: money(left) })}
              </Text>
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#c7cbf7',
    backgroundColor: COLORS.primarySoft,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h3: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { color: COLORS.text, fontWeight: '600', flex: 1 },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: COLORS.track },
  sub: { color: COLORS.muted, fontSize: 12 },
});
