import { StyleSheet, Text, View } from 'react-native';
import type { CategoryCode, Insights } from '../api';
import { COLORS, dateLabel, money } from '../format';
import { Card } from './ui';
import { t, tCode, tParts } from '../i18n';
import { th } from '../locales/th';

const CODES: CategoryCode[] = ['income', 'expense', 'lend', 'borrow', 'lend_return', 'borrow_repay'];
/** Top items come as a bare name (the item, or the category when there is none): translate the category ones. */
const itemName = (name: string) => tCode('category', CODES.find((c) => th[`category.${c}`] === name), name);

/** "💡 สรุปเดือนนี้": spending vs last month, top items, daily average, biggest expense. */
export function InsightsCard({ data }: { data: Insights }) {
  if (data.out === 0 && data.prev_out === 0) return null;
  const up = (data.change_pct ?? 0) > 0;
  // Sentences with a bold value inside: the text before and after it.
  const change = tParts(up ? 'insights.spentMore' : 'insights.spentLess');
  const avg = tParts('insights.avgPerDay');
  const biggest = tParts('insights.biggest');
  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.h3}>{t('insights.title')}</Text>
      {data.change_pct !== null && (
        <Line icon={up ? '📈' : '📉'}>
          {change[0]}
          <Text style={{ fontWeight: '800', color: up ? COLORS.out : COLORS.in }}>{Math.abs(data.change_pct).toFixed(0)}%</Text>
          {change[1]}
          <Text style={styles.muted}> ({money(data.prev_out)} → {money(data.out)})</Text>
        </Line>
      )}
      <Line icon="📅">
        {avg[0]}
        <Text style={styles.bold}>{money(data.avg_per_day)}</Text>
        {avg[1]}
      </Line>
      {data.top.length > 0 && (
        <Line icon="🏆">
          {t('insights.top')}{' '}
          {data.top.map((top, i) => (
            <Text key={top.name}>
              {i > 0 ? ', ' : ''}
              <Text style={styles.bold}>{itemName(top.name)}</Text>
              <Text style={styles.muted}> {money(top.amount)}</Text>
            </Text>
          ))}
        </Line>
      )}
      {data.biggest && (
        <Line icon="💥">
          {biggest[0]}
          <Text style={styles.bold}>{money(data.biggest.amount)}</Text>
          {biggest[1]}{' '}
          <Text style={styles.muted}>
            {data.biggest.subcategory_name || data.biggest.note || tCode('category', data.biggest.category_code, data.biggest.category_name)} · {dateLabel(data.biggest.date)}
          </Text>
        </Line>
      )}
    </Card>
  );
}

function Line({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text>{icon}</Text>
      <Text style={{ flex: 1, color: COLORS.text, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h3: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  bold: { fontWeight: '800' },
  muted: { color: COLORS.muted, fontSize: 12 },
});
